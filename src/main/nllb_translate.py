#!/usr/bin/env python3
"""
NLLB-200 batch translation script.
Input: base64-encoded JSON payload in argv[1]
Output: JSON to stdout
"""

from __future__ import annotations

import base64
import json
import sys
from typing import Any


def _emit(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=False))


def _load_payload() -> dict[str, Any]:
    if len(sys.argv) < 2:
        raise ValueError("Missing payload argument")
    raw = base64.b64decode(sys.argv[1].encode("utf-8"))
    parsed = json.loads(raw.decode("utf-8"))
    if not isinstance(parsed, dict):
        raise ValueError("Payload must be a JSON object")
    return parsed


def main() -> int:
    try:
        payload = _load_payload()
        model_name = str(payload.get("model") or "facebook/nllb-200-distilled-600M")
        src_lang = str(payload.get("src_lang") or "ind_Latn")
        tgt_lang = str(payload.get("tgt_lang") or "hrv_Latn")
        texts = [str(item or "").strip() for item in (payload.get("items") or [])]
        texts = [text[:1200] for text in texts if text]

        if not texts:
            _emit({"ok": True, "results": []})
            return 0

        import torch
        from transformers import AutoModelForSeq2SeqLM, AutoTokenizer

        tokenizer = AutoTokenizer.from_pretrained(model_name, src_lang=src_lang)
        model = AutoModelForSeq2SeqLM.from_pretrained(model_name)

        device = "cuda" if getattr(torch, "cuda", None) and torch.cuda.is_available() else "cpu"
        model = model.to(device).eval()

        encoded = tokenizer(texts, return_tensors="pt", padding=True, truncation=True, max_length=512)
        encoded = {key: value.to(device) for key, value in encoded.items()}

        forced_bos = tokenizer.lang_code_to_id.get(tgt_lang)
        if forced_bos is None:
            raise ValueError(f"Unsupported target language code: {tgt_lang}")

        with torch.no_grad():
            generated = model.generate(
                **encoded,
                forced_bos_token_id=forced_bos,
                max_length=196,
                num_beams=4,
            )

        out = tokenizer.batch_decode(generated, skip_special_tokens=True)
        _emit({"ok": True, "results": [str(x or "").strip() for x in out]})
        return 0
    except Exception as exc:
        _emit({"ok": False, "error": str(exc)})
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
