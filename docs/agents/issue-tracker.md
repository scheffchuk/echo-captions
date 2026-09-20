# Issue tracker: GitHub

Issues and specs for this repository live as GitHub issues. Use the `gh` CLI for all operations and infer the repository from the current Git remote.

## Conventions

- Create issues with `gh issue create`.
- Read issues and comments with `gh issue view <number> --comments`.
- List issues with `gh issue list`, including labels and comments when needed.
- Comment with `gh issue comment`.
- Apply or remove labels with `gh issue edit`.
- Close issues with `gh issue close`.

## Pull requests as a triage surface

PRs as a request surface: no.

## Skill operations

When a skill says “publish to the issue tracker,” create a GitHub issue.

When a skill says “fetch the relevant ticket,” read the issue body, comments, and labels.

Use GitHub sub-issues and native issue dependencies when available. If unavailable, record parent and blocking relationships in issue bodies.
