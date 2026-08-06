import csv
import io
from typing import List

from django.http import HttpResponse
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.views import APIView

from publication.models import Publication
from scraping.filters import PublicationFilter
from scraping.models import SearchResponse
from scraping.infrastructure.data_export import (
    BibtexExporter,
    CsvExporter,
    DataExporter,
    ExportType,
    RisExporter,
)
from utils import Controller


class ExportView(APIView):

    filter_backends = [DjangoFilterBackend]
    filterset_class = PublicationFilter
    
    @Controller
    def post(self, request):
        """ Export the publications based on the given filters. """
        
        export_format = request.data.get('format', ExportType.CSV.value)
        paper_ids = request.data.get('paper_ids', [])
        search_reference_id = request.data.get('search_reference_id')
        if isinstance(paper_ids, str):
            paper_ids = paper_ids.split(',')

        if export_format == ExportType.CSV.value and search_reference_id:
            search_response = SearchResponse.objects.filter(id=search_reference_id).first()
            if search_response:
                csv_content = self.build_csv_from_search_response(search_response, paper_ids)
                response = HttpResponse(csv_content, content_type='text/csv')
                response['Content-Disposition'] = 'attachment; filename="publications.csv"'
                response["Access-Control-Expose-Headers"] = "Content-Type, Content-Disposition"
                return response

        # Apply filters
        # filter_backend = DjangoFilterBackend()
        # filter_backend.request = request
        # publications = filter_backend.filter_queryset(request, Publication.objects.all(), self)
        # publications = list(publications)
        publications = Publication.objects.filter(paper_id__in=paper_ids)
        publications = list(publications)
        
        exporter = self.get_exporter(export_format)
        exporter.export(publications)
        
        response = HttpResponse(exporter.exported_data, content_type=exporter.content_type)
        response['Content-Disposition']           = f'attachment; filename="publications.{exporter.file_extension}"'
        response["Access-Control-Expose-Headers"] = "Content-Type, Content-Disposition"
        return response

    def build_csv_from_search_response(self, search_response: SearchResponse, paper_ids: List[str]) -> str:
        paper_id_set = set(paper_ids)
        selected_results = [
            result
            for result in search_response.results
            if result.get('paper_id') in paper_id_set
        ]
        if not selected_results:
            return ""

        llm_questions = search_response.llm_questions or []
        llm_headers = []
        for question in llm_questions:
            question_id = str(question.get('id', '')).strip()
            if not question_id:
                continue
            llm_headers.extend([
                f"llm_q{question_id}_question",
                f"llm_q{question_id}_answer",
                f"llm_q{question_id}_rationale",
            ])

        rows = []
        for result in selected_results:
            row = dict(result)
            llm_responses = row.get('llm_responses') or []
            if not isinstance(llm_responses, list):
                llm_responses = []
            responses_by_id = {
                str(response.get('id', '')).strip(): response
                for response in llm_responses
                if isinstance(response, dict)
            }
            for question in llm_questions:
                question_id = str(question.get('id', '')).strip()
                if not question_id:
                    continue
                response = responses_by_id.get(question_id, {})
                row[f"llm_q{question_id}_question"] = question.get('question', '')
                row[f"llm_q{question_id}_answer"] = response.get('answer', '')
                row[f"llm_q{question_id}_rationale"] = response.get('rationale', '')
            rows.append(row)

        headers = list(rows[0].keys())
        for row in rows[1:]:
            for key in row.keys():
                if key not in headers:
                    headers.append(key)
        for llm_header in llm_headers:
            if llm_header not in headers:
                headers.append(llm_header)

        output = io.StringIO()
        writer = csv.DictWriter(
            output,
            fieldnames=headers,
            extrasaction='ignore',
            quoting=csv.QUOTE_ALL,
        )
        writer.writeheader()
        for row in rows:
            writer.writerow(row)
        return output.getvalue()
      
    def get_exporter(self, format: str) -> DataExporter:
        """
        Get the exporter based on the given format.
        
        :param format (str): The format to be used.
        :rettype DataExporter: The exporter to be used.
        """
        
        if format == ExportType.CSV.value:
            return CsvExporter()
        elif format == ExportType.BIBTEX.value:
            return BibtexExporter()
        elif format == ExportType.RIS.value:
            return RisExporter()
          
        raise ValueError(f"Unsupported format: {format}")        
