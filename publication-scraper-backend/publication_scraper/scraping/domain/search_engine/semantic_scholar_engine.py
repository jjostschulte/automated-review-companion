import logging
import time
from typing import Any, Dict, List, Optional

import requests
from fontTools.misc.plistlib import end_date

from publication.models import Publication, PublicationStatus
from scraping.domain import SearchQuery, SearchQueryParser, SearchQueryType
from scraping.models import SearchEngineType
from utils import Logger, Profiler

from .search_engine import SearchEngine

import environ
env = environ.Env()
environ.Env.read_env()

log = Logger(__name__)
class SemanticScholarEngine(SearchEngine):
    """ Search engine for Semantic Scholar. """
    
    def __init__(self, search_query: Optional[SearchQuery] = None, proxy_name: str = ""): # queries: List[str], advanced_query: str = None, start_date: str = None):
        super().__init__()
        self.headers = {
            "Content-Type": "application/json", 
            "x-api-key": env('SEMANTIC_SCHOLAR_KEY') 
        }
        self.sch_fields: List[str] = [
            "title",
            "externalIds",
            "paperId",
            "url",
            "authors",
        ]
        self.engine_type: SearchEngineType = SearchEngineType.SEMANTIC_SCHOLAR
        self.proxy_name                 = proxy_name if proxy_name else "Semantic Scholar"
        self.url: str                   = "https://api.semanticscholar.org/graph/v1/paper/search"
        self.bulkUrl: str               = "https://api.semanticscholar.org/graph/v1/paper/search/bulk"
        self.results: List[Publication] = []
        self.BULK_MAX_RESULTS           = env.int('SEMANTIC_SCHOLAR_MAX_RESULTS', default=5000)
        
        if search_query:
            self.search_type                = search_query.search_type
            self.queries                    = search_query.search_strings
            self.advanced_query: str        = search_query.advanced_search
            self.start_date                 = search_query.start_date
            self.end_date                   = search_query.end_date
        
    def find_by_doi(self, doi: str) -> Optional[Publication]:
        """ Find a publication by its DOI. """
        try: 
            response = requests.get(f"https://api.semanticscholar.org/graph/v1/paper/{doi}")
            if response.status_code == 200:
                data = response.json()
                publication = Publication(
                    paper_title = data.get("title"),
                    paper_id    = f"DOI:https://doi.org/{doi}",
                )
                publication.save()
                return publication
            else :
                log.error(f"Failed to fetch data for DOI {doi}.")
                return None
        except Exception as e:
            log.error(f"Failed to fetch data for DOI {doi}.")
            return None


    @Profiler("Semantic Scholar Search")
    def search(self) -> List[Publication]:
        """ Search for papers on Semantic Scholar. """

        if self.search_type == SearchQueryType.ADVANCED:
            return self._advanced_search()
        return self._simple_search()
    
    
    def _advanced_search(self) -> List[Publication]:
        """ Perform an advanced search on Semantic Scholar. """
        sch_search_string = self._parse_search_string()
        log.info(f"Searching for `{sch_search_string}` on Semantic Scholar, {self.start_date} - {self.end_date}")
        search_results    = self.search_semantic_scholar(
                                search_string=sch_search_string, 
                                bulk=True, 
                                start_date=self.start_date,
                                end_date=self.end_date

                            )
        # search_results    = search_results.get("data")
        
        if search_results is None:
            log.info(">>> Semantic Scholar total: 0")
            return []
        
        self.process_search_results(search_results, self.advanced_query, sch_search_string)
        self.save_search_results()
        return self.results
        
    def _simple_search(self) -> List[Publication]:
        for idx, search_string in enumerate(self.queries):
            sch_search_string = self._parse_search_string(search_string)
            log.info(f"--- Searching for {sch_search_string} ({idx + 1}/{len(self.queries)}) ---")
            search_results    = self.search_semantic_scholar(
                                    search_string=sch_search_string, 
                                    bulk=True, 
                                    start_date=self.start_date
                                )
            
            if search_results is None:
                log.info(">>> Semantic Scholar total: 0")
                continue
            
            log.info(f"Search results: {len(search_results)}")
            self.process_search_results(search_results, search_string, sch_search_string)
        log.info(f"Processed results: {len(self.results)}")
        self.save_search_results()    
        log.info(f"Saved results: {len(self.results)}")
        return self.results

    def search_semantic_scholar(
        self, 
        search_string: str=None, 
        bulk: bool=False, 
        start_date: str=None,
        end_date: str=None
    ) -> Dict[str, Any]:
        """
        Search for papers on Semantic Scholar.
        Data output schema:
        {
            paperId: str,
            externalIds: {
                DOI: string,
                CorpusId: string
            },
            url: str,
            title: str,
            authors: {
                authorId: string,
                name: string, 
            }[]
        }
        
        -----------------------------------------------------------------
        
        Example:
        >>> print(search_semantic_scholar("'AI' 'Ethics'", bulk=True, start_date="2017-01-01", end_date="2024-12-31"))
        {
            'paperId': 'fd00f4e4c2ebdbb091a8f0a53b041bd207501da0', 
            'externalIds': {
                'CorpusId': 197639929
            }, 
            'url': 'https://www.semanticscholar.org/paper/fd00f4e4c2ebdbb091a8f0a53b041bd207501da0', 
            'title': 'care HCI Security and forensics Education User authentication Deception detection Smart tutoring Teaching assistant Posture recognition Gesture detection', 
            'authors': [
                {'authorId': '10109253', 'name': 'Arsalan Mosenia'}, 
                {'authorId': '1398781979', 'name': 'S. Sur-Kolay'}, 
                {'authorId': '145291370', 'name': 'A. Raghunathan'}, 
                {'authorId': '144874163', 'name': 'N. Jha'}
            ]
        }
        """
        api_url       = self.url if not bulk else self.bulkUrl
        search_params = self._parse_search_params(search_string, start_date, end_date)
        response      = self.get_all_responses(bulk, api_url, search_params)
        return response
    
    def process_search_results(
        self, 
        search_results: List[Dict[str, Any]], 
        search_string: str,
        formatted_search_string: str
    ) -> None:
        """ Process the search results from Semantic Scholar. """
        
        for count, result in enumerate(search_results, start=1):
            paper_id    = self._get_paper_id(result)
            publication   = Publication(
                                paper_title             = result.get("title"),
                                paper_id                = paper_id,
                                search_string           = search_string,
                                searched_from           = [self.proxy_name],
                                formatted_search_string = formatted_search_string
                            )
            self.results.append(publication)
     
    def _get_paper_id(self, sch_result: Dict[str, str]) -> str:
        """
        Get the paper ID from the scholar search result.
        Checks for DOI, ArXiv, and paper ID in the given results and returns
        the appropriate formatted string.
        
        :param sch_result (Dict[str, str]): The search result from Semantic Scholar.
        :rettype str: The formatted paper ID.
        """
        external_ids = sch_result.get('externalIds', {})
        doi = external_ids.get('DOI')
        arxiv_id = external_ids.get('ArXiv')
        paper_id = sch_result.get("paperId")
        
        if doi: 
            return f"DOI:https://doi.org/{doi}"
        
        if arxiv_id:
            return f"DOI:https://doi.org/10.48550/arXiv.{arxiv_id}"
        
        return f"URL:https://www.semanticscholar.org/paper/{paper_id}"
        
    def _parse_search_params(self, query: str, start_date: str, end_date: str) -> Dict[str, str]:
        """Parse the search parameters for the Semantic Scholar API."""
        
        if self.sch_fields == "all":
            return {
                "query": query, 
                "publicationDateOrYear": f"{start_date}:{end_date}"
            }
        else:
            return {
                "query": query, 
                "publicationDateOrYear": f"{start_date}:{end_date}",
                "fields": ",".join(self.sch_fields)
            }     
        
    def get_all_responses(self, bulk: bool, url: str, params: Dict[str, str]) -> List[Dict[str, Any]]:
        """Get all search results from the Semantic Scholar API."""
        
        response = self.fetch_search_results(url, params=params)
        data = response.json()
        total_results = data.get("total")
        results = data.get("data")
        token = data.get("token")
        log.info(f"Total number of matching papers: {total_results} | Token: {token}")
        
        while len(results) < total_results and len(results) < self.BULK_MAX_RESULTS and bulk:
            log.info(f"Fetching results {len(results) + 1} to {len(results) + 1000}...")
            params["token"] = token
            response = self.fetch_search_results(url, params)
            data = response.json()
            token = data.get("token")
            results.extend(data.get("data"))
        
        return results

    def fetch_search_results(
        self, 
        url: str, 
        params: Dict[str, str], 
        max_retries: int = 3, 
        delay: int = 5
    ) -> Dict[str, Any]:
        """Fetch search results from the Semantic Scholar API."""
        
        for attempt in range(max_retries):
            response = requests.get(url, headers=self.headers, params=params)
            
            if response.status_code == 200:
                return response
            
            log.error(f"Request failed with status code {response.status_code}. Attempt {attempt + 1} of {max_retries}.")
            if attempt < max_retries - 1:
                time.sleep(delay)

        raise Exception(f"Failed to fetch data: {response.text}")

    def _parse_search_string(self, search_string: List[str] = []) -> str:
        """ 
        Parse the search string for Semantic Scholar. 

        NOTE: match search string with boolean operators, and other terms
        are only matched with the exact phrase.
        """
        log.info(f"Search type: {self.search_type}")
        if self.search_type == SearchQueryType.ADVANCED:
            parser = SearchQueryParser(self.advanced_query)
            return parser.parse(SearchEngineType.SEMANTIC_SCHOLAR)
        
        search_term = " + ".join(f"'{term}'" for term in search_string)
        log.info(f"Search term: {search_term}")
        return search_term
    
    def save_results(self):
        return super().save_results()