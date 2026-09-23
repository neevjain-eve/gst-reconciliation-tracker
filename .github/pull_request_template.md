## What and why

<!-- One or two sentences. Link the issue: "Closes #123". -->

## Type

<!-- Match your commit prefix: feat / fix / docs / refactor / test / chore / perf / ci -->

## Checklist

- [ ] Title follows [Conventional Commits](https://www.conventionalcommits.org/) (`feat(matching): …`)
- [ ] `npm run lint`, `npm run typecheck` and `npm test` pass (and `npm run test:db` if I touched the database layer)
- [ ] Every new query is scoped by `organizationId` (multi-tenancy)
- [ ] Imported data is not modified in place; corrections/decisions are stored separately
- [ ] No secrets, real GSTINs or client data in code, tests, fixtures or screenshots
- [ ] Prisma schema change? I added a migration (`npx prisma migrate dev --name …`) and committed it
- [ ] User-facing change? README / docs updated
- [ ] Nothing here scrapes the GST portal, bypasses a CAPTCHA, or handles GST portal credentials

## Screenshots (UI changes)
