# Ark Core v1 pilot API

> “One friggin protocol, like maybe like WireGuard plus another protocol” — Jah Noah, Q011

One HTTPS JSON API, no custom transport or signing algorithm. Local tests use loopback HTTP. Non-loopback deployment requires a TLS reverse proxy. All `/v1` routes require `Authorization: Bearer TOKEN`; tokens are individually enrolled by the local operator, hashed at rest, expire, and can be revoked. No account signup or OIDC federation yet. Operator credentials can enroll/revoke identities through protected admin routes and give no room-permission bypass. Local operators control the machine and can enroll accounts; this is not protection against a malicious host.

Every POST requires an `Idempotency-Key` (1–128 characters). The server commits the operation receipt together with database changes. Retrying the same operation and body returns the same result; changing its body/path returns 409. An expired/revoked token never receives a receipt. File bytes can become orphaned if a metadata transaction fails; a later garbage-collection adapter is needed.

| Method / path | Input / behavior |
|---|---|
| GET /health | Minimal unauthenticated health check. |
| POST /v1/admin/identities | Operator: `{name, human: boolean, token_hash, ttl_seconds}`; caller generates a random 32-byte token locally and sends only its SHA-256 hash; returns account ID/expiry, at most 30 days. |
| POST /v1/admin/revoke | Operator: `{identity_id}`; revokes that account's credentials. Self-revocation is refused. |
| GET /v1/node | Stable node ID, protocol and capability list. |
| GET /v1/rooms | Up to 100 rooms the caller belongs to. |
| POST /v1/rooms | `{name, charter}`; human account drafts a room with immutable charter revision. |
| GET /v1/rooms/:id | Member-only charter and current approvals. |
| POST /v1/rooms/:id/members | Owner: `{identity_id, role: "reader" or "editor", active: true or false}`. |
| POST /v1/rooms/:id/charter | Owner: `{charter}`; draft only; changes approval target. |
| POST /v1/rooms/:id/approve | Active human member: `{charter_id}`. |
| POST /v1/rooms/:id/activate | Owner: `{}`; counts at least three active human members approving current charter. |
| GET /v1/rooms/:id/resources | Member-only resource list; active room required. |
| POST /v1/rooms/:id/resources | Editor: `{title, kind, content_base64}`. |
| GET /v1/rooms/:id/events?after=0 | Member-only polling; at most 100 events, ordered by sequence. Continue from last sequence. |
| GET /v1/resources/:id | Read permission: metadata and latest 100 immutable revision records. |
| POST /v1/resources/:id/revisions | Editor: `{base_revision_id, content_base64}`; 409 on stale base. |
| GET /v1/resources/:id/content?revision=UUID | Read permission: exact revision and base64 bytes; defaults to head. |
| POST /v1/resources/:id/grants | Owner: `{identity_id, action: "read" or "replicate", expires_at: epoch milliseconds}`. Expiry must be at most 24h ahead. Use `0` to revoke. |
| GET /v1/resources/:id/replica?revision=UUID | Both read and replicate permission required; exact revision export. |

Reader/editor memberships do not automatically authorize replication. The owner explicitly grants replica access, including for members. Independent nodes authenticate using a dedicated, locally enrolled service identity rather than another human's account token. Service identities cannot create rooms or sign founding approvals. Grants refer to exact resources; no implicit grants to children or all resources in an organization.

JSON requests are capped at 1.5 MB; decoded files at 1 MiB; unique local blobs at 256 MiB. These are pilot limits, not an implementation of paid storage allocations. Total metadata/log growth, per-user billing quotas, rate limits, streaming transfers and garbage collection remain future work. Resource kind is descriptive, not executable code.

The database is authoritative locally. Nodes exchange authorized data over the API; they never mount a shared SQLite database. URLs locate nodes; configured IDs pin expected node identity. TLS authenticates the peer endpoint; the JSON node ID is a consistency check, not a cryptographic proof. Peer token exchange/enrollment is manual in this pilot. There is no remote human membership verification or complete cryptographic federation yet.

Browser Origin requests are deliberately rejected until established login and a validated exact-origin policy are added. `client/ark-client.ts` is a reusable interface, not a deployed website. Polling proves durable events first; WSS, OSC and private network adapters are future optional modules.
