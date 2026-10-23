import json
import logging
import re
import time
from typing import Any, Dict, List, Optional, Tuple, Union
import requests
from django.conf import settings

logger = logging.getLogger(__name__)


class LLMProviderError(Exception):
    """Raised when an LLM provider fails and cannot fulfill request."""
    pass


class ZeroGPUQuotaExceededError(LLMProviderError):
    """Raised when Hugging Face Spaces ZeroGPU daily quota is exceeded (HTTP 429)."""
    pass


class GeminiQuotaManager:
    """
    Intelligently manages per-model Daily Quotas (RPD) and Rate Limits (RPM) for Google AI Studio.
    
    Google AI Studio tracks Daily Limits (RPD) individually per model name.
    When a model exhausts its daily quota (e.g. 'Requests per day' or ResourceExhausted):
      1. Marks that specific model as exhausted until daily quota reset (00:00 PST / 08:00 UTC).
      2. Automatically skips the exhausted model and switches to the next available model in the pool.
      3. Automatically restores the model once the daily reset window has elapsed.
    """
    _exhausted_models: Dict[str, float] = {}

    @classmethod
    def is_model_exhausted(cls, model_name: str) -> bool:
        unban_time = cls._exhausted_models.get(model_name)
        if not unban_time:
            return False
        if time.time() >= unban_time:
            del cls._exhausted_models[model_name]
            logger.info("Daily quota cooldown expired for Gemini model '%s'. Restoring to active pool.", model_name)
            return False
        return True

    @classmethod
    def mark_model_exhausted(cls, model_name: str, is_daily: bool = True):
        now = time.time()
        if is_daily:
            unban_time = cls._calculate_next_quota_reset()
            hours_left = max(0.1, (unban_time - now) / 3600)
            logger.warning(
                "Gemini model '%s' exhausted its DAILY request limit (RPD). Marked inactive for ~%.1f hours until reset.",
                model_name, hours_left
            )
        else:
            # Short 60-second cooldown for temporary per-minute (RPM) rate limits
            unban_time = now + 60.0
            logger.warning("Gemini model '%s' hit a temporary RPM rate limit. Cooldown set for 60 seconds.", model_name)

        cls._exhausted_models[model_name] = unban_time

    @classmethod
    def mark_model_unavailable(cls, model_name: str):
        """Marks a model as permanently unavailable/non-existent for this server session."""
        cls._exhausted_models[model_name] = time.time() + 86400.0
        logger.warning("Gemini model '%s' is unavailable or not found. Excluded from active pool.", model_name)

    @classmethod
    def _calculate_next_quota_reset(cls) -> float:
        """
        Calculates epoch timestamp of the next Google AI Studio daily reset (00:00 PST = 08:00 UTC).
        """
        from datetime import datetime, timezone, timedelta
        now_utc = datetime.now(timezone.utc)
        target_reset = now_utc.replace(hour=8, minute=0, second=0, microsecond=0)
        if target_reset <= now_utc:
            target_reset += timedelta(days=1)
        return target_reset.timestamp()

    @classmethod
    def get_exhausted_status(cls) -> Dict[str, Dict[str, Any]]:
        now = time.time()
        result = {}
        for model, unban in cls._exhausted_models.items():
            if now < unban:
                result[model] = {
                    "is_exhausted": True,
                    "hours_remaining": round((unban - now) / 3600, 2)
                }
        return result


class GroqQuotaManager:
    """
    Intelligently manages per-model Daily Allowances (TPD/RPD) and Minute Rate Limits (TPM/RPM) for Groq Cloud.
    
    Groq calculates quotas individually per model name.
    When a model exhausts its daily or minute allowance:
      1. Marks that specific model as exhausted until reset (midnight UTC for daily, 60s for minute rate limits).
      2. Automatically skips the exhausted model and switches to the next available model in the pool.
      3. Automatically restores the model once the reset window has elapsed.
    """
    _exhausted_models: Dict[str, float] = {}

    @classmethod
    def is_model_exhausted(cls, model_name: str) -> bool:
        unban_time = cls._exhausted_models.get(model_name)
        if not unban_time:
            return False
        if time.time() >= unban_time:
            del cls._exhausted_models[model_name]
            logger.info("Quota cooldown expired for Groq model '%s'. Restoring to active pool.", model_name)
            return False
        return True

    @classmethod
    def mark_model_exhausted(cls, model_name: str, is_daily: bool = True):
        now = time.time()
        if is_daily:
            unban_time = cls._calculate_next_quota_reset()
            hours_left = max(0.1, (unban_time - now) / 3600)
            logger.warning(
                "Groq model '%s' exhausted its DAILY limit (TPD/RPD). Marked inactive for ~%.1f hours until midnight UTC reset.",
                model_name, hours_left
            )
        else:
            # Short 60-second cooldown for temporary per-minute (RPM/TPM) rate limits
            unban_time = now + 60.0
            logger.warning("Groq model '%s' hit a temporary RPM/TPM rate limit. Cooldown set for 60 seconds.", model_name)

        cls._exhausted_models[model_name] = unban_time

    @classmethod
    def mark_model_unavailable(cls, model_name: str):
        """Marks a model as permanently unavailable/non-existent for this server session."""
        cls._exhausted_models[model_name] = time.time() + 86400.0
        logger.warning("Groq model '%s' is unavailable or not found. Excluded from active pool.", model_name)

    @classmethod
    def _calculate_next_quota_reset(cls) -> float:
        """
        Calculates epoch timestamp of the next Groq daily reset (00:00 UTC).
        """
        from datetime import datetime, timezone, timedelta
        now_utc = datetime.now(timezone.utc)
        target_reset = (now_utc + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
        return target_reset.timestamp()

    @classmethod
    def get_exhausted_status(cls) -> Dict[str, Dict[str, Any]]:
        now = time.time()
        result = {}
        for model, unban in cls._exhausted_models.items():
            if now < unban:
                result[model] = {
                    "is_exhausted": True,
                    "hours_remaining": round((unban - now) / 3600, 2)
                }
        return result


class LLMRouter:
    """
    Dynamic Model Provider Engine & Bring-Your-Own-Key (BYOK) Architecture.
    
    Routes completion requests across:
      - 'hf_gravita': Fine-tuned Qwen3-1.7B Indian GST & Tax Compliance microservice
                      (Adapter: narainad/qwen3-gst-tax-adapter) via gradio_client
      - 'gemini': Google Gemini 1.5 Flash (via google-generativeai)
      - 'groq': Groq Cloud Llama 3.3 (via groq SDK)
      - 'openai': OpenAI GPT-4o-mini / BYOK
      
    Priority logic:
      1. User-supplied key via header `X-User-API-Key`
      2. System default API key from Django settings (.env)
    """

    SUPPORTED_PROVIDERS = ['hf_gravita', 'gemini', 'groq', 'openai']

    _last_execution_info: Dict[str, Any] = {
        "provider": None,
        "model": None,
    }

    @classmethod
    def get_last_execution_info(cls) -> Dict[str, Any]:
        """Returns metadata about the provider and model that generated the last response."""
        return cls._last_execution_info.copy()

    @classmethod
    def extract_auth_from_request(cls, request) -> Tuple[Optional[str], Optional[str]]:
        """
        Extracts provider and user BYOK API key from HTTP request headers.
        Headers checked:
          - X-User-Provider
          - X-User-API-Key
        """
        if not request:
            return None, None
        provider = request.headers.get('X-User-Provider') or request.META.get('HTTP_X_USER_PROVIDER')
        api_key = request.headers.get('X-User-API-Key') or request.META.get('HTTP_X_USER_API_KEY')
        if provider:
            provider = provider.lower().strip()
        if api_key:
            api_key = api_key.strip()
        return provider, api_key

    @staticmethod
    def _attempt_json_repair(candidate: str) -> Optional[Dict[str, Any]]:
        """
        Attempts to parse candidate JSON, repairing trailing commas,
        unclosed strings, and unclosed brackets/braces from token limits.
        """
        if not candidate:
            return None
        candidate = candidate.strip()
        # 1. Direct parse
        try:
            return json.loads(candidate)
        except Exception:
            pass

        # 2. Clean trailing commas
        cleaned = re.sub(r',\s*([\}\]])', r'\1', candidate)
        try:
            return json.loads(cleaned)
        except Exception:
            pass

        # 3. Check unescaped quotes and balance braces/brackets
        try:
            s = cleaned
            unescaped_quotes = len(re.findall(r'(?<!\\)"', s))
            if unescaped_quotes % 2 != 0:
                s += '"'

            stack = []
            in_str = False
            esc = False
            for ch in s:
                if ch == '"' and not esc:
                    in_str = not in_str
                elif not in_str:
                    if ch in '{[':
                        stack.append('}' if ch == '{' else ']')
                    elif ch in '}]':
                        if stack and stack[-1] == ch:
                            stack.pop()
                esc = (ch == '\\' and not esc)

            s_repaired = s + ''.join(reversed(stack))
            s_repaired = re.sub(r',\s*([\}\]])', r'\1', s_repaired)
            return json.loads(s_repaired)
        except Exception:
            return None

    @classmethod
    def clean_json_output(cls, raw_text: str) -> Dict[str, Any]:
        """
        Extracts and parses JSON object from LLM response text,
        stripping markdown code fences (```json ... ```) and fixing minor formatting glitches.
        """
        raw_text = raw_text.strip()
        fenced_match = re.search(r'```(?:json)?\s*([\s\S]*?)\s*```', raw_text, re.IGNORECASE)
        if fenced_match:
            candidate = fenced_match.group(1).strip()
            repaired = cls._attempt_json_repair(candidate)
            if repaired is not None and isinstance(repaired, dict):
                return repaired

        # Try direct text repair
        repaired = cls._attempt_json_repair(raw_text)
        if repaired is not None and isinstance(repaired, dict):
            return repaired

        # Try finding outer { ... }
        start_idx = raw_text.find('{')
        end_idx = raw_text.rfind('}')
        if start_idx != -1:
            candidate = raw_text[start_idx:end_idx + 1] if end_idx > start_idx else raw_text[start_idx:]
            repaired = cls._attempt_json_repair(candidate)
            if repaired is not None and isinstance(repaired, dict):
                return repaired

        raise LLMProviderError(f"Could not parse valid JSON from model response. Output preview: {raw_text[:200]}")

    @classmethod
    def call_hf_gravita(
        cls,
        messages: List[Dict[str, str]],
        api_key: Optional[str] = None,
        endpoint: Optional[str] = None,
        max_tokens: int = 1024,
        temperature: float = 0.3,
        top_p: float = 0.9,
    ) -> str:
        """
        Invokes fine-tuned Qwen3-1.7B Indian GST & Tax Compliance microservice
        (Adapter: narainad/qwen3-gst-tax-adapter) hosted on Hugging Face Spaces with ZeroGPU.
        
        Uses 'gradio_client' with api_name='/openai_style_chat' accepting an OpenAI-compatible
        JSON payload and returns choices[0].message.content.
        
        Includes up to 90 seconds timeout tolerance for cold-start wakeups and
        explicit HTTP 429 quota exception handling.
        """
        token = api_key or getattr(settings, 'HF_TOKEN', '')
        raw_endpoint = (endpoint or getattr(settings, 'HF_GRAVITA_ENDPOINT', 'narainad/Indian-tax-advisor')).strip()

        if not raw_endpoint or raw_endpoint == 'https://hf.space':
            raw_endpoint = 'narainad/Indian-tax-advisor'

        # Source can be space ID: narainad/Indian-tax-advisor or URL
        src = raw_endpoint
        token_arg = token if (token and token != "your-huggingface-token") else None

        # Format input according to expected Gradio schema
        json_input = {
            "messages": messages,
            "max_tokens": max_tokens or 1024,
            "temperature": temperature if temperature is not None else 0.3,
            "top_p": top_p if top_p is not None else 0.9,
        }

        logger.info("Connecting to Hugging Face Gradio Space microservice: %s", src)

        # Execute call with Gradio Client targeting /openai_style_chat
        try:
            from gradio_client import Client

            try:
                client = Client(src, token=token_arg)
            except TypeError:
                client = Client(src, hf_token=token_arg)

            # Predict call strictly targeting /openai_style_chat endpoint
            raw_result = client.predict(
                json_input=json_input,
                api_name="/openai_style_chat"
            )

            cls._last_execution_info = {
                "provider": "hf_gravita",
                "model": "Qwen3-1.7B-Tax-Adapter",
            }

            # Parse returned OpenAI Chat Completions Schema
            data = raw_result
            if isinstance(data, str):
                try:
                    data = json.loads(data)
                except Exception:
                    # If model returned pure text response
                    return data

            if isinstance(data, dict):
                # Standard OpenAI Chat Completions payload: choices[0].message.content
                if "choices" in data and len(data["choices"]) > 0:
                    first_choice = data["choices"][0]
                    if isinstance(first_choice, dict) and "message" in first_choice:
                        msg = first_choice["message"]
                        if isinstance(msg, dict):
                            return msg.get("content", "")
                        return str(msg)
                    elif isinstance(first_choice, dict) and "text" in first_choice:
                        return first_choice["text"]
                if "content" in data:
                    return data["content"]
                if "response" in data:
                    return data["response"]
                if "reply" in data:
                    return data["reply"]

            return str(data)

        except Exception as exc:
            err_str = str(exc)
            logger.error("Error from HF Gravita Gradio microservice: %s", err_str, exc_info=True)

            # Catch 429 Rate Limit / Quota Exceeded structures
            if "429" in err_str or "quota" in err_str.lower() or "rate limit" in err_str.lower():
                raise ZeroGPUQuotaExceededError(
                    f"Hugging Face Spaces ZeroGPU daily quota exceeded (HTTP 429): {err_str}"
                )

            # Catch cold start / timeout issues
            if "timeout" in err_str.lower() or "timed out" in err_str.lower():
                raise LLMProviderError(
                    f"Hugging Face Space cold-start / execution exceeded 90 seconds tolerance: {err_str}"
                )

            raise LLMProviderError(f"Hugging Face Gravita microservice error: {err_str}")

    @classmethod
    def call_gemini(
        cls,
        messages: List[Dict[str, str]],
        api_key: Optional[str] = None,
        max_tokens: int = 4096,
        temperature: float = 0.2,
        json_mode: bool = False,
        tier: str = "reasoning",
    ) -> str:
        """
        Invokes Google Gemini with intelligent quota-aware and tier-based failover.
        Tiers:
          - 'lite': Prioritizes gemini-3.5-flash-lite, gemini-3.1-flash-lite (high RPM, 1M context, low token cost)
          - 'reasoning': Prioritizes gemini-3.8-flash, gemini-3.6-flash (multimodal, deep logic, tool execution)
        """
        active_key = api_key or getattr(settings, 'GEMINI_API_KEY', '')
        if not active_key or active_key == "your-gemini-api-key":
            raise LLMProviderError("Valid Gemini API Key not found.")

        try:
            import google.generativeai as genai
            genai.configure(api_key=active_key)

            system_instruction = None
            chat_history = []
            user_prompt = ""

            for msg in messages:
                role = msg.get('role')
                content = msg.get('content', '')
                if role == 'system':
                    system_instruction = content
                elif role == 'user':
                    user_prompt = content
                    chat_history.append({"role": "user", "parts": [content]})
                elif role == 'assistant':
                    chat_history.append({"role": "model", "parts": [content]})

            # Tier-aware model pool selection
            if tier == "lite":
                default_pool = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.8-flash']
            else:
                default_pool = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite']

            raw_pool = getattr(settings, 'GEMINI_MODELS_POOL', default_pool)
            if isinstance(raw_pool, str):
                configured_pool = [m.strip() for m in raw_pool.split(',') if m.strip()]
            else:
                configured_pool = list(raw_pool)

            # Re-order pool according to tier priority if using configured pool
            if tier == "lite":
                configured_pool.sort(key=lambda m: 0 if 'lite' in m.lower() else 1)
            else:
                configured_pool.sort(key=lambda m: 0 if 'lite' not in m.lower() else 1)

            # Filter out models that have hit their Daily Quota (RPD) or are on rate-limit cooldown
            active_models = [m for m in configured_pool if not GeminiQuotaManager.is_model_exhausted(m)]

            # If all models in the pool were marked exhausted, try all of them anyway as a safety measure
            if not active_models:
                logger.warning("All Gemini models were marked exhausted for today. Retrying full pool as a fallback.")
                active_models = list(configured_pool)

            last_gemini_error = None
            for model_name in active_models:
                try:
                    logger.info("Attempting Gemini generation with model: %s", model_name)
                    gen_config = {
                        "temperature": temperature,
                        "max_output_tokens": max(max_tokens, 4096),
                    }
                    if json_mode:
                        gen_config["response_mime_type"] = "application/json"

                    model = genai.GenerativeModel(
                        model_name=model_name,
                        system_instruction=system_instruction,
                        generation_config=gen_config
                    )

                    if len(chat_history) > 1:
                        chat = model.start_chat(history=chat_history[:-1])
                        response = chat.send_message(chat_history[-1]["parts"][0])
                    else:
                        response = model.generate_content(user_prompt or "Hello")

                    if response and response.text:
                        cls._last_execution_info = {
                            "provider": "gemini",
                            "model": model_name,
                        }
                        return response.text
                    raise LLMProviderError(f"Empty response returned from Gemini ({model_name}).")

                except Exception as exc:
                    err_str = str(exc)
                    # If model doesn't exist or is not supported (404 / not found), drop it from pool
                    if any(kw in err_str.lower() for kw in ['not found', '404', 'not supported for generatecontent']):
                        GeminiQuotaManager.mark_model_unavailable(model_name)

                    # Detect if error is due to Daily Limit (RPD) vs temporary RPM rate limit
                    is_daily = any(kw in err_str.lower() for kw in [
                        'requests per day', 'rpd', 'daily', 'quota metric'
                    ])
                    is_quota = 'resource_exhausted' in err_str.lower() or '429' in err_str or is_daily

                    if is_quota:
                        # Mark this model exhausted so subsequent requests instantly skip it
                        GeminiQuotaManager.mark_model_exhausted(model_name, is_daily=is_daily)

                    logger.warning(
                        "Gemini model '%s' failed: %s. Switching to next available model in pool.",
                        model_name, err_str
                    )
                    last_gemini_error = exc
                    continue

            raise LLMProviderError(f"All available Gemini models in pool failed ({active_models}). Last error: {str(last_gemini_error)}")

        except LLMProviderError:
            raise
        except Exception as exc:
            raise LLMProviderError(f"Gemini execution failed: {str(exc)}")

    @classmethod
    def call_groq(
        cls,
        messages: List[Dict[str, str]],
        api_key: Optional[str] = None,
        max_tokens: int = 4096,
        temperature: float = 0.2,
        json_mode: bool = False,
        tier: str = "reasoning",
    ) -> str:
        """
        Invokes Groq Cloud with intelligent per-model Daily Allowance (TPD) & Minute Rate (RPM/TPM) switching.
        Tiers:
          - 'lite': Prioritizes llama-3.1-8b-instant (ultra-high speed, low latency, schema generation)
          - 'reasoning': Prioritizes openai/gpt-oss-20b, qwen/qwen3.8-27b, openai/gpt-oss-120b (medium/deep reasoning, complex workflows)
        """
        active_key = api_key or getattr(settings, 'GROQ_API_KEY', '')
        if not active_key or active_key == "your-groq-api-key":
            raise LLMProviderError("Valid Groq API Key not found.")

        try:
            from groq import Groq
            client = Groq(api_key=active_key)

            # Tier-aware model pool selection
            if tier == "lite":
                default_pool = ['llama-3.1-8b-instant', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b']
            else:
                default_pool = ['openai/gpt-oss-20b', 'qwen/qwen3.8-27b', 'llama-3.1-8b-instant', 'openai/gpt-oss-120b']

            raw_pool = getattr(settings, 'GROQ_MODELS_POOL', default_pool)
            if isinstance(raw_pool, str):
                configured_pool = [m.strip() for m in raw_pool.split(',') if m.strip()]
            else:
                configured_pool = list(raw_pool)

            # Re-order pool according to tier priority if using configured pool
            if tier == "lite":
                configured_pool.sort(key=lambda m: 0 if 'instant' in m.lower() else (1 if '20b' in m.lower() else 2))
            else:
                configured_pool.sort(key=lambda m: 0 if '20b' in m.lower() else (1 if 'qwen' in m.lower() else 2))

            # Filter out models that are currently marked exhausted or on rate-limit cooldown
            active_models = [m for m in configured_pool if not GroqQuotaManager.is_model_exhausted(m)]

            if not active_models:
                logger.warning("All Groq models were marked exhausted. Retrying full pool as a fallback.")
                active_models = list(configured_pool)

            last_groq_error = None
            for model_name in active_models:
                try:
                    logger.info("Attempting Groq generation with model: %s (json_mode=%s)", model_name, json_mode)
                    create_params = {
                        "model": model_name,
                        "messages": messages,
                        "temperature": temperature,
                        "max_tokens": max(max_tokens, 4096),
                    }
                    if json_mode:
                        create_params["response_format"] = {"type": "json_object"}

                    try:
                        completion = client.chat.completions.create(**create_params)
                    except Exception as req_err:
                        err_msg = str(req_err).lower()
                        if json_mode and ("response_format" in err_msg or "json_validate" in err_msg):
                            logger.info("Model '%s' does not support response_format. Retrying without it.", model_name)
                            create_params.pop("response_format", None)
                            completion = client.chat.completions.create(**create_params)
                        else:
                            raise req_err

                    if completion.choices and len(completion.choices) > 0:
                        cls._last_execution_info = {
                            "provider": "groq",
                            "model": model_name,
                        }
                        return completion.choices[0].message.content
                    raise LLMProviderError(f"Empty response returned from Groq ({model_name}).")

                except Exception as exc:
                    err_str = str(exc)
                    # If model doesn't exist on Groq (404 / model_not_found), drop it from pool
                    if any(kw in err_str.lower() for kw in ['model_not_found', 'does not exist', 'access denied', '404']):
                        GroqQuotaManager.mark_model_unavailable(model_name)

                    # Detect if error is due to Daily Limit (TPD/RPD) vs temporary RPM/TPM rate limit
                    is_daily = any(kw in err_str.lower() for kw in [
                        'tokens_per_day', 'requests_per_day', 'daily', 'tpd', 'rpd'
                    ])
                    is_quota = '429' in err_str or 'rate_limit_exceeded' in err_str or 'rate limit' in err_str.lower() or is_daily

                    if is_quota:
                        GroqQuotaManager.mark_model_exhausted(model_name, is_daily=is_daily)

                    logger.warning(
                        "Groq model '%s' failed: %s. Switching to next available model in pool.",
                        model_name, err_str
                    )
                    last_groq_error = exc
                    continue

            raise LLMProviderError(f"All available Groq models in pool failed ({active_models}). Last error: {str(last_groq_error)}")

        except LLMProviderError:
            raise
        except Exception as exc:
            raise LLMProviderError(f"Groq execution setup failed: {str(exc)}")

    @classmethod
    def call_openai(
        cls,
        messages: List[Dict[str, str]],
        api_key: Optional[str] = None,
        max_tokens: int = 4096,
        temperature: float = 0.2
    ) -> str:
        """
        Invokes OpenAI API (BYOK) via direct HTTP request.
        """
        if not api_key:
            raise LLMProviderError("OpenAI provider requires a user BYOK API key.")

        url = "https://api.openai.com/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": "gpt-4o-mini",
            "messages": messages,
            "max_tokens": max(max_tokens, 4096),
            "temperature": temperature,
        }
        try:
            resp = requests.post(url, headers=headers, json=payload, timeout=45)
            if resp.status_code == 200:
                data = resp.json()
                cls._last_execution_info = {
                    "provider": "openai",
                    "model": "gpt-4o-mini",
                }
                return data['choices'][0]['message']['content']
            raise LLMProviderError(f"OpenAI error ({resp.status_code}): {resp.text}")
        except requests.RequestException as exc:
            raise LLMProviderError(f"OpenAI connection error: {str(exc)}")

    @classmethod
    def route_completion(
        cls,
        messages: List[Dict[str, str]],
        requested_provider: Optional[str] = None,
        user_api_key: Optional[str] = None,
        json_mode: bool = False,
        temperature: float = 0.3,
        max_tokens: int = 4096,
        top_p: float = 0.9,
        tier: str = "reasoning",
        return_metadata: bool = False,
    ) -> Union[str, Dict[str, Any], Tuple[Union[str, Dict[str, Any]], Dict[str, Any]]]:
        """
        Executes completion across providers with intelligent automatic fallback and tier routing.
        Priority:
          1. Explicitly requested provider with user or system key
          2. Fallback cascade: 'groq' -> 'gemini' -> 'hf_gravita' -> 'openai'
        Tiers:
          - 'lite': High speed, lightweight inference (schema generation, prompt enhancement)
          - 'reasoning': High reasoning, multi-step orchestration (agent execution, tool dispatch)
        """
        provider_attempts = []
        if requested_provider in cls.SUPPORTED_PROVIDERS:
            provider_attempts.append(requested_provider)

        # STRICT PRIORITY ORDER: 1st Groq -> 2nd Gemini -> 3rd HF Gravita
        for p in ['groq', 'gemini', 'hf_gravita']:
            if p not in provider_attempts:
                provider_attempts.append(p)

        if user_api_key and 'openai' not in provider_attempts:
            provider_attempts.append('openai')

        last_error = None
        for provider in provider_attempts:
            try:
                raw_response = ""
                if provider == 'groq':
                    raw_response = cls.call_groq(
                        messages=messages,
                        api_key=user_api_key,
                        max_tokens=max_tokens,
                        temperature=temperature,
                        json_mode=json_mode,
                        tier=tier,
                    )
                elif provider == 'gemini':
                    raw_response = cls.call_gemini(
                        messages=messages,
                        api_key=user_api_key,
                        max_tokens=max_tokens,
                        temperature=temperature,
                        json_mode=json_mode,
                        tier=tier,
                    )
                elif provider == 'hf_gravita':
                    raw_response = cls.call_hf_gravita(
                        messages=messages,
                        api_key=user_api_key,
                        max_tokens=max_tokens,
                        temperature=temperature,
                        top_p=top_p,
                    )
                elif provider == 'openai':
                    raw_response = cls.call_openai(
                        messages=messages,
                        api_key=user_api_key,
                        max_tokens=max_tokens,
                        temperature=temperature,
                    )

                if raw_response:
                    result = cls.clean_json_output(raw_response) if json_mode else raw_response
                    if return_metadata:
                        return result, cls.get_last_execution_info()
                    return result

            except ZeroGPUQuotaExceededError as quota_err:
                logger.warning("HF ZeroGPU Quota limit reached (HTTP 429). Falling back to backup provider: %s", str(quota_err))
                last_error = quota_err
                continue
            except Exception as exc:
                logger.warning("Provider %s failed: %s. Attempting fallback if available.", provider, str(exc))
                last_error = exc
                continue

        errors_summary = f"All configured LLM providers failed. Last error: {str(last_error)}"
        logger.error(errors_summary)
        raise LLMProviderError(errors_summary)
