"""Thin wrapper over the Anthropic SDK. Every call takes the model as a parameter,
so the UI can switch models per request. Requests go to the official Anthropic API unless
ANTHROPIC_BASE_URL is set. Everything streams so long outputs don't hit HTTP timeouts."""

import json
import re
from typing import AsyncIterator

import anthropic

from .config import llm_credentials


class LLMError(Exception):
    pass


_client: anthropic.AsyncAnthropic | None = None
_client_key: tuple | None = None


def client() -> anthropic.AsyncAnthropic:
    """Rebuilt whenever credentials change, so edits to .env apply without a restart."""
    global _client, _client_key
    cred = llm_credentials()
    key = (cred["base_url"], cred["auth_token"], cred["api_key"])
    if not (cred["auth_token"] or cred["api_key"]):
        raise LLMError("未配置 API Key：请在 backend/.env 中填写 ANTHROPIC_API_KEY")
    if _client is None or key != _client_key:
        kwargs = {"max_retries": 3, "timeout": 600.0}
        if cred["base_url"]:
            kwargs["base_url"] = cred["base_url"]
        if cred["api_key"]:
            kwargs["api_key"] = cred["api_key"]
        if cred["auth_token"]:
            kwargs["auth_token"] = cred["auth_token"]
        _client = anthropic.AsyncAnthropic(**kwargs)
        _client_key = key
    return _client


def _friendly(e: Exception) -> LLMError:
    if isinstance(e, LLMError):
        return e
    if isinstance(e, anthropic.AuthenticationError):
        return LLMError("鉴权失败：请检查 backend/.env 中的 ANTHROPIC_API_KEY")
    if isinstance(e, anthropic.NotFoundError):
        return LLMError(f"模型或接口不存在（请检查模型名）：{e.message}")
    if isinstance(e, anthropic.RateLimitError):
        return LLMError("请求过于频繁或额度不足（429），请稍后再试")
    if isinstance(e, anthropic.APIStatusError) and "model_not_found" in str(e.message):
        return LLMError("当前接口没有该模型（model_not_found），请切换其他模型")
    if isinstance(e, anthropic.APIStatusError):
        return LLMError(f"API 错误 {e.status_code}：{e.message}")
    if isinstance(e, anthropic.APIConnectionError):
        return LLMError("无法连接到 API 服务，请检查网络（及 ANTHROPIC_BASE_URL，如有设置）")
    if "peer closed" in str(e) or "incomplete chunked" in str(e):
        return LLMError("与 API 服务的连接中途断开，请重试")
    return LLMError(str(e))


async def stream_text(model: str, system, messages: list, max_tokens: int = 64000) -> AsyncIterator[str]:
    try:
        async with client().messages.stream(
            model=model, max_tokens=max_tokens, system=system, messages=messages,
        ) as stream:
            async for text in stream.text_stream:
                yield text
            final = await stream.get_final_message()
    except Exception as e:  # noqa: BLE001 - surfaced to the UI as a readable message
        raise _friendly(e) from e
    if final.stop_reason == "refusal":
        raise LLMError("模型拒绝了该请求（refusal），可尝试切换其他模型")
    if final.stop_reason == "max_tokens":
        yield "\n\n> ⚠️ 输出达到长度上限被截断"


async def complete(model: str, system, messages: list, max_tokens: int = 16000) -> str:
    parts = [t async for t in stream_text(model, system, messages, max_tokens)]
    return "".join(parts)


def extract_json(text: str):
    """Pull the first JSON array/object out of a model reply (tolerates ```json fences)."""
    m = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if m:
        text = m.group(1)
    starts = [i for i in (text.find("["), text.find("{")) if i != -1]
    if not starts:
        raise LLMError("模型返回中未找到 JSON")
    start = min(starts)
    end = max(text.rfind("]"), text.rfind("}"))
    return json.loads(text[start:end + 1])


async def list_remote_models() -> list[str]:
    try:
        page = await client().models.list(limit=100)
        return [m.id async for m in page]
    except Exception as e:  # noqa: BLE001
        raise _friendly(e) from e
