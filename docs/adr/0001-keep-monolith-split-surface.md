# ADR 0001 — Keep the monolith, split the surface

**Status:** Accepted
**Date:** 4 November 2026
**Deciders:** Owner, engineering

## Context

One repository carries the public booking site and the staff console. One Vite build ships all nineteen pages; `/app` is forwarded to a second origin at runtime. The console mixes four jobs (guest, desk, floor, owner) behind a role map, and three screens overlap on the same writes.

The question was whether to rebuild as separate systems.

## Decision

1. **Keep one backend and one database.** The booking invariants live in PL/pgSQL and are covered by 389 tests and 51 schema checks. They are the expensive asset; the interface is the cheap one.
2. **Split the client by job, not by layer.** Public site, console, floor app, kiosk. Each gets its own build when it earns one.
3. **Extract the smallest surface first.** The door kiosk is the pilot: one screen, one device, one job. It proves shared-device auth and multi-app deployment before the console split.
4. **Do not retrofit multi-tenancy.** There is no tenant column in 18 domain tables; that is a separate business decision, not a packaging step.

## Consequences

- The API stays a single deploy with one set of invariants. No service mesh, no distributed transactions.
- The console extraction is a build concern, not a data concern; no migration is required.
- Until the extraction lands, the public bundle still contains staff code. That is a disclosure and weight problem, not a security boundary — the API and RLS remain the boundary.
- Any new app must call the existing API rather than write booking state directly, or it reintroduces the bug the single check-in path was built to prevent.

## Rejected alternatives

- **Rewrite the frontend in a new framework.** Replaces the cheap part and keeps the expensive one.
- **Split the backend into services.** Adds deployment, tracing and failure modes with no user-visible benefit at this scale.
- **Multi-tenant SaaS now.** Four-to-six months of data-layer work before the first paying second salon exists.
