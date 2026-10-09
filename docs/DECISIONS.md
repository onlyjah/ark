# Decisions for the 0.1 deployment
Technical implementation record, October 9, 2026. This is assistant-authored engineering documentation, with human source quotes preserved separately.

## Requirements and boundaries
- R01: static client, separate repository, no credential in the browser.
- R02: resource authority and application grants independent of host reachability.
- R04: Nebula generates stars; the public model retains the origin reference.
- R05: research/development/production labels remain independent of live deployment or verified earnings.
- R08: small modular deployment with a portable host/API boundary.
- R09: evidence and capability flags distinguish running code from proposals.
- R10: comments explain choices and remaining gaps.

## Why this implementation
The two production dependencies are Hono and its Node HTTP adapter, pinned in the lockfile. Hono supplies the Fetch-shaped route surface; the catalogue domain, public event lifetime, storage adapter and Node host adapter have separate files. Node is the first tested host because the existing frontend uses it and this environment could execute it. This is not a benchmark verdict against Bun. Bun and other host profiles need their own compatibility checks.

The pilot reads a reviewed Git public snapshot. That avoids creating another database or moving existing SQLite, Neon, PostgreSQL or Convex data just to bring the index online. This does not supersede PostgreSQL as the proposed authoritative store for future grants, budgets, finance and outbox. The Git adapter is suitable only for the current read-only publication slice. Publication changes are Git changes, not an undocumented write API.

The frontend continues to use the existing TanStack Start, React, shadcn/Base UI and theme tokens in onlyjah/onlyjah-com. It prerenders the index and known public project permalinks, then uses the API after hydration. IndexedDB stores public projections only. Graph rendering is a separate lazy chunk; the index is useful before it loads. No private browser cache or offline financial command exists.

Public events carry a snapshot revision. After reconnect the client fetches the current snapshot. Redeployment replaces the revision and closes old streams; the client reconnects and refreshes. This is not a durable private outbox/inbox or a replay log. Those require transactional storage and their separate acceptance tests.

## Scale and portability
The read-only API has no mutable local state required for correctness. Separate instances can serve the same published revision, although rolling deployment can temporarily expose old and new snapshots. Strong read/write consistency is not claimed. Stream capacity is bounded per instance, graph depth is capped at four and query limits are explicit.

The current graph is small. There is no demonstrated hyperscale capacity or geographic failover. The design preserves a path to more replicas, CDN public caching, a PostgreSQL projection adapter, authorized private streams and later NATS. Those should be added when measured workload or authority needs justify them.

The same API can run outside Railway with pnpm start or an OCI image. Railway-specific information is limited to the Node host's optional commit label and PORT. Owned hardware still requires TLS, secrets, backups, monitoring and operators. The Dockerfile's Node tag is a lab profile; pin an image digest before a production promotion.

## Access and commercial boundaries
Only intentionally published records are loaded. The projection rejects unpublished relationship endpoints and strips undeclared fields. Public CORS allows anonymous public reads without credentials. Private paths return 401 and expose no private CORS allowance. A caller-supplied bearer string does not unlock them.

The existing Clerk identity and Neon RLS remain unchanged. Verified issuer/principal mapping, resource/action grants and runtime tenant policies must be connected before private commands. No financial claim, journal, invoice, payment, entitlement or organization creation duty is activated.

OnlyJah's maturity is unverified in this initial index because a successful deployment is not revenue evidence. Existing work and planned modules receive development/research labels with source references; these are not a complete portfolio audit or claims that every provider inventory is current.

## Sources
- Hono Node adapter: https://hono.dev/docs/getting-started/nodejs
- OnlyJah test branch: https://github.com/onlyjah/onlyjah-com/tree/test
- The current user topology request and naming clarification, October 8-9, 2026.
- The private OnlyJah Technical Topology research package contains the full seven-database comparison and 46-table reference. It is deliberately not bundled into this public API artifact.
