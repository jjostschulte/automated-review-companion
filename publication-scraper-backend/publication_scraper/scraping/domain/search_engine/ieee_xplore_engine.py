import logging
import time
from datetime import date, datetime
from typing import Any, Dict, List, Optional

import requests

from publication.models import Publication, PublicationStatus
from scraping.domain import SearchQuery, SearchQueryParser, SearchQueryType
from scraping.models import SearchEngineType
from utils import Logger, Profiler

from .search_engine import SearchEngine
import environ
env = environ.Env()
environ.Env.read_env()

log = Logger(__name__)

class IEEEXploreEngine(SearchEngine):
    MAX_RECORDS_PER_REQUEST = 200
    MAX_RESULTS = 1000

    def __init__(self, search_query: SearchQuery = None):
        super().__init__()
        # max total results to fetch (can be overridden via .env)
        self.MAX_RESULTS = env.int('IEEE_MAX_RESULTS', default=1000)
        self.base_url = "https://ieeexploreapi.ieee.org/api/v1/search/articles"
        # https://ieeexploreapi.ieee.org/api/v1/search/articles?querytext=(rfid%20AND%20%22internet%20of%20things%22)&apikey=3bsxeu63cu3g4xbm9hts7suf
        self.engine_type: SearchEngineType = SearchEngineType.IEEE_XPLORE
        self.api_key = env('IEEE_API_KEY')

        if search_query:
            self.search_type = search_query.search_type
            self.queries = search_query.search_strings
            self.advanced_query = search_query.advanced_search
            self.start_date = search_query.start_date
            self.end_date = search_query.end_date

    @Profiler("IEEE Xplore search")
    def search(self) -> List[Publication]:

        if self.search_type == SearchQueryType.ADVANCED:
            return self._advanced_search()
        return self._simple_search()

    def _simple_search(self) -> List[Publication]:

        for idx, search_string in enumerate(self.queries):
            ieee_search_string = self._parse_search_string(search_string)

            log.info(f"--- Searching for {ieee_search_string} ({idx + 1}/{len(self.queries)}) ---")
            search_results = self.search_ieee_xplore(ieee_search_string)
            log.info(f">>> IEEE Xplore total: {len(search_results)}")

            self.process_search_results(search_results, search_string, ieee_search_string)

        self.save_results()
        return self.results

    def _advanced_search(self) -> List[Publication]:
        ieee_search_string = self._parse_search_string(self.advanced_query)
        log.info(f"Searching for `{ieee_search_string}` on IEEE, {self.start_date} - {self.end_date}")
        search_results = self.search_ieee_xplore(ieee_search_string)
        log.info(f">>> IEEE Xplore total: {len(search_results)}")

        self.process_search_results(search_results, self.advanced_query, ieee_search_string)
        self.save_results()
        return self.results

    def _parse_search_string(self, search_string: List[str] = []) -> str:
        log.info(f"Search type: {self.search_type}")
        if self.search_type == SearchQueryType.ADVANCED:
            parser = SearchQueryParser(self.advanced_query)
            return parser.parse(SearchEngineType.IEEE_XPLORE)

        # Double quote search term phrases
        search_string = [f'"{term}"' if " " in term else term for term in search_string]
        return " AND ".join(search_string)

    def search_ieee_xplore(self, search_string: str) -> List[Publication]:
        search_params = self._parse_search_params(search_string)
        return self._get_all_responses(search_params)

    def _parse_search_params(self, search_string: str):
        params = {
            "querytext": f"({search_string})",
            "apikey": self.api_key,
            "max_records": self.MAX_RECORDS_PER_REQUEST,
            "start_record": 1,
        }

        if self.start_date:
            params["start_year"] = self._extract_year(self.start_date)
        if self.end_date:
            params["end_year"] = self._extract_year(self.end_date)

        return params

    def _extract_year(self, value: Any) -> int:
        if isinstance(value, (datetime, date)):
            return value.year

        if isinstance(value, str):
            for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S.%fZ"):
                try:
                    return datetime.strptime(value, fmt).year
                except ValueError:
                    continue
            if len(value) >= 4 and value[:4].isdigit():
                return int(value[:4])

        raise ValueError(f"Invalid date/year value for IEEE Xplore filter: {value}")

    def _get_all_responses(self, search_params: Dict[str, Any]) -> List[Dict[str, Any]]:
        all_articles: List[Dict[str, Any]] = []
        total_records: Optional[int] = None

        while len(all_articles) < self.MAX_RESULTS:
            response_data = self._fetch_search_results(self.base_url, search_params)
            articles = response_data.get("articles", [])

            if total_records is None:
                total_records = int(response_data.get("total_records", len(articles)) or 0)

            if not articles:
                break

            all_articles.extend(articles)

            if len(all_articles) >= total_records:
                break

            if len(articles) < self.MAX_RECORDS_PER_REQUEST:
                break

            search_params["start_record"] += len(articles)

        return all_articles[: self.MAX_RESULTS]

    def _fetch_search_results(
        self,
        url: str,
        params: Dict[str, Any],
        max_retries: int = 3,
        delay: int = 5,
    ) -> Dict[str, Any]:

        for attempt in range(max_retries):
            try:
                response = requests.get(url, params=params, timeout=30)
                response.raise_for_status()
                return response.json()
            except requests.exceptions.RequestException as e:
                log.error(f"Error fetching search results: {e}")
                if attempt < max_retries - 1:
                    log.error(f"Retrying in {delay} seconds")
                time.sleep(delay)

        raise Exception(f"IEEE Xplore: Failed to fetch search results after {max_retries} retries")

    def process_search_results(
        self,
        search_results: List[Dict[str, Any]],
        search_string: str,
        ieee_search_string: str
    ) -> None:

        for _, result in enumerate(search_results, start=1):
            paper_id = self._get_paper_id(result)
            publication = Publication(
                paper_title             = result.get("title") or result.get("publication_title"),
                paper_id                = paper_id,
                search_string           = search_string,
                searched_from           = [SearchEngineType.IEEE_XPLORE],
                formatted_search_string = f"({ieee_search_string})",
            )
            self.results.append(publication)

    def _get_paper_id(self, result: Dict[str, Any]) -> Optional[str]:
        if doi := result.get("doi"):
            return f"DOI:https://doi.org/{doi}"
        return f"URL:{result.get('html_url')}"