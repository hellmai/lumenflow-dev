# Contributing to LumenFlow

Thanks for your interest in contributing.

## Before You Start

- Read the project overview in `README.md`.
- Review `AGENTS.md` and `LUMENFLOW.md` for workflow expectations.
- Follow the Code of Conduct in `.github/CODE_OF_CONDUCT.md`.

## Contribution Workflow

LumenFlow uses Work Units (WUs) for all tracked work.

1. Create or pick a WU in `docs/04-operations/tasks/wu/`.
2. Claim it:
   `pnpm wu:claim --id WU-XXXX --lane "<Lane>"`
3. Work only in the claimed worktree.
4. Run validation:
   - `pnpm docs:validate` (for docs changes)
   - `pnpm gates`
5. Complete the WU lifecycle:
   - `pnpm wu:prep --id WU-XXXX`
   - `cd <repo-root> && pnpm wu:done --id WU-XXXX`

## Pull Requests

Use `.github/pull_request_template.md` and include:

- Linked WU ID(s)
- Validation evidence (commands and outcomes)
- Docs and risk notes

## Reporting Bugs and Requesting Features

- Use `.github/ISSUE_TEMPLATE/bug_report.md` for defects.
- Use `.github/ISSUE_TEMPLATE/feature_request.md` for enhancements.

## Security Reports

Do not file public issues for vulnerabilities.

See `.github/SECURITY.md` for responsible disclosure steps.
