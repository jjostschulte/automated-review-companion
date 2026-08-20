import string
import re
from itertools import product
from typing import Dict, List, Tuple
from datetime import datetime

from django.http import JsonResponse
from publication.models import Publication, PublicationMetadata, PublicationStatus
from rest_framework.status import HTTP_400_BAD_REQUEST
from rest_framework.views import APIView
from scraping.domain import (
    SearchEngine,
    SearchQuery,
    SearchTerm,
    SearchTermProcessor,
    DBLPEngine,
    IEEEXploreEngine,
    SemanticScholarEngine,
    WebOfScienceEngine,
    ScopusEngine
)
from scraping.interfaces.extract_metadata import PublicationMetadataExtractor
from scraping.models import SearchEngineType, SearchResult, SearchResponse
from scraping.serializers.core_serializers import (
    PublicationMetadataSerializer,
    SearchAndCleanSerializer,
    SearchStringDifferenceSerializer,
    ManualAddPublicationSerializer
)
from utils import Logger
from django.shortcuts import get_object_or_404
from utils.controller import Controller


log = Logger(__name__)

class SearchAndCleanView(APIView):

    # @Controller
    def post(self, request):
        serializer = SearchAndCleanSerializer(data=request.data)
        if not serializer.is_valid():
            return JsonResponse(serializer.errors, status=HTTP_400_BAD_REQUEST, safe=False)

        try:
            self.validation_papers = serializer.validated_data['validation_papers']
            self.search_terms = serializer.validated_data['search_terms']
            self.start_date = serializer.validated_data.get('start_date', '2020-01-01')
            self.end_date = serializer.validated_data.get('end_date', '2021-01-01')
            self.sources = serializer.validated_data['sources']

            log.info(f"Search from {self.start_date} to {self.end_date}")

            self.all_search_terms = []
            if self.search_terms.get('primary'):
                self.all_search_terms.append(list(self.search_terms['primary']))
            if self.search_terms.get('secondary'):
                self.all_search_terms.append(list(self.search_terms['secondary']))
            if self.search_terms.get('tertiary'):
                self.all_search_terms.append(list(self.search_terms['tertiary']))

            self.all_search_terms = list(product(*self.all_search_terms))
            log.info("All search terms: %s", self.all_search_terms)

            self.advanced_search = self.search_terms.get('advanced')

            self.query = SearchQuery(
                search_strings=self.all_search_terms,
                advanced_search=self.advanced_search,
                start_date=self.start_date,
                end_date=self.end_date,
            )

            self.engine_errors: Dict[str, str] = {}
            self.results: List[Publication] = []
            self.results = self.search()
            self.all_search_words = self.generate_variants()

            matches = self.get_matches()
            results = [result.to_dict() for result in self.results]
            response = {
                "query": request.data,
                "variations": self.all_search_words,
                "results": results,
                "matches": matches,
                "engine_errors": self.engine_errors,
            }
            response = self.save_response(response)
            response["engine_errors"] = self.engine_errors
            return JsonResponse(response)
        except Exception as e:
            log.error(f"SearchAndCleanView failed: {e}", exc_info=True)
            return JsonResponse({"error": str(e)}, status=HTTP_400_BAD_REQUEST)

    def search(self) -> List[Publication]:
        """ Search for publications using the search terms. """

        engines: List[SearchEngine] = []
        metadata: Dict[str, str] = dict()

        if SearchEngineType.DBLP in self.sources:
            engines.append(DBLPEngine(self.query))

        if SearchEngineType.SEMANTIC_SCHOLAR in self.sources:
            engines.append(SemanticScholarEngine(self.query))

        if SearchEngineType.WEB_OF_SCIENCE in self.sources:
            engines.append(WebOfScienceEngine(self.query))

        if SearchEngineType.IEEE_XPLORE in self.sources:
            engines.append(IEEEXploreEngine(self.query))

        if SearchEngineType.SCOPUS in self.sources:
            engines.append(ScopusEngine(self.query))

        log.info("Searching for publications: %s", self.query.search_strings)
        results = []
        for engine in engines:
            try:
                engine_results = sorted(engine.search(), key=lambda x: x.paper_id)
                results.extend(engine_results)
            except Exception as error:
                source_name = getattr(engine.engine_type, "value", str(engine.engine_type))
                self.engine_errors[source_name] = str(error)
                log.error("Search engine `%s` failed: %s", source_name, error)
                continue

            metadata[engine.engine_type] = {
                "cursor": engine.cursor,
                "total_results": engine.total_results
            }


        # TODO: remove_duplicates -> aggregate_duplicates
        results = Publication.remove_duplicates(results)
        Publication.bulk_upsert(results)
        return results

    def generate_variants(self) -> List[SearchTerm]:
        """ Generate American and British variants of the search terms. """
        log.info("Generating search term variants...")
        if self.all_search_terms == [()]:
            words_and_quoted_phrases = r"'[^']*'|\"[^\"]*\"|\b\w+\b"
            self.terms = re.findall(words_and_quoted_phrases, self.advanced_search)
            self.terms = [term for term in self.terms if term.lower() not in ['and', 'or', 'not']]
            self.all_search_terms = [[term.replace('"', '').replace("'", '') for term in self.terms]]
        log.info("All search terms: %s", self.all_search_terms)
        word_processor = SearchTermProcessor(self.all_search_terms)
        word_processor.generate_variants()
        return [search_term.to_dict() for search_term in word_processor.all_search_words]

    def get_matches(self) -> Dict:
        """ Get publications that match the validation papers. """
        matches = []

        for paper in self.validation_papers:
            for result in self.results:
                same_doi = paper.get('doi') and result.paper_id and paper['doi'].lower() in result.paper_id.lower()
                same_title = paper.get('title') and result.paper_title and paper['title'].lower() in result.paper_title.lower()
                if same_doi or same_title:
                    matches.append(paper)

        percentage_match = (len(matches) / len(self.validation_papers)) * 100 if self.validation_papers else 0
        return { "papers": matches, "num_matches": len(matches), "percentage_match": percentage_match }

    def save_response(self, response: Dict) -> Dict:
        """ Save the search results to the database. """
        search_results = SearchResponse(
            query       = response['query'],
            variations  = response['variations'],
            matches     = response['matches'],
            results     = response['results']
        )
        search_results.save()
        return search_results.to_dict()

