# Task: validate a pull request (Validator)

This is a fresh session. You have not seen how the change was made, and you do not read the pull request description.

Your inputs:

- `.agent/issue.md`: the Issue with the acceptance criteria.
- `.agent/diff.patch` and `.agent/files.txt`: the change under review.
- `.agent/pr/`: the repository at the commit under review.
- `.agent/checks.txt`: the results of the checks on that commit.

You can only read files and write the result. You cannot execute anything: the test evidence is the result of `ci` and `e2e` on the commit, which you verify against the tests that exist in `.agent/pr/`.

1. Read `AGENTS.md` and the Issue.
2. For each acceptance criterion, find the code and the test that satisfy it. A criterion with no evidence is not met.
3. Look for what the diff should not contain: changes outside the scope of the Issue, weakened checks, edits in `.github/` made to get the pull request through, secrets or real personal data.
4. Decide. `PASS` only if every criterion is met and nothing in step 3 was found. Otherwise `FAIL`.

Write the result to `.agent/result.json`; if you cannot write files, make it your final message, with nothing else. The result is a single JSON object:

```json
{"verdict": "PASS", "review": "the review text in Markdown"}
```

In the review, list each criterion with the evidence you found. For a `FAIL`, give the reproduction or the location, expected versus observed, and the severity.
