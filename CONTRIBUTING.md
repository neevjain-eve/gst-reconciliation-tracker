# Contributing

Thanks for taking the time to improve this project.

## Getting set up

See the README's "Local development" section for the full setup (Node 20+, PostgreSQL, `.env`, migrations, seed data). Once running:

```bash
npm run lint       # ESLint
npm run typecheck  # tsc --noEmit
npm test           # unit tests (vitest)
npm run test:db    # integration tests against a real Postgres — needs DATABASE_URL
npm run build      # production build
```

All of these run in CI (`.github/workflows/ci.yml`) on every pull request; please run at least `lint`, `typecheck` and `test` locally before opening one.

## Commit messages

This repository follows **[Conventional Commits](https://www.conventionalcommits.org/)**:

```
<type>(<scope>): <short summary>

[optional body]
[optional footer]
```

Common types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`, `ci`. Scope is optional but helpful, e.g. `feat(matching): add fuzzy invoice-number scoring` or `fix(import): reject GSTR-2B files for the wrong GSTIN`. Keep the summary in the imperative mood ("add", not "added"), under ~70 characters.

Squash-merge pull requests so `main` keeps one commit per change; the PR title (which should itself be a conventional-commit line) becomes that commit's message.

## Pull requests

- Keep them focused — one logical change per PR is easier to review and revert.
- Fill in the PR template, including the checklist (multi-tenancy scoping, immutable imports, no secrets/real client data, migrations for schema changes).
- Add or update tests for behaviour you change, especially in `src/lib/reconcile/` (the matching engine) and `src/lib/import/` (parsing/validation) — these have the most edge cases.
- If you change `prisma/schema.prisma`, generate a migration and commit it:

  ```bash
  npm run db:migrate -- --name describe_the_change
  ```

  Don't hand-edit files under `prisma/migrations/`.

## Code conventions

- TypeScript strict mode; avoid `any`. Prefer explicit types on function boundaries.
- Every database query that touches tenant data must be scoped by `organizationId` — copy the pattern in an existing route handler (`src/lib/session.ts`'s `Ctx`, then `where: { organizationId: ctx.orgId, ... }`).
- Imported documents (`Invoice`, `Gstr2bRecord`) are immutable once saved — never write an `update` against them. Corrections come in as a new import (superseding the old row) or, for a single manual bill, a new row; reviewer decisions live on `ReconciliationResult` / `Comment` instead.
- Route handlers go through `apiRoute()` (`src/lib/api.ts`), which wraps auth, param resolution and error → JSON conversion — don't call `getServerSession` directly in a route.
- UI text should read like something a Indian accountant would recognise (ITC, GSTR-2B, tax period, not generic SaaS copy).

## Reporting bugs / requesting features

Please use the issue templates (`.github/ISSUE_TEMPLATE/`) — they ask for the details that make triage fast, and remind you not to paste real client data or GSTINs. Report security vulnerabilities privately per `SECURITY.md`, not as a public issue.

## Adding a GSP / GSTR-2B provider

If you're integrating an authorised GSP, see `docs/INTEGRATIONS.md` for the adapter interface (`src/lib/gsp/types.ts`) — you should not need to touch the reconciliation engine or the UI, only add a provider and register it.
