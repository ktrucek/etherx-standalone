#!/usr/bin/env python3
"""
Opir batch scanner.
Input: base64-encoded JSON as argv[1]
Output: JSON to stdout
"""

from __future__ import annotations

import base64
import json
import sys
from typing import Any, Dict, List


def _error(message: str) -> None:
    print(json.dumps({"ok": False, "error": message}, ensure_ascii=False))


def _load_payload() -> Dict[str, Any]:
    if len(sys.argv) < 2:
        raise ValueError("Missing payload argument")
    raw = base64.b64decode(sys.argv[1].encode("utf-8"))
    return json.loads(raw.decode("utf-8"))


def _normalize_items(items: Any) -> List[Dict[str, str]]:
    out: List[Dict[str, str]] = []
    for row in items if isinstance(items, list) else []:
        text = str((row or {}).get("text", "")).strip()
        if not text:
            out.append({"text": ""})
            continue
        out.append({"text": text[:1200]})
    return out


def main() -> int:
    try:
        payload = _load_payload()
        model_id = str(payload.get("model") or "knowledgator/opir-multitask-large-v1.0")
        items = _normalize_items(payload.get("items"))[:80]

        if not items:
            print(json.dumps({"ok": True, "results": []}, ensure_ascii=False))
            return 0

        from gliclass import GLiClassModel, ZeroShotClassificationPipeline
        from transformers import AutoTokenizer
        import torch

        model = GLiClassModel.from_pretrained(model_id)
        tokenizer = AutoTokenizer.from_pretrained(model_id)
        device = "cuda:0" if getattr(torch, "cuda", None) and torch.cuda.is_available() else "cpu"
        classifier = ZeroShotClassificationPipeline(
            model=model,
            tokenizer=tokenizer,
            classification_type="single-label",
            device=device,
        )

        labels = ["safe", "unsafe"]
        results: List[Dict[str, Any]] = []

        for item in items:
            text = item.get("text", "")
            if not text:
                results.append({"risk_level": "Safe", "category": "safe", "score": 1.0})
                continue

            pred = classifier(text, labels)[0]
            best = max(pred, key=lambda row: float(row.get("score", 0.0))) if pred else {"label": "safe", "score": 1.0}
            label = str(best.get("label", "safe")).strip().lower()
            score = float(best.get("score", 0.0))
            risk_level = "Unsafe" if label == "unsafe" else "Safe"
            category = "unsafe-content" if risk_level == "Unsafe" else "safe"
            results.append({
                "risk_level": risk_level,
                "category": category,
                "score": score,
            })

        print(json.dumps({"ok": True, "results": results}, ensure_ascii=False))
        return 0
    except Exception as exc:
        _error(str(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
