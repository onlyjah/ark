> Current implementation: [Portalizer and service refactor, version 0.2.0](PORTALIZER.md). Earlier topology/deployment notes below describe the preceding pilot or future plans. The full-source Railway Function startup command is superseded by the bounded loader.

# October 10 integrated overhaul

See [OVERHAUL-2026-10-10.md](OVERHAUL-2026-10-10.md). The responsive app, OnlyJah account bridge, Stripe test subscription code, encrypted Markdown vault and queued-save integration are tested and staged. Approval review blocks deployment, and Stripe runtime secrets are still required. Historical ledgers below describe earlier stages.

# October 10 UI release candidate

See [UI-RELEASE-2026-10-10.md](UI-RELEASE-2026-10-10.md). Responsive UI, projects/folders and explicit public snapshots are tested and staged. Deployment was rejected by automatic approval review. The live app remains unchanged. Better Auth integration, billing and encrypted sync are pending.

# October 10 programming update

See [SYSTEM-TOPOLOGY.md](SYSTEM-TOPOLOGY.md) for the paid local-first launch topology and [WORK-DONE-2026-10-10.md](WORK-DONE-2026-10-10.md) for this pass. A pure sync state machine and seven behavioral tests have been added. It is not yet integrated into the client. Better Auth, Stripe provisioning, device encryption, durable sync and publication remain pending. Existing deployment behavior is unchanged.

# October 8 phone-app update

The private personal writing/archive web app is deployed at `/app/`. See [PHONE-APP.md](PHONE-APP.md). It adds access-file browser sessions, private article revisions, offline unsaved drafts, attachment upload/download and a 5 GB application allowance in a private Railway object bucket. It does not add room/course/community interfaces, email login or website publishing. The earlier room implementation ledger below describes that separate API.

# Implementation ledger

> “I want Arc to be more or less complete by the time it's launched and it go immediately into maintenance mode, or immediately into feature mode” — Jah Noah, Q018

The pilot establishes a bounded contract. It does not assert that the whole backbone is complete.

| Area | Implemented | Remaining |
|---|---|---|
| Rooms | Owner-led charter draft, exact-revision approvals, activation, memberships | Member-led governance, typed executable charter, succession/closure workflows |
| Identity | Expiring hashed operator-issued credentials, protected remote enrollment/revocation, human/service distinction | Established OIDC login, passkeys, remote membership evidence, key enrollment/rotation |
| Federation | Two-node authorized exact-revision transfer, node ID consistency check | Signed trust contracts, discovery, independent human accounts across nodes, relay/offline policies |
| Files | Immutable SHA-256 objects, revisions, optimistic conflict checks | Branch reconciliation, CRDT collaboration, resumable/chunked large files, scheduled copies |
| Storage | Filesystem, 1 MiB file / 256 MiB object-store pilot limits | Provider adapters, full quotas/accounting, replication retention, GC, durability fsync audit |
| Events | SQLite log and cursor-based bounded polling, deduplicated POST receipts | WSS subscriptions, retention/resnapshot, OSC/SPI adapters |
| Recovery | Local metadata snapshot and immutable object copy | Encrypted backup automation, restore operator UI, scheduled drills |
| Client | Reusable TypeScript HTTP client interface | TanStack static UI, tested browser login/origins, release registry and automatic multi-site rollout |
| Media/community | Typed resources can hold documents and course/forum metadata | Actual course/forum UI, video streaming/ranges/transcoding, Matrix adapter and policy mapping |
| Operations | Loopback default, non-root image definition, bounded transfer, resource ceiling | Built-container verification, load measurements, rate limiting, monitoring and production review |

No Matrix, storage vendor, managed identity provider, network overlay or paid service is provisioned. The implementation is deliberately small enough to inspect, run and extend. Events, database metadata and idempotency receipts are not yet retention-bounded; do not run it as an untrusted public service.

Tests exercise actual HTTP actions for five collaborators, fresh approvals after charter edits, inactive-founder exclusion, duplicate operations, mismatched retry keys, outsider denial, revision conflicts, retained historical bytes, replication permission separation, replica deduplication, grant/member/token revocation, node identity persistence, transaction rollback and recovery export.

The runtime is Node 24.19.0, using its built-in TypeScript execution and SQLite. Tests passed in this workspace, including the bundled Railway fetch adapter. Railway runs the same bundle on Bun 1.4.0 with a persistent volume; see RAILWAY.md for deployment evidence. Docker definitions are included but cannot be built here because Docker is not installed. No idle RAM, CPU, production throughput, paid tier economics, availability or universal interoperability claim has been validated.
