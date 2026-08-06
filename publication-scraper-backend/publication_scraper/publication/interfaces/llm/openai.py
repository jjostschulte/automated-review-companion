import environ
import json
from utils import Logger
import time
from typing import Dict, Any, Optional
from openai import OpenAI
from pydantic import BaseModel

env = environ.Env()
environ.Env.read_env()

log = Logger(__name__)

class OpenAIError(Exception):
    """Custom exception for OpenAI-related errors"""
    def __init__(self, message: str, raw_response: Optional[str] = None):
        super().__init__(message)
        self.raw_response = raw_response

class OpenAILLM:
    def __init__(self):
        self.client: OpenAI = None
        self.API_KEY = env('OPENAI_API_KEY')
        self.BASE_URL = env('OPENAI_BASE_URL', default=None)
        self.MODEL = env('OPENAI_MODEL', default='gpt-5.5')
        self.init_client()
        self.max_retries = 3
        self.retry_delay = 1  # seconds

    def init_client(self):
        client_kwargs = {"api_key": self.API_KEY}
        if self.BASE_URL:
            client_kwargs["base_url"] = self.BASE_URL
        self.client = OpenAI(**client_kwargs)

    def _validate_json_structure(self, content: str, response_model: BaseModel) -> Dict[str, Any]:
        """Validate and process JSON response"""
        try:
            # Parse and preprocess the JSON
            parsed_json = json.loads(content)
            
            # Recursively ensure all values are strings
            def stringify_values(obj):
                if isinstance(obj, dict):
                    return {k: stringify_values(v) for k, v in obj.items()}
                elif isinstance(obj, list):
                    return [stringify_values(item) for item in obj]
                elif obj is None:
                    return ""
                else:
                    return str(obj)
            
            processed_json = stringify_values(parsed_json)
            
            # Validate with the model
            result = response_model.model_validate(processed_json)
            return result.model_dump()
            
        except json.JSONDecodeError as e:
            raise OpenAIError(f"Invalid JSON response: {str(e)}", content)
        except Exception as e:
            raise OpenAIError(f"Response validation error: {str(e)}", content)

    def completion(
        self,
        system_prompt: str,
        user_prompt: str,
        response_model: BaseModel,
        model: Optional[str] = None,
        reasoning_effort: str = "medium",
    ) -> Dict[str, Any]:
        retries = 0
        last_error = None
        model_name = model or self.MODEL

        while retries < self.max_retries:
            try:
                json_format_prompt = (
                    "You MUST respond with a valid JSON object that matches this exact structure. "
                    "ALL values must be strings. Numeric values should be converted to strings. "
                    "NULL or missing values should be empty strings. "
                    "Do not include any explanatory text outside the JSON structure."
                )
                
                full_system_prompt = f"{json_format_prompt}\n\n{system_prompt}"
                
                # Log input prompts
                log.info("LLM Input:")
                log.info(f"System prompt: {full_system_prompt}")
                log.info(f"User prompt: {user_prompt}")
                log.info(f"Model: {model_name} (reasoning effort: {reasoning_effort})")

                response = self.client.chat.completions.create(
                    model=model_name,
                    reasoning_effort=reasoning_effort,
                    messages=[
                        {"role": "system", "content": full_system_prompt},
                        {"role": "user", "content": user_prompt}
                    ],
                    response_format={"type": "json_object"},
                )
                
                content = response.choices[0].message.content.strip()
                # Log the raw output
                log.info(f"LLM Raw Output: {content}")
                log.debug(f"Raw OpenAI response (attempt {retries + 1}): {content}")
                
                validated_response = self._validate_json_structure(content, response_model)
                # Log the validated output
                log.info(f"LLM Validated Output: {json.dumps(validated_response, indent=2)}")
                
                return validated_response
                
            except OpenAIError as e:
                last_error = str(e)
                log.error(f"Attempt {retries + 1} failed: {last_error}")
                log.debug(f"Raw response: {e.raw_response}")
            
            except Exception as e:
                last_error = str(e)
                log.error(f"Attempt {retries + 1} failed: {last_error}")
            
            retries += 1
            if retries < self.max_retries:
                time.sleep(self.retry_delay * retries)
        
        raise OpenAIError(f"Failed after {self.max_retries} attempts. Last error: {last_error}")
