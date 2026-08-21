import io
import datetime
import pandas as pd
from itertools import product
from typing import List

from django.core.cache import cache
from django.http import JsonResponse
from rest_framework.status import HTTP_400_BAD_REQUEST
from rest_framework.views import APIView
from utils import Logger, Controller
from rest_framework.parsers import MultiPartParser, FormParser
from scraping.domain import SemanticScholarEngine
from scraping.interfaces.extract_metadata import PublicationMetadataExtractor

from .interfaces.backward_search import BackwardSearch
from .interfaces.filter.llm_filter import FilterResponse, LLMFilter, FilterAnswerExamples, FilterAnswer
from .interfaces.forward_search import ForwardSearch
from .interfaces.validation import PublicationValidator
from .models import Publication, PublicationMetadata, PublicationLLMUsage
from scraping.models import SearchResponse
from .serializers import (
    PublicationLLMFilterSerializer,
    PublicationSnowballingSerializer,
    PublicationValidationSerializer,
)


log = Logger(__name__)

class PublicationSnowballingView(APIView):
    
    @Controller
    def post(self, request):
        serializer = PublicationSnowballingSerializer(data=request.data)
        if serializer.is_valid():
            
            publication_ids = serializer.validated_data.get('publication_ids')  
            search_type = serializer.validated_data.get('search_type')
            show_metadata = serializer.validated_data.get('show_metadata')
            publications = Publication.objects.filter(paper_id__in=publication_ids)

            log.info(f"Snowballing {search_type} search for {len(publications)} publications.")
            
            if search_type == 'forward':
                fs = ForwardSearch(publications, show_metadata=show_metadata)
                results = fs.search()

            elif search_type == 'backward':
                bs = BackwardSearch(publications, show_metadata=show_metadata)
                results = bs.search()
                
            return JsonResponse({ "results": results})
        return JsonResponse(serializer.errors, status=HTTP_400_BAD_REQUEST)


class PublicationValidationView(APIView):

    @Controller
    def post(self, request):
        serializer = PublicationValidationSerializer(data=request.data)
        if serializer.is_valid():

            query = serializer.validated_data['query']
            all_queries = list(product(query['primary'], query['secondary'], query['tertiary']))
            
            validator = PublicationValidator()
            validated_results = validator.validate(all_queries)
            
            return JsonResponse(validated_results)
        return JsonResponse(serializer.errors, status=HTTP_400_BAD_REQUEST)


class PublicationLLMFilterView(APIView):
    progress_cache_timeout = 60 * 60

    @staticmethod
    def _progress_cache_key(progress_id):
        return f"llm_filter_progress:{progress_id}"

    def _serialize_filter_results(self, results):
        """Helper method to serialize filter results"""
        return [result.dict() if hasattr(result, 'dict') else result for result in results]

    def get(self, request, progress_id=None):
        if not progress_id:
            return JsonResponse({"error": "progress_id is required"}, status=HTTP_400_BAD_REQUEST)

        progress = cache.get(self._progress_cache_key(progress_id))
        if not progress:
            return JsonResponse({
                "completed": 0,
                "total": 0,
                "current_paper_id": "",
                "status": "unknown",
            })
        return JsonResponse(progress)

    # @Controller
    def post(self, request):

        serializer = PublicationLLMFilterSerializer(data=request.data)
        if serializer.is_valid():

            includeExamples: bool = False
            includeRationale: bool = False
            examples: List[FilterAnswerExamples] = []

            questions = serializer.validated_data['questions']
            questions_payload = list(questions)
            paper_ids = serializer.validated_data.get('paper_ids')
            answers = serializer.validated_data.get('answers')
            options = serializer.validated_data.get('options')
            progress_id = serializer.validated_data.get('progress_id')
            search_reference_id = serializer.validated_data.get('search_reference_id')

            def update_progress(progress):
                if progress_id:
                    cache.set(
                        self._progress_cache_key(progress_id),
                        progress,
                        timeout=self.progress_cache_timeout,
                    )

            if progress_id:
                update_progress({
                    "completed": 0,
                    "total": len(paper_ids or []),
                    "current_paper_id": "",
                    "status": "queued",
                })

            validity = self.check_for_validity(request, paper_ids)
            if validity:
                log.error(f"LLM filter error: {validity}")
                return JsonResponse({ "Max attempts reached" : validity }, status=HTTP_400_BAD_REQUEST)

            if options:
                includeExamples = options.get('includeExamples', False)
                includeRationale = options.get('includeRationale', False)

            # Remove paper_ids that are in answers
            for paper in answers:
                examples = [
                    FilterAnswerExamples(
                        paper_id = paper['paper_id'],
                        responses = [
                            FilterAnswer(
                                id       = response['id'],
                                answer   = response['answer'],
                                rationale = response['rationale']
                            ) for response in paper['responses']
                        ] 
                    ) for paper in answers
                ]
                log.info(f"LLM filter example: {paper}.")

            # Data transformation
            publications = list(PublicationMetadata.objects.filter(publication_id__in=paper_ids))
            log.info(f"Filtering {len(publications)} publications.")
            if len(publications) != len(paper_ids):
                missing_papers = set(paper_ids) - set([p.publication_id for p in publications])
                missing_publications = Publication.objects.filter(paper_id__in=missing_papers)
                publications.extend(missing_publications)
            
            questions = [
                FilterResponse(
                    id       = question['id'],
                    question = question['question'],
                    answer   = question['answer']
                ) for question in questions
            ]

            # Filter publications by questions
            llm_filter = LLMFilter(progress_callback=update_progress if progress_id else None)
            llm_filter.parse(publications, questions, examples, includeRationale, includeExamples)
            try:
                results = llm_filter.completion()
            except Exception:
                update_progress({
                    "completed": 0,
                    "total": len(publications),
                    "current_paper_id": "",
                    "status": "failed",
                })
                raise
            
            if includeExamples:
                results = [*answers, *results]
                
            serialized_results = self._serialize_filter_results(results)
            if search_reference_id:
                search_response = SearchResponse.objects.filter(id=search_reference_id).first()
                if search_response:
                    response_by_paper_id = {
                        result['paper_id']: result.get('responses', [])
                        for result in serialized_results
                        if result.get('paper_id')
                    }
                    updated_results = []
                    for result in search_response.results:
                        paper_id = result.get('paper_id')
                        if paper_id in response_by_paper_id:
                            updated_result = {
                                **result,
                                "llm_responses": response_by_paper_id[paper_id],
                            }
                            updated_results.append(updated_result)
                        else:
                            updated_results.append(result)

                    search_response.results = updated_results
                    search_response.llm_questions = questions_payload
                    search_response.llm_answers = self._serialize_filter_results(answers)
                    search_response.save()
            update_progress({
                "completed": len(results) - len(answers) if includeExamples else len(results),
                "total": len(publications) - len(answers) if includeExamples else len(publications),
                "current_paper_id": "",
                "status": "completed",
            })
            return JsonResponse({ "results": serialized_results })
        return JsonResponse(serializer.errors, status=HTTP_400_BAD_REQUEST)
    


    @staticmethod
    def _get_client_ip(request):
        """ Resolve the caller IP, honouring proxy headers set by Cloud Run / load balancers. """
        forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR', '')
        if forwarded_for:
            return forwarded_for.split(',')[0].strip()
        return request.META.get('REMOTE_ADDR') or 'unknown'

    def check_for_validity(self, request, paper_ids):
        """
        Enforces the daily per-IP cap on papers submitted to the LLM filter.
        Returns an error message when the cap is exceeded, otherwise records the usage.
        """
        from django.conf import settings
        max_calls = getattr(settings, 'MAX_LLM_CALL_COUNT', 300)
        ip = self._get_client_ip(request)

        # Treat non-positive values as "no limit" — useful for local LLM deployments.
        if isinstance(max_calls, int) and max_calls <= 0:
            log.info(f"LLM usage cap disabled (MAX_LLM_CALL_COUNT={max_calls}). Allowing requests from {ip}.")
            return None

        today = datetime.date.today()
        usage = PublicationLLMUsage.objects.filter(ip_address=ip, date=today).first()
        if not usage:
            usage = PublicationLLMUsage(ip_address=ip, date=today)

        if usage.count + len(paper_ids) > max_calls:
            log.warning(f"LLM usage limit hit for {ip}: {usage.count}+{len(paper_ids)} > {max_calls}")
            return f"You have reached the maximum number of papers that can be filtered per day ({max_calls}). Please try again tomorrow."

        usage.count += len(paper_ids)
        usage.save()
        log.info(f"LLM usage for {ip}: {usage.count}/{max_calls}")

class PublicationUploadView(APIView):
    parser_classes = (MultiPartParser, FormParser)

    @Controller
    def post(self, request):
        """
        Process a CSV file containing DOIs, add the papers and populate their metadata.
        Searches from Semantic Scholar directly and populates metadata immediately.
        """
        file = request.FILES.get("file")

        if not file:
            return JsonResponse({"error": "No file provided"}, status=HTTP_400_BAD_REQUEST)
        
        if not file.name.endswith(".csv"):
            return JsonResponse({"error": "Invalid file type. Please upload a CSV file."}, status=HTTP_400_BAD_REQUEST)
        
        try:
            df = pd.read_csv(io.StringIO(file.read().decode('utf-8')))
        except Exception as e:
            return JsonResponse({"error": str(e)}, status=HTTP_400_BAD_REQUEST)
        
        if "DOI" not in df.columns:
            return JsonResponse({"error": "CSV file must contain a 'DOI' column."}, status=HTTP_400_BAD_REQUEST)
        
        dois = df["DOI"].dropna().astype(str).tolist()
        
        # Use SemanticScholar to search for papers
        sch_engine = SemanticScholarEngine()
        publication_results = []
        failed_dois = []
        
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
                    log.error(f"Publication with DOI '{doi}' not found.")
                    failed_dois.append(doi)
                    continue
                publication.save()
            
            publication_results.append(publication)

        # Now use PublicationMetadataExtractor to populate metadata for all found publications
        if publication_results:
            paper_ids = [pub.paper_id for pub in publication_results]
            extractor = PublicationMetadataExtractor(paper_ids)
            metadata = [pub_metadata.to_dict(show_publication=True) for pub_metadata in extractor.extracted_metadata]
            additional_failed = [publication.paper_id for _, publication in extractor.failed_papers]
            failed_dois.extend([doi[4:] for doi in additional_failed]) # Remove DOI: prefix
        else:
            metadata = []
        
        return JsonResponse({
            "publications": metadata,  # Now returns publications with metadata
            "failed_dois": failed_dois,
            "total_processed": len(dois),
            "total_success": len(publication_results)
        })
