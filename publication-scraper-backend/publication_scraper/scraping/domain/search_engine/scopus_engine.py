from urllib.parse import quote
import logging
import time
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

class ScopusEngine(SearchEngine):
    def __init__(self, search_query : Optional[SearchQuery] = None):
        super().__init__()
        self.headers = {
            "Accept": "application/json",
            "X-ELS-APIKey": env("SCOPUS_KEY"),
        }
        self.engine_type                = SearchEngineType.SCOPUS
        self.url                        = "https://api.elsevier.com/content/search/scopus"
        self.PAGINATED_OFFSET           = 10
        self.MAX_RESULTS = env.int('SCOPUS_MAX_RESULTS', default=1000)
        self.total_results              = 0
        self.cursor                     = None

        if search_query:
            self.search_type              = search_query.search_type
            self.queries                  = search_query.search_strings
            self.advanced_query           = search_query.advanced_search
            # Scopus only supports searching by year, not by date, so we only pass in the year
            self.start_year: str          = search_query.start_date.year
            self.end_year: str            = search_query.end_date.year

    @Profiler("Scopus Search")
    def search(self) -> List[Publication]:
        if self.search_type == SearchQueryType.ADVANCED:
            return self._advanced_search()
        return self._simple_search()
    
    def _simple_search(self) -> List[Publication]:
        
        for idx, search_string in enumerate(self.queries):
            log.debug(f"Current search string: {search_string}")
            scopus_search_string = self._parse_search_string(search_string)

            log.info(f"--- Searching for {scopus_search_string} ({idx + 1}/{len(self.queries)}) ---")
            search_results = self._get_search_results(scopus_search_string)
            log.info(f">>> Scopus total: {len(search_results)}")

            self.process_search_results(search_results, search_string, scopus_search_string)

        self.save_search_results()
        return self.results

    def _advanced_search(self) -> List[Publication]:
        scopus_search_string = self._parse_search_string(self.advanced_query)
        log.info(f"Searching for `{scopus_search_string}` on Scopus, {self.start_year} - {self.end_year}")
        search_results = self._get_search_results(scopus_search_string)
        log.info(f">>> Scopus total: {len(search_results)}")

        self.process_search_results(search_results, self.advanced_query, scopus_search_string)
        self.save_search_results()
        return self.results
    
    def _parse_search_string(self, search_string: List[str] = []) -> str:
        log.info(f"Search type: {self.search_type}")
        if self.search_type == SearchQueryType.ADVANCED:
            parser = SearchQueryParser(self.advanced_query)
            return f"TITLE-ABS-KEY({parser.parse(SearchEngineType.SCOPUS)})"
        
        # Add curly brackets to phrases
        search_term = [f'{{term}}' if " " in term else term for term in search_string]
        search_term = " AND ".join(search_string)
        return f"TITLE-ABS-KEY({search_term})"

    def _get_search_results(self, search_string: str) -> List[Publication]:
        try:
            search_params = self._parse_search_params(search_string)
            response = self._get_all_responses(search_params)
            
            # Return an empty list if no results found
            if 'error' in response[0] and response[0]['error'] == 'Result set was empty':
                log.warning(f"Scopus search results are empty for the query: {search_string}")
                return []  

            # Additional error handling if needed
            if 'error' in response:
                log.error(f"Scopus search encountered an error: {response}")
                raise ValueError(f"Scopus API returned an error: {response}")

            return response

        except Exception as e:
            # Handle unexpected exceptions
            log.error(f"An unexpected error occurred while fetching search results: {e}")
            raise  # Re-raise the exception after logging it

    def _parse_search_params(self, search_string: str) -> Dict[str, Any]:
        log.info(f"Searching for: {search_string}")
        return {
            "query": search_string,
            "year": f"{self.start_year}-{self.end_year}",
            "count": self.PAGINATED_OFFSET,
            "start": 0
        }
    
    def _get_all_responses(self, search_params: Dict[str, Any]) -> List[Dict[str, Any]]:
        """ Get all responses from paginated search results """
        response = []

        data = self.fetch_search_results(search_params)
        response.extend(data["search-results"]["entry"])
        search_params["start"] = data["search-results"]["opensearch:startIndex"] + data["search-results"]["opensearch:itemsPerPage"] 
        self.total_results     = data["search-results"]["opensearch:totalResults"]
        total_results          = min(int(self.total_results), self.MAX_RESULTS)

        for start in range(int(search_params["start"]), total_results, self.PAGINATED_OFFSET):
            self.cursor            = start
            search_params["start"] = start
            data                   = self.fetch_search_results(search_params)
            response.extend(data["search-results"]["entry"])

        return response

    def fetch_search_results(
        self, 
        search_params: Dict[str, Any],
        max_retries: int = 5,
        delay: int = 1
    ) -> Dict[str, Any]:
        
        for _ in range(max_retries):
            try:
                
                actual_url = self.url + "?"
                for key, value in search_params.items():
                    if key == "query":
                        actual_url += f"{key}={quote(str(value))}&"
                    else:
                        actual_url += f"{key}={value}&"
                actual_url = actual_url[:-1]

                log.info(f"Fetching search results from: {actual_url}")
                response = requests.get(actual_url, headers=self.headers)
                response.raise_for_status()
                data = response.json()
                return data
            except requests.exceptions.HTTPError as e:
                log.error(f"Error fetching search results: {e}")
                log.error(f"Retrying in {delay} seconds")
                time.sleep(delay)
        
        raise Exception(f"Failed to fetch search results after {max_retries} attempts")

    def process_search_results(
        self,
        search_results: List[Dict[str, Any]],
        search_string: str,
        scopus_search_string: str
    ) -> None:
        
        for count, result in enumerate(search_results, start=1):
            paper_id = self._get_paper_id(result)
            publication = Publication(
                paper_id                = paper_id,
                paper_title             = result.get("dc:title"),
                search_string           = search_string,
                formatted_search_string = scopus_search_string,
                searched_from           = [SearchEngineType.SCOPUS],   
            )
            log.info(f"{search_string}: Paper {count} - {publication.paper_title}")
            self.results.append(publication)

    def _get_paper_id(self, result: Dict[str, Any]) -> Optional[str]:
        
        doi = result.get("prism:doi")
        url = result.get("prism:url")
        identifier = result.get("dc:identifier")

        if doi:
            return f"DOI:https://doi.org/{doi}"
        return f"URL:{url}" if url else f"ID:{identifier}"