import json
from typing import Callable, Dict, List, Tuple, Union, Optional, Any
from pydantic import BaseModel, Field, field_validator
from publication.interfaces.llm.openai import OpenAILLM
from publication.models import Publication, PublicationMetadata
from utils import Logger

log = Logger(__name__)

class FilterResponse(BaseModel):
    id: Union[str, int] = Field(...)
    question: str = Field(...)
    answer: str = Field(...)
    rationale: str = Field(default="No rationale provided")

    @field_validator("id")
    def validate_id(cls, v):
        if isinstance(v, int):
            return str(v)
        return v

class FilterAnswer(BaseModel):
    id: Union[str, int] = Field(...)
    answer: str = Field(...)
    rationale: str = Field(...)

    @field_validator("id")
    def validate_id(cls, v):
        if isinstance(v, int):
            return str(v)
        return v

class FilterAnswerExamples(BaseModel):
    paper_id: Union[str, int] = Field(...)
    responses: List[FilterAnswer] = Field(default_factory=list)

    @field_validator("paper_id")
    def validate_paper_id(cls, v):
        if isinstance(v, int):
            return str(v)
        return v

class LLMFilterResponse(BaseModel):
    paper_id: Union[str, int] = Field(...)
    responses: List[FilterResponse] = Field(default_factory=list)

    @field_validator("paper_id")
    def validate_paper_id(cls, v):
        if isinstance(v, int):
            return str(v)
        return v

