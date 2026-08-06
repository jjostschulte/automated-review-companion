import uuid
from enum import Enum
from django.db import models

class SearchEngineType(str, Enum):
    DBLP = "DBLP"
    SEMANTIC_SCHOLAR = "SEMANTIC_SCHOLAR"
    WEB_OF_SCIENCE = "WEB_OF_SCIENCE"
    IEEE_XPLORE = "IEEE_XPLORE"
    SCOPUS = "SCOPUS"
    
    def get_choices():
      return [
        (search_engine_type.name, search_engine_type.value) 
        for search_engine_type in SearchEngineType
      ]

class SearchResult(models.Model):
    query         = models.CharField(max_length=200)
    search_engine = models.CharField(max_length=200, choices=SearchEngineType.get_choices())
    paper_id      = models.CharField(max_length=200)
    timestamp     = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.search_engine} - {self.query}"

class SearchResponse(models.Model):
    """
    id - Auto-generated UUID field
    query - SearchQuery object
    variations - JSON field containing the variations of the search query
    matches - JSON field containing the matches of the search query
    timestamp - DateTime field containing the timestamp of the search query
    results - list of publication data objects
    """
    id          = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    query       = models.JSONField()
    variations  = models.JSONField()
    matches     = models.JSONField()
    results     = models.JSONField()
    llm_questions = models.JSONField(default=list)
    llm_answers    = models.JSONField(default=list)
    timestamp   = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.id} - {self.timestamp}"
    
    def to_dict(self):
        return {
            "id": self.id,
            "query": self.query,
            "variations": self.variations,
            "matches": self.matches,
            "results": self.results,
            "llm_questions": self.llm_questions,
            "llm_answers": self.llm_answers,
            "timestamp": self.timestamp
        }