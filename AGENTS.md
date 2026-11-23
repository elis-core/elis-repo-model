# Agent rules

1. Every change to `main` goes through a pull request. No direct pushes, no force pushes, no bypass, by anyone.
2. Write everything in UK English: code, comments, commits, branches, Issues, PRs and reviews.
3. Work only on Issues in `Ready`. One Issue per Implementer at a time.
4. One Issue, one branch, one PR. Branch from an up-to-date `main` (`feat/123-short-summary`) and open a draft PR straight away.
5. Keep PRs small. Fix failures in the same branch and the same PR.
6. Act only under your own GitHub App identity. Never use another agent's credentials.
7. Implementers never review. Validators never push code. Nobody validates their own work.
8. A Validator starts from a fresh session, reads the Issue and the diff, and runs the tests itself.
9. A PASS covers one commit. New commits need a new PASS.
10. Never weaken a check, lower a risk class or edit `.github/` to get a PR through.
11. Product questions go to the PO: add `needs-po`, state the question and the options, then move to the next item.
12. No secrets or real personal data in the repository, in logs or in PR text.
13. Record negative results. An experiment that refutes its hypothesis is documented, never silently dropped.
