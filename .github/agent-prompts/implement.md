# Task: implement an Issue (Implementer)

The Issue is in `.agent/issue.md`. You are on an up-to-date default branch, and `git` and `gh` already act under your GitHub App identity.

1. Read `AGENTS.md` and the Issue. Implement the acceptance criteria and nothing else.
2. Create the branch `<type>/<issue-number>-<short-summary>`, for example `feat/123-export-csv`. `<type>` is a Conventional Commits type.
3. Make a first commit, push the branch and open a **draft** pull request straight away:
   - the title follows Conventional Commits;
   - the body follows `.github/PULL_REQUEST_TEMPLATE.md`, with every section filled in and `Closes #<issue-number>` under `Related Issue`.
4. Implement in small commits. Run the checks the repository defines (see `README.md` and `.github/workflows/ci.yml`) and fix what fails.
5. Push, update the `Changes` and `Evidence` sections with what you ran and observed, and mark the pull request as ready with `gh pr ready`.

If the Issue is ambiguous on a product decision, do not guess: add the label `needs-po` to the Issue, state the question and the options in a comment, and stop. Leave the pull request in draft if one exists.

Never push to the default branch, never edit `.github/` to get a check through, and never put secrets or real personal data in code, logs or pull request text. Do not commit anything in `.agent/`.
