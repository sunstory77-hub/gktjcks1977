"""Claude API 호출(스트리밍). 이벤트 dict를 순서대로 내보낸다.

이벤트: {"type": "status"|"text"|"done"|"error", ...}
"""

from __future__ import annotations

from typing import Iterator

import anthropic

from . import extract, store
from .prompts import system_prompt

MAX_TOKENS = 32000
FALLBACK_BETA = "server-side-fallback-2026-07-01"
WEB_SEARCH_TOOL = {"type": "web_search_20260209", "name": "web_search", "max_uses": 5}
MAX_CONTINUES = 3


def _user_content(msg: dict) -> list[dict] | str:
    blocks: list[dict] = []
    for fid in msg.get("files", []):
        loaded = store.load_upload(fid)
        if loaded:
            path, meta = loaded
            blocks.extend(extract.to_blocks(path, meta["name"], meta))
    if not blocks:
        return msg["text"]
    blocks.append({"type": "text", "text": msg["text"] or "첨부파일을 확인해줘."})
    return blocks


def build_messages(history: list[dict]) -> list[dict]:
    messages = []
    for m in history:
        if m["role"] == "user":
            messages.append({"role": "user", "content": _user_content(m)})
        elif m.get("text"):
            messages.append({"role": "assistant", "content": m["text"]})
    return messages


def _error_text(e: Exception) -> str:
    if isinstance(e, anthropic.AuthenticationError):
        return "API 키가 올바르지 않습니다. 설정(⚙)에서 키를 다시 입력하세요."
    if isinstance(e, anthropic.PermissionDeniedError):
        return "이 API 키로는 선택한 모델을 쓸 수 없습니다. 다른 모델을 선택해 보세요."
    if isinstance(e, anthropic.RateLimitError):
        return "요청 한도를 초과했습니다. 1~2분 뒤 다시 시도하세요."
    if isinstance(e, anthropic.APIStatusError):
        return f"API 오류({e.status_code}): {getattr(e, 'message', e)}"
    if isinstance(e, anthropic.APIConnectionError):
        return "Claude 서버에 연결하지 못했습니다. 인터넷 연결을 확인하세요."
    return f"알 수 없는 오류: {e}"


def run(history: list[dict], mode: str, model: str, effort: str,
        web_search: bool, fmt: str = "") -> Iterator[dict]:
    client = anthropic.Anthropic()
    messages = build_messages(history)
    params: dict = {
        "model": model,
        "max_tokens": MAX_TOKENS,
        "system": system_prompt(mode, fmt),
        "messages": messages,
        "thinking": {"type": "adaptive"},
        "output_config": {"effort": effort},
        "cache_control": {"type": "ephemeral"},
    }
    if web_search:
        params["tools"] = [WEB_SEARCH_TOOL]
    use_fallback = model.startswith("claude-opus")

    full_text = ""
    stop_reason = None
    for _ in range(MAX_CONTINUES + 1):
        try:
            extra = {"betas": [FALLBACK_BETA], "fallbacks": "default"} if use_fallback else {}
            with client.beta.messages.stream(**params, **extra) as stream:
                for event in stream:
                    if event.type == "content_block_start":
                        block = event.content_block
                        if block.type == "server_tool_use":
                            yield {"type": "status", "text": "🔎 웹 검색 중…"}
                        elif block.type == "thinking":
                            yield {"type": "status", "text": "💭 생각하는 중…"}
                        elif block.type == "text" and full_text and not full_text.endswith("\n"):
                            full_text += "\n\n"
                            yield {"type": "text", "text": "\n\n"}
                    elif event.type == "content_block_delta" and event.delta.type == "text_delta":
                        full_text += event.delta.text
                        yield {"type": "text", "text": event.delta.text}
                final = stream.get_final_message()
        except anthropic.BadRequestError as e:
            # 폴백 베타를 받지 않는 계정·모델이면 폴백 없이 한 번 더 시도
            if use_fallback and ("fallback" in str(e).lower() or "beta" in str(e).lower()):
                use_fallback = False
                continue
            yield {"type": "error", "text": _error_text(e)}
            return
        except anthropic.APIError as e:
            yield {"type": "error", "text": _error_text(e)}
            return

        stop_reason = final.stop_reason
        if stop_reason == "pause_turn":
            # 서버 도구(웹 검색)가 턴을 잠시 멈춘 경우: 받은 내용 그대로 붙여 이어서 요청
            params["messages"] = messages + [{"role": "assistant", "content": final.content}]
            messages = params["messages"]
            continue
        break

    if stop_reason == "refusal":
        yield {"type": "error", "text": "모델이 이 요청을 처리하지 않았습니다. 표현을 바꿔 다시 요청해 보세요."}
        return
    if stop_reason == "max_tokens":
        yield {"type": "status", "text": "⚠ 분량 한도에 도달했습니다. '이어서'라고 입력하면 계속 작성합니다."}
    yield {"type": "done", "text": full_text, "stop_reason": stop_reason}
