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
from typing import Any, Dict, List, cast


def _error(message: str) -> None:
    print(json.dumps({"ok": False, "error": message}, ensure_ascii=False))


def _load_payload() -> Dict[str, Any]:
    if len(sys.argv) < 2:
        raise ValueError("Missing payload argument")
    raw = base64.b64decode(sys.argv[1].encode("utf-8"))
    parsed = json.loads(raw.decode("utf-8"))
    if not isinstance(parsed, dict):
        raise ValueError("Payload must be a JSON object")
    return cast(Dict[str, Any], parsed)


def _normalize_items(items: Any) -> List[Dict[str, str]]:
    out: List[Dict[str, str]] = []
    rows = cast(List[Any], items) if isinstance(items, list) else []
    for row_any in rows:
        row = cast(Dict[str, Any], row_any) if isinstance(row_any, dict) else {}
        text = str(row.get("text", "")).strip()
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

        from gliclass import GLiClassModel, ZeroShotClassificationPipeline  # type: ignore[import-untyped]
        from transformers import AutoTokenizer
        import torch as torch_mod

        torch_any = cast(Any, torch_mod)
        model_cls = cast(Any, GLiClassModel)
        tokenizer_cls = cast(Any, AutoTokenizer)
        pipeline_cls = cast(Any, ZeroShotClassificationPipeline)

        model: Any = model_cls.from_pretrained(model_id)
        tokenizer: Any = tokenizer_cls.from_pretrained(model_id)
        device = "cuda:0" if getattr(torch_any, "cuda", None) and torch_any.cuda.is_available() else "cpu"
        classifier: Any = pipeline_cls(
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

            pred_any: Any = classifier(text, labels)
            pred = cast(List[Dict[str, Any]], pred_any[0] if pred_any else [])
            default_best: Dict[str, Any] = {"label": "safe", "score": 1.0}
            if pred:
                best = max(pred, key=lambda row: float(row.get("score", 0.0)))
            else:
                best = default_best
            label_raw = best.get("label", "safe")
            score_raw = best.get("score", 0.0)
            label = str(label_raw).strip().lower()
            score = float(score_raw)
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
