# Odelco delivery rules — minimum release gates

## Why this exists
A merged Sales Portal fix in generic `main` did not automatically reach the
independent `odelco-staging` branch. A green CI build for shared Geins connector
did not verify real readback or rollback. The Admin deploy path likewise required
separate SQL migrations, Scaleway runtime configuration and user roles.

**A successful PR is not a successful delivery.** This document is the shared
definition for delivery owners. Existing generic Sales Portal branching from
[ADR-022](../../docs/adr/022-dev-main-branching-release-flow.md) remains in
force; Odelco's Hetzner staging is an additional, independently verified lane.

## Code routing
- `main`: generic multi-tenant engine changes; reviewed/tested through the
  repository's ordinary Azure release path. Not proof of Odelco availability.
- `odelco-staging`: Odelco validation and its own HDNG staging deployment,
  qualified by `.github/workflows/odelco-staging.yml`.
- `production`: generic Azure production release mechanism, not a synonym
  for Odelco's staging or Odelco's merchant site.
- A generic fix with Odelco impact needs an explicit GitHub backport
  issue/PR **or** a documented decision and reason why none is required.
  Compare resulting code and then validate the real customer scenario.
- An Odelco-specific customization stays in tenant config or an isolated
  Odelco lane; no hard-coded merchant behavior in shared engine code.
- Do not reset one branch to another: Odelco staging carries its own
  deployment and other scoped commits.

## Status contract
1. **Code ready**: branch and change reviewable; owner/impact documented.
2. **CI green**: required automated checks passed for the exact PR SHA.
3. **Merged**: GitHub accepted the PR in the intended branch.
4. **Deployed**: real runtime reports the intended full revision and health.
5. **Verified**: approved human-tested happy/negative paths against the
   intended tenant and environment; data changes have readback/rollback proof.
6. **Delivered**: responsible owner signs off, links evidence and closes issue.

Use these exact terms in messages. Don't say fixed, deployed or live merely
because a PR is green. Avoid GitHub auto-closing keywords until acceptance is
recorded; use `Refs issue-url` in the PR body.

## Required acceptance for risky changes
- **Pricing/auth:** after login, session expiry, anonymous access, contract
  prices, cart/checkout; test on Odelco and a non-Odelco tenant.
- **External integrations:** read-only identity first; real writes only after
  explicit customer approval, scoped test object, snapshot, readback, restore
  and rollback path; never infer from mocks that real writes work.
- **Mail/forms:** verified domain, scoped key only in deployment secrets,
  allowed tenant, real provider acceptance *and* inbox delivery/reply-to,
  refusal on malformed/duplicate/unauthorized requests.
- **Database/schema:** identify migration name, database and operator, backup,
  exact migration ordering and whether required before or after application
  deploy. A green application build does not prove the schema is in place.
- **SEO/redirects:** actual canonical and old URL mapping, current robots and
  sitemap on staging; no unexplained global behavior across tenants.

## GitHub guardrails
- PR template asks for target, tenant impact, backport disposition, risk and
  verification owner. `.github/workflows/odelco-delivery-contract.yml`
  initially reports missing metadata as **advisory warnings**, so existing
  work is not abruptly blocked.
- `.github/workflows/odelco-branch-divergence.yml` posts an **advisory**
  action summary of patch-divergent `main` commits after pushes and on
  weekdays. It cannot know which commits must be backported.
- Once tested on sample PRs and once active PRs carry declarations, enable
  `DELIVERY_METADATA_ENFORCE=true`. Repository admins should then require
  the named check on `main` and `odelco-staging` in GitHub Rulesets.
- Also configure (repository admin action): require PR, green existing CI,
  at least one approving reviewer for risky paths and dismissed stale
  approvals on new commits. Validate no critical workflow is skipped.
- For Odelco Admin's separate repo, its CI is not a database migration
  executor; coordinate migrator execution and Railway deployment before
  marking any issue verified.

## Release-evidence comment template (issue)
Environment: ...
Target revision / full SHA: ...
Runtime revision / health: ...
Test account/object (no secret or customer PII): ...
Scenarios and observed results: ...
Migrations / integration approvals: ...
Rollback/restore check: ...
Verified by / date: ...
Decision: GO / NO-GO

Keep the system small: no parallel release database or new service is
needed. A GitHub issue and checked evidence are sufficient.
