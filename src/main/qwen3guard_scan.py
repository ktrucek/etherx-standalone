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
from typing import Any, Dict, List, Tuple


def _error(message: str) -> None:
    print(json.dumps({"ok": False, "error": message}, ensure_ascii=False))


def _last_of(value: Any, fallback: str = "Unknown") -> str:
    if isinstance(value, list) and value:
        return str(value[-1])
    if value is None:
        return fallback
    return str(value)


def _load_payload() -> Dict[str, Any]:
    if len(sys.argv) < 2:
        raise ValueError("Missing payload argument")
    raw = base64.b64decode(sys.argv[1].encode("utf-8"))
    return json.loads(raw.decode("utf-8"))


def _normalize_items(items: Any) -> List[Dict[str, str]]:
    normalized: List[Dict[str, str]] = []
    for row in items if isinstance(items, list) else []:
        text = str((row or {}).get("text", "")).strip()
        if not text:
            normalized.append({"text": "", "role": "user"})
            continue
        role = str((row or {}).get("role", "user")).strip().lower()
        if role not in {"user", "assistant"}:
            role = "user"
        normalized.append({"text": text[:1200], "role": role})
    return normalized


def _moderate_one(model: Any, tokenizer: Any, text: str, role: str) -> Tuple[str, str]:
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

        import torch
        from transformers import AutoModel, AutoTokenizer

        tokenizer = AutoTokenizer.from_pretrained(model_id, trust_remote_code=True)
        use_cuda = bool(getattr(torch, "cuda", None) and torch.cuda.is_available())
        dtype = torch.bfloat16 if use_cuda else torch.float32
        model = AutoModel.from_pretrained(
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
