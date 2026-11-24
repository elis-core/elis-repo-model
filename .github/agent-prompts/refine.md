# Task: refine an Issue (Orchestrator)

The Issue is in `.agent/issue.md`. It may be written in any language and may be a single line.

1. Read `AGENTS.md`, `README.md` and whatever part of the repository you need to understand the request.
2. Write the Issue body in UK English with these sections, in this order:
   - `### Objective`: what must be true when the work is done, and why.
   - `### Expected result and acceptance criteria`: a checklist (`- [ ]`) of criteria that a Validator can verify.
   - `### Context and constraints`: the files or flows involved, and what is out of scope.
   - `### Risk`: `low`, `medium` or `high` according to `.github/risk-paths.yml`, with one sentence of justification.
3. Do not invent product decisions. If the request is ambiguous on a point that only the PO can decide, list the question instead of guessing.
4. If the Issue is too large for one small pull request, say so in `### Context and constraints` and propose the split there.

You can only read files and write the result. Write the result to `.agent/result.json`; if you cannot write files, make it your final message, with nothing else. The result is a single JSON object:

```json
{"body": "the full Issue body in Markdown", "high_risk": false, "questions": ["a question for the PO, if any"]}
```
