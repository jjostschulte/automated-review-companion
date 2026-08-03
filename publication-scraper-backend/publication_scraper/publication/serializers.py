from rest_framework import serializers
from scraping.serializers.core_serializers import QuerySerializer


class PublicationSnowballingSerializer(serializers.Serializer):
  SEARCH_CHOICES = (
    ('forward', 'Forward'),
    ('backward', 'Backward'),
  )
  publication_ids = serializers.ListField(child=serializers.CharField())
  search_type = serializers.ChoiceField(choices=SEARCH_CHOICES, default='forward')
  show_metadata = serializers.BooleanField(default=False)
  
class PublicationValidationSerializer(serializers.Serializer):

  query = QuerySerializer(default={
    "primary": [],
    "secondary": [],
    "tertiary": []
  })

class LLMFilterQuestionSerializer(serializers.Serializer):
  
    id = serializers.IntegerField()
    question = serializers.CharField()
    answer = serializers.CharField()

class LLMFilterUserResponseSerializer(serializers.Serializer):
    
    id = serializers.IntegerField()
    answer = serializers.CharField()
    rationale = serializers.CharField(default="", allow_blank=True)

class LLMFilterUserAnswerSerializer(serializers.Serializer):
   
    paper_id = serializers.CharField()
    responses = serializers.ListField(child=LLMFilterUserResponseSerializer())

class LLMFilterOptionsSerializer(serializers.Serializer):
    includeExamples = serializers.BooleanField(default=False)
    includeRationale = serializers.BooleanField(default=False)

class PublicationLLMFilterSerializer(serializers.Serializer):

    questions = serializers.ListField(child=LLMFilterQuestionSerializer())
    paper_ids = serializers.ListField(child=serializers.CharField(), default=[])
    answers = serializers.ListField(child=LLMFilterUserAnswerSerializer(), default=[])
    options = LLMFilterOptionsSerializer(required=False, default={})
    progress_id = serializers.CharField(required=False, allow_blank=True, default="")
    search_reference_id = serializers.CharField(required=False, allow_blank=True, default="")