class PublicationMetadataView(APIView):

    # @Controller
    def post(self, request):
        serializer = PublicationMetadataSerializer(data=request.data)
        if serializer.is_valid():

            # NOTE: This is a temporary solution to get all paper IDs.
            # paper_ids = Publication.objects.values_list('paper_id', flat=True)

            paper_ids = serializer.validated_data['paper_ids']
            paper_ids = [paper_id for paper_id in paper_ids if paper_id.startswith('DOI')]
            extractor = PublicationMetadataExtractor(paper_ids)
            metadata = [pub_metadata.to_dict(show_publication=True) for pub_metadata in extractor.extracted_metadata]
            failed = [publication.paper_id for _, publication in extractor.failed_papers]

            search_reference_id = serializer.validated_data.get('search_reference_id')
            self.update_search_results(search_reference_id, metadata)

            return JsonResponse({ "metadata": metadata, "failed": failed })
        return JsonResponse(serializer.errors, status=HTTP_400_BAD_REQUEST)

    def update_search_results(self, search_reference_id: str, metadata: List[Dict]):

        if not search_reference_id:
            return

        search_results = get_object_or_404(SearchResponse, id=search_reference_id)
        historical_results = search_results.results

        metadata_by_paper_id = {}
        for pub_metadata in metadata:
            paper_id = pub_metadata.get('paper_id')
            if not paper_id:
                continue
            if not isinstance(pub_metadata.get('publication_date'), str) and pub_metadata.get('publication_date') is not None:
                pub_metadata['publication_date'] = pub_metadata['publication_date'].strftime('%Y-%m-%d')
            metadata_by_paper_id[paper_id] = pub_metadata

        for idx, result in enumerate(historical_results):
            paper_id = result.get('paper_id')
            if paper_id and paper_id in metadata_by_paper_id:
                historical_results[idx] = metadata_by_paper_id[paper_id]

        search_results.results = historical_results
        SearchResponse.objects.filter(id=search_reference_id).update(results=historical_results)

class ManualAddPublicationView(APIView):

    @Controller
    def post(self, request):
        """
        Manually search for the paper and metadata of a list of DOIs
        Searches from Semantic Scholar.
        """
        serializer = ManualAddPublicationSerializer(data=request.data)
        if serializer.is_valid():
            dois = serializer.validated_data['dois']
            sch_engine = SemanticScholarEngine()
            publication_results = []
            for doi in dois:
                paper_doi = f"DOI:https://doi.org/{doi}" if not doi.startswith("DOI:") else doi
                publication = Publication.objects.filter(paper_id=paper_doi)
                if publication.exists():
                    log.info(f"Publication with DOI {paper_doi} already exists.")
                    publication = publication.first()
                else:
                    log.info(f"Searching for publication with DOI {paper_doi}")
                    publication = sch_engine.find_by_doi(doi)
                    if publication is None:
                        return JsonResponse({ "Not found": f"Publication with DOI '{doi}' not found." }, status=HTTP_400_BAD_REQUEST)
                    publication.save()

                publication_results.append(publication)
            return JsonResponse({ "publications": [pub.to_dict() for pub in publication_results] })
        return JsonResponse(serializer.errors, status=HTTP_400_BAD_REQUEST)


class SearchStringDifferenceView(APIView):

    @Controller
    def post(self, request):
        """
        Get the difference of search results between multiple search strings.
        """
        serializer = SearchStringDifferenceSerializer(data=request.data)
        if not serializer.is_valid():
            return JsonResponse(serializer.errors, status=HTTP_400_BAD_REQUEST)

        query_data        = serializer.validated_data['search_terms']
        show_publication  = serializer.validated_data['show_publication']
        show_metadata     = serializer.validated_data['show_metadata']
        all_queries       = self._generate_all_queries(query_data)

        search_results_dict   = self._retrieve_search_results(all_queries)
        queries_to_paper_ids  = self._aggregate_results(search_results_dict)

        result = self._format_response(queries_to_paper_ids, show_publication, show_metadata)
        return JsonResponse({"results": result})

    def _generate_all_queries(self, query_data: Dict[str, List[str]]) -> List[Tuple]:
        """ Generate all combinations of queries. """
        return list(product(query_data['primary'], query_data['secondary'], query_data['tertiary']))

    def _retrieve_search_results(self, all_queries: List[Tuple]) -> Dict[Tuple, List[str]]:
        """
        Retrieve search results for each query and map them to paper IDs.
        """
        search_results_dict = {}
        for query in all_queries:
            paper_ids = SearchResult.objects.filter(query=query).values_list('paper_id', flat=True)
            if paper_ids:
                search_results_dict[query] = list(paper_ids)
        return search_results_dict

    def _aggregate_results(self, search_results_dict: Dict[Tuple, List[str]]) -> Dict[List[Tuple], List[str]]:
        """
        Aggregate paper IDs and map them to the search strings that produced them.
        """
        paper_id_to_queries = {}
        for search_string, paper_ids in search_results_dict.items():
            for paper_id in paper_ids:
                if paper_id not in paper_id_to_queries:
                    paper_id_to_queries[paper_id] = []
                if search_string not in paper_id_to_queries[paper_id]:
                    paper_id_to_queries[paper_id].append(search_string)

        queries_to_paper_ids = {}
        for paper_id, queries in paper_id_to_queries.items():
            if tuple(queries) not in queries_to_paper_ids:
                queries_to_paper_ids[tuple(queries)] = []
            queries_to_paper_ids[tuple(queries)].append(paper_id)

        return queries_to_paper_ids

    def _format_response(self, queries_to_paper_ids: Dict[List[Tuple], List[str]], show_publication: bool, show_metadata: bool):
        """
        Format the response to include search strings and their corresponding paper IDs.
        """
        result = [
            {
                'search_strings': search_strings,
                'num_results': len(paper_ids),
                'search_results': self._get_search_results(paper_ids, show_publication, show_metadata)
            }
            for search_strings, paper_ids in queries_to_paper_ids.items()
        ]
        return result

    def _get_search_results(self, paper_ids: List[str], show_publication: bool, show_metadata: bool):
        """
        Get the search results for a list of paper IDs.
        """
        publications  = Publication.objects.filter(paper_id__in=paper_ids)
        metadata      = PublicationMetadata.objects.filter(publication__in=publications)

        if show_metadata and show_publication:
            metadata_by_id   = {pub_metadata.publication.paper_id: pub_metadata for pub_metadata in metadata}
            publication_data = []
            for pub in publications:
                data = pub.to_dict()
                if pub_metadata := metadata_by_id.get(pub.paper_id):
                    data = {
                      **data,
                      **pub_metadata.to_dict(show_publication=False)
                    }
                publication_data.append(data)
            return publication_data

        if show_publication:
            return [pub.to_dict() for pub in publications]
        return paper_ids

