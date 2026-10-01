---
title: Output Control Evaluation
dimension: Output Control
weight: 12%
items: 6
---

# Output Control Evaluation Checklist

## Scoring Protocol

For each item: (1) search the prompt for the observable markers, (2) quote the evidence found, (3) render PASS/FAIL verdict.

| # | Item ID | Criterion | PASS when | FAIL when | Evidence Required | Observable Markers | Priority |
|---|---------|-----------|-----------|-----------|-----------------|-------------------|----------|
| 1 | output.format-defined | Output format explicitly specified | Exact structure, sections, or schema defined | No format guidance | Quote the format spec or state "no format defined" | PASS: "Structure as: 1. Summary 2. Issues" / FAIL: "Tell me what you find" | P1 |
| 2 | output.length-specified | Length constraints given with numbers | Specific word/sentence/paragraph counts | Uses "brief", "concise" without numbers | Quote the length spec or vague qualifier | PASS: "max 200 words" / FAIL: "keep it brief" | P2 |
| 3 | output.schema-provided | Structured data has exact schema | JSON/YAML schema or concrete output example | "Return as JSON" without schema | Quote the schema or the bare instruction | PASS: `{"name": str, "score": int}` / FAIL: "Return as JSON" | P2 |
| 4 | output.markdown-controlled | Formatting preferences stated | Clear markdown/prose/plain text instruction | No formatting guidance | Quote the instruction or state "none" | PASS: "Use plain prose, no bullets" / FAIL: no mention | P3 |
| 5 | output.verbosity-appropriate | Verbosity matches use case | Explicit verbosity matching consumption context | Mismatch between verbosity and consumption | State consumption context and verbosity instruction | PASS: API → "terse JSON" / FAIL: API with no verbosity control | P3 |
| 6 | output.no-prefill-dependency | Output correctness does not depend on an absent prefill | Prompt is self-contained; any expected leading text is either included in the prompt or explicitly specified | Prompt assumes a prefill that is not part of the prompt itself | Quote any instruction implying expected leading text, or state "prefill dependency detected" | PASS: expected output pattern stated in prompt / FAIL: "Continue with: ..." where the starting text is not defined in the prompt | P2 |
