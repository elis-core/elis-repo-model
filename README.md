# ELIS model repository

This is the template for ELIS repositories. It provides the agent rules, Issue and pull request templates, branch ruleset and day-one workflows for the [ELIS development and management process](docs/process.md).

1. Select **Use this template** to create the project repository in the organisation.
2. Clone the new repository and open PowerShell 7 or later in the clone. Install the GitHub CLI and authenticate with repository administrator access and the `project` token scope. Run the bootstrap with the repository's product code and the organisation Project number.

   ```powershell
   ./scripts/bootstrap.ps1 -Repository elis-core/elis -ProductCode elis -ProjectNumber 1
   ```

3. Create and install the project's GitHub Apps and store their keys in the corresponding Actions environments. Set `ORC_APP_ID` and `ORC_PRIVATE_KEY` for `agent-orc`. Set `PORTFOLIO_REPO` to the repository that runs intake, in `owner/name` form (for example, `elis-core/elis`), and set `PROJECT_NUMBER` in each participating repository. Install the portfolio Orchestrator's App on every repository intake manages.
4. Update `.github/agents.yml`, `.github/risk-paths.yml` and `.github/CODEOWNERS`. Give each agent in `agents.yml` its `model`; a Validator only counts for an Implementer on a different model. Give each product a Project `Product` option whose name, lower-cased, matches its repository name. Configure the Project fields and built-in workflows from section 8.
5. Set the repository variables `CI_LINT_COMMAND`, `CI_TYPE_CHECK_COMMAND`, `CI_BUILD_COMMAND`, `CI_UNIT_TEST_COMMAND` and `CI_INTEGRATION_TEST_COMMAND` for the checks the project uses. The model has no application build or test commands of its own. Set `E2E_COMMAND` for the end-to-end tests that high-risk pull requests require.
6. Prove the gates with a low-risk PR and a simulated FAIL. Follow section 11 for the full adoption test.

Once reusable workflows are published from the model, projects can call them at the `v1` tag as described in section 6.