class HistoricalSearchQueryResultsView(APIView):

    @Controller
    def get(self, request):
        """
        Get historical search query results based on search id
        """
        search_id = request.query_params.get('id')
        if search_id is None:
            return JsonResponse({ "error": "Search ID is required." }, status=HTTP_400_BAD_REQUEST)

        search_results = get_object_or_404(SearchResponse, id=search_id)
        return JsonResponse(search_results.to_dict())

class SearchHistoryListView(APIView):

    @Controller
    def get(self, request):
        """
        List past searches ordered from newest to oldest.
        """
        history = SearchResponse.objects.all().order_by('-timestamp').values('id', 'query', 'timestamp')
        return JsonResponse({
            "history": list(history)
        })

class SearchHistoryPublicationView(APIView):

    @Controller
    def post(self, request):
        """
        Create a new search history entry given a list of papers.
        """
        search_results = SearchResponse(
            query=request.data.get('query', {
                "start_date": datetime.now().isoformat(),
                "end_date": datetime.now().isoformat(),
                "search_terms": [],
                "advanced_search": "",
                "sources": [],
            }),
            variations=request.data.get('variations', []),
            matches=request.data.get('matches', []),
            results=request.data.get('papers', []),
        )
        log.info("New search history entry: %s", search_results.to_dict())
        search_results.save()
        return JsonResponse(search_results.to_dict())

    @Controller
    def put(self, request):
        """
        Update the search history with additional new search results.
        """
        search_id = request.query_params.get('search_reference_id')
        paper_data = request.data.get('papers', [])

        log.info(f"{search_id}, {paper_data}")

        if search_id is None:
            return JsonResponse({ "error": "Search ID is required." }, status=HTTP_400_BAD_REQUEST)
        if paper_data is None:
            return JsonResponse({ "error": "Paper data is required." }, status=HTTP_400_BAD_REQUEST)

        search_results = get_object_or_404(SearchResponse, id=search_id)
        search_results.results.extend(paper_data)
        search_results.save()

        log.info(f"Updated search results for paper IDs: {search_results.results}")

        return JsonResponse({ "message": "Search results updated successfully." })

    @Controller
    def delete(self, request):
        """
        Delete a publication from the search history.
        """
        search_id = request.query_params.get('search_reference_id')
        paper_ids = request.query_params.get('paper_ids')
        paper_ids = paper_ids.split(',') if paper_ids else []

        if search_id is None:
            return JsonResponse({ "error": "Search ID is required." }, status=HTTP_400_BAD_REQUEST)

        search_results = get_object_or_404(SearchResponse, id=search_id)
        search_results.results = [result for result in search_results.results if result['paper_id'] not in paper_ids]
        search_results.save()

        log.info(f"Deleted search results for paper IDs: {search_results.results}")

        return JsonResponse({ "message": "Search results deleted successfully." })