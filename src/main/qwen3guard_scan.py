#!/usr/bin/env python3
"""
Qwen3Guard-Stream batch scanner.
Input: base64-encoded JSON as argv[1]
Output: JSON to stdout
"""

from __future__ import annotations

import base64
import json
import sys
from typing import Any, Dict, List, cast


def _error(message: str) -> None:
    print(json.dumps({"ok": False, "error": message}, ensure_ascii=False))


def _last_of(value: Any, fallback: str = "Unknown") -> str:
    if isinstance(value, list) and value:
        last_item = cast(Any, value[-1])
        return str(last_item)
    if value is None:
        return fallback
    safe_value = cast(Any, value)
    return str(safe_value)


def _load_payload() -> Dict[str, Any]:
    if len(sys.argv) < 2:
        raise ValueError("Missing payload argument")
    raw = base64.b64decode(sys.argv[1].encode("utf-8"))
    parsed = json.loads(raw.decode("utf-8"))
    if not isinstance(parsed, dict):
        raise ValueError("Payload must be a JSON object")
    return cast(Dict[str, Any], parsed)


def _normalize_items(items: Any) -> List[Dict[str, str]]:
    normalized: List[Dict[str, str]] = []
    rows = cast(List[Any], items) if isinstance(items, list) else []
    for row_any in rows:
        row = cast(Dict[str, Any], row_any) if isinstance(row_any, dict) else {}
        text = str(row.get("text", "")).strip()
        if not text:
            normalized.append({"text": "", "role": "user"})
            continue
        role = str(row.get("role", "user")).strip().lower()
        if role not in {"user", "assistant"}:
            role = "user"
        normalized.append({"text": text[:1200], "role": role})
    return normalized


def _moderate_one(model: Any, tokenizer: Any, text: str, role: str) -> tuple[str, str]:
    if not text:
        return "Safe", "None"

    messages = [{"role": role, "content": text}]
    prompt = tokenizer.apply_chat_template(
        messages,
        tokenize=False,
        add_generation_prompt=False,
        enable_thinking=False,
    )
    token_ids = tokenizer(prompt, return_tensors="pt").input_ids[0]

    if not hasattr(model, "stream_moderate_from_ids"):
        return "Unknown", "Unsupported stream API"

    result, stream_state = model.stream_moderate_from_ids(
        token_ids,
        role=role,
        stream_state=None,
    )
    try:
        if hasattr(model, "close_stream"):
            model.close_stream(stream_state)
    except Exception:
        pass

    risk = _last_of(result.get("risk_level"), "Unknown")
    category = _last_of(result.get("category"), "None")
    return risk, category


def main() -> int:
    try:
        payload = _load_payload()
        model_id = str(payload.get("model") or "Qwen/Qwen3Guard-Stream-0.6B")
        items = _normalize_items(payload.get("items"))[:80]

        if not items:
            print(json.dumps({"ok": True, "results": []}, ensure_ascii=False))
            return 0

        import torch as torch_mod
        from transformers import AutoModel, AutoTokenizer

        torch_any = cast(Any, torch_mod)
        tokenizer_cls = cast(Any, AutoTokenizer)
        model_cls = cast(Any, AutoModel)

        tokenizer: Any = tokenizer_cls.from_pretrained(model_id, trust_remote_code=True)
        use_cuda = bool(getattr(torch_any, "cuda", None) and torch_any.cuda.is_available())
        dtype = torch_any.bfloat16 if use_cuda else torch_any.float32
        model: Any = model_cls.from_pretrained(
            model_id,
            device_map="auto",
            torch_dtype=dtype,
            trust_remote_code=True,
        ).eval()

        results: List[Dict[str, str]] = []
        for item in items:
            risk_level, category = _moderate_one(model, tokenizer, item["text"], item["role"])
            results.append(
                {
                    "risk_level": risk_level,
                    "category": category,
                }
            )

        print(json.dumps({"ok": True, "results": results}, ensure_ascii=False))
        return 0
    except Exception as exc:
        _error(str(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