class LLMFilter:
    def __init__(self, progress_callback: Optional[Callable[[Dict[str, Any]], None]] = None):
        self.model = OpenAILLM()
        self.results: List[LLMFilterResponse] = []
        self.progress_callback = progress_callback

    def parse(
        self, 
        paper_data: List[Union[Publication, PublicationMetadata]], 
        qna: List[FilterResponse],
        examples: List[FilterAnswerExamples] = [],
        include_rationale: bool = False,
        include_examples: bool = False
    ) -> None:
        self.include_rationale = include_rationale
        self.include_examples  = include_examples

        self.raw_papers         = paper_data
        self.paper_data         = self._parse_paper_data(paper_data)
        self.qna                = self._parse_qna(qna)
         
        if self.include_examples or examples == []:
            self.examples = self._parse_examples(examples)
            self.example_paper_ids  = [example.paper_id for example in examples]
        else:
            self.examples = ""
            self.example_paper_ids  = []

        self.init_prompt()

    def init_prompt(self):
        self.prompt = (
            "You are provided with an academic publication's detailed information along with its metadata. "
            "Your task is to carefully analyze the data and accurately answer the following questions. "
            "Review the provided publication metadata, especially the title and abstract, to determine the best answer."
            " If no abstract is available, the answer should be 'No abstract available'."
        )
        
        if self.include_rationale:
            self.prompt += " Provide detailed justification and rationale for your selected answers, referencing specific parts/phrase of the metadata where appropriate."
        else:
            self.prompt += " Provide concise and clear answers based strictly on the provided information."
        
        self.prompt += (
            "\n\nInstructions: For each question, select one of the comma-separated possible answers. "
            "Ensure that your choice is fully supported by the details in the publication data."
        )

        self.prompt += "\n\nQuestions:\n{qna}"

        if self.include_examples:
            self.prompt += "\n\nExamples:\n{examples}"
            
        self.prompt += "\n\nPublication Data:\n{paper_data}"
        self.prompt += "\n\nOutput Format:\n{format_instructions}"

    def completion(self):
        """ Complete the LLM filter """
        papers_to_process = [
            (pid, paper)
            for pid, paper in self.paper_data
            if pid not in self.example_paper_ids
        ]
        total = len(papers_to_process)
        completed = 0
        if self.progress_callback:
            self.progress_callback({
                "completed": completed,
                "total": total,
                "current_paper_id": "",
                "status": "running",
            })
        for pid, paper in papers_to_process:
            if self.progress_callback:
                self.progress_callback({
                    "completed": completed,
                    "total": total,
                    "current_paper_id": pid,
                    "status": "running",
                })
            self._complete_llm_filter(pid, paper)
            completed += 1
            if self.progress_callback:
                self.progress_callback({
                    "completed": completed,
                    "total": total,
                    "current_paper_id": pid,
                    "status": "running",
                })
        return self.results
    

    def _complete_llm_filter(self, paper_id: str, paper_data: str):
        """Complete the LLM filter for a single paper"""
        assert self.paper_data, "Paper data is required"
        assert self.qna, "QnA is required"

        self.invocation_variables = {"paper_data": paper_data, "qna": self.qna}
        if self.include_examples:
            self.invocation_variables["examples"] = self.examples

        system_prompt = (
            "You are analyzing academic publication data. Your task is to answer specific questions about the publication.\n"
            "The response MUST be a valid JSON object with this exact structure and all fields are required:\n"
            "{\n"
            '  "paper_id": "1234",  // Paper ID as string\n'
            '  "responses": [       // Array of responses\n'
            "    {\n"
            '      "id": "1",       // Question ID as string\n'
            '      "question": "What is the main topic?",  // Question text\n'
            '      "answer": "Machine Learning",          // Your answer\n'
            '      "rationale": "Based on the abstract..." // Your reasoning\n'
            "    }\n"
            "  ]\n"
            "}\n\n"
            "REQUIREMENTS:\n"
            "1. ALL fields are required\n"
            "2. ALL values must be strings\n"
            "3. Empty or missing fields are not allowed\n"
            "4. If unsure about a rationale, explain why you're uncertain"
        )
        
        user_prompt = ""
        for key, value in self.invocation_variables.items():
            user_prompt += f"\n\n{key.upper()}:\n{value}"

        try:
            response = self.model.completion(
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                response_model=LLMFilterResponse,
            )
            
            # Ensure responses are properly formatted with string IDs and required fields
            result = LLMFilterResponse(
                paper_id=str(paper_id),
                responses=[
                    FilterResponse(
                        id=str(r.get("id", "")),
                        question=str(r.get("question", "Unknown question")),
                        answer=str(r.get("answer", "No answer provided")),
                        rationale=str(r.get("rationale", "No rationale provided"))
                    ) for r in response.get("responses", [])
                ]
            )
            
            # Validate that we have at least one response
            if not result.responses:
                log.warning(f"No responses generated for paper: {paper_id}")
                result.responses = [
                    FilterResponse(
                        id="1",
                        question="Error",
                        answer="No valid response generated",
                        rationale="The model failed to generate a valid response structure"
                    )
                ]
            
            self.results.append(result)
            log.info(f"Completed LLM filter for paper: {paper_id}")
            
        except Exception as e:
            log.error(f"Error completing LLM filter: {str(e)}")
            raise

    def _parse_paper_data(self, paper_data: List[Union[PublicationMetadata, Publication]]) -> List[Tuple[str, str]]:
        """ 
        Parse the publication & metadata in the format:
        - field_name: field_value

        Returns a list of tuples with 
        1. publication_id and the 
        2. formatted paper data
        """
        all_paper_data = []
        for paper in paper_data:
            if isinstance(paper, PublicationMetadata):
                paper_data_dict = paper.to_dict(show_publication=True)
                paper_id = paper.publication_id
            else:
                paper_data_dict = paper.to_dict()
                paper_id = paper.paper_id
            paper_data_str = "\n".join([f"{field}: {value}" for field, value in paper_data_dict.items()])
            all_paper_data.append((paper_id, paper_data_str))
        return all_paper_data
        
    def _parse_qna(self, qna: List[FilterResponse]):
        """ 
        Parse the question and answers in the format:
        
            id: number
            question: question
            answer: possible list of answers, separated by a comma
        """
        qna_str = "\n".join([f"{qa.id}: {qa.question} | Possible Answers: {qa.answer}" for qa in qna])
        return qna_str
    
    def _parse_examples(self, examples: List[FilterAnswerExamples]) -> str:
        """ 
        Parse the examples in the format:
        
            paper_id: paper_id
            responses: 
                - id: number
                - answer: possible list of answers, separated by a comma
                - rationale: rationale for the answer
        """
        self.raw_papers: List[Union[Publication, PublicationMetadata]]
        examples_str = ""
        for index, example in enumerate(examples):
            examples_str += f"\n\nExample {index + 1}:\n"
            paper = None
            
            for p in self.raw_papers:
                if isinstance(p, PublicationMetadata):
                    if p.publication_id == example.paper_id:
                        paper = p
                        break
                else:
                    if p.paper_id == example.paper_id:
                        paper = p
                        break
            if paper:
                paper_data_dict = paper.to_dict(show_publication=True)
                paper_id = paper.publication_id
            else:
                paper_data_dict = paper.to_dict()
                paper_id = paper.paper_id
            examples_str += "\n".join([f"{field}: {value}" for field, value in paper_data_dict.items()])
            
            if not self.include_rationale:
                examples_str += "\n".join([f"\nQuestion {response.id}: {response.answer}" for response in example.responses])
            else:
                examples_str += "\n".join([f"\nQuestion {response.id}: {response.answer} | Rationale: {response.rationale}" for response in example.responses])
            example.paper_id = paper_id
        log.info(examples_str)
        return examples_str
