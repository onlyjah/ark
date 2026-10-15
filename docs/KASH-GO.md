# KA$H.app: client, authority, storage and local bridge

**Status: 0.5 Go migration preview.** Runnable source, not a completed replacement
for the existing Ark workspace. The current Railway deployment, old data,
accounts/billing tables and Constellation services have not been replaced.

The product display name is **KA$H.app**. Files, package names, executables and
environment variables use `kash`. The existing repository remains `onlyjah/ark`;
the user authorized that fallback when `onlyjah/kash` was unavailable. The
connected Railway project is still named `KASH App`: the available connector
does not expose a project rename operation, and there is no authenticated local
Railway CLI session. This document does not claim a remote rename occurred.

## Boundaries

| Part | Runs where | Owns | Does not imply |
| --- | --- | --- | --- |
| Client | Browser, embedded Jah.earth view, future native webview | Presentation, local encryption and chosen file access | Full filesystem permissions or background execution |
| Go authority | Railway, VPS, Pi, desktop or drive-carried executable | API authorization, immutable revisions, metadata transactions, object verification | A distributed consensus cluster |
| SO/IL | Provider selected by environment | Verified session, client binding, account/capability decisions | A client-provided `verified` flag being trusted |
| Metadata | Local SQLite or shared Postgres | Resource heads, revisions, durable retry receipts | Copies of file bytes or an offsite backup |
| Object store | Local disk or configured S3-compatible endpoint | Immutable encrypted objects, separated by owner | Independent durability receipts across sites |
| Native bridge | Device with an explicitly selected folder | Stable snapshots, encrypted upload queue, local base revision | Remote deletion, background mobile permission or safe eviction |

The server uses `kash_v1_*` tables and a new `kash-v1.sqlite`, never the old
`ark.sqlite`. Existing data import is a migration task. Separate storage APIs
allow the transport and database to change without changing client layouts.

## What distribution means here

Postgres lets multiple stateless Go instances share one transactional authority.
Row locks, resource-head compare-and-swap, and owner-scoped operation receipts
prevent silent last-writer overwrites. Local SQLite has WAL and FULL synchronous
durability and belongs to one node. Do not share its file through a sync folder
or mount it on several servers.

This code does **not** provision Postgres replicas, multi-writer consensus,
multi-site object replication, backup workers or restore drills. Those are
separate infrastructure and operational responsibilities. An HA Postgres
deployment can implement the metadata boundary later; ordinary Postgres alone
is not a multi-site distributed database. No new paid cluster has been created.

For disconnected edges, the bridge has a local encrypted pending operation and
a base revision. It does not pretend to have committed a remote head offline.
After reconnecting, it retries the same bytes and operation ID. A conflicting
head returns 409 and retains both the local file and remote revision. There is
no automatic text/CRDT merge yet.

## Write and crash behavior

1. Browser or bridge encrypts names and bytes with its local content key.
2. The API verifies the signed SO/IL token and asks the provider for fresh state.
3. Immutable ciphertext is uploaded and read back; SHA-256 must match.
4. A transaction checks the expected parent, appends a revision, moves the head,
   and saves the operation receipt together.
5. A lost response can replay the operation and receive the original receipt.

A crash between object upload and metadata commit can leave an unreferenced
immutable object. Garbage collection is deliberately absent; it must never
delete objects needed by pending operations or retained history. A delete is
a new tombstone revision; old revisions and bytes remain retrievable by their
owner. Cleanup receipts currently always deny local eviction.

The bridge scans one folder, skips symlinks and its own `.kash` state, checks
file identity/size/mtime around reading, and uploads an immutable snapshot. A
file changed after that snapshot is picked up on the next scan. This is not a
filesystem snapshot or an application-consistent backup of a running database.
Unstable reads stop that scan for retry. Source files are capped at 4 MiB in this
preview, API encrypted envelopes at 8 MiB. Chunked resumable large files remain
pending. Disk capacity and quota management also need work before production.

## Identity, encryption and privacy

The browser persists only a non-secret client ID. SO/IL issues the session ID;
the account subject is distinct from both. Tokens and unlocked content keys
remain in memory. SO/IL controls accounts/access/payments views; the client
advertises only the controls included in the verified session capabilities.

Go accepts EdDSA or ES256 tokens, checks issuer/audience/expiry/issued-at,
session/client bindings, and signed scopes. `/session` is queried on every
private request to check active/revoked state. JWKS keys have a short cache;
positive session decisions do not. Provider failure denies access. The current
public provider has not been validated end to end with this new protocol.

Client and Go bridge share `kash.sealed.v1`, AES-256-GCM with random nonces and
an authenticated protocol label. A locally supplied 32-byte key encrypts both
file name and bytes. The server still sees owner, resource IDs, ciphertext size,
timing and relationship metadata. This is a primitive, not a reviewed complete
key-management system: recovery, rotation, sharing and wrapping keys through
SO/IL are not implemented. Keep the key separate from synced data.

Peer-account grants, the old collaborative room rules, editor/publication APIs,
payments and old account recovery are not ported to this Go preview yet.

## One UI and several runtimes

The implemented client uses React and TanStack. `ui/theme.css` shares shadcn-style
CSS tokens; `ui/blocks.ts` shares typed block descriptions. React, Vue and Solid
can share those tokens, data schemas and application rules, but their component
instances, hooks, slots and event systems are not interchangeable. The existing
map is a custom element and can actually embed across those frameworks. The
new React controls are local HTML primitives; no Vue/Solid/shadcn renderer ports
have been implemented or represented as automatic conversions.

The default transport remains ordinary HTTPS JSON. Native desktop/mobile shells
can render the same static React assets and expose a small permission-aware
native bridge. Tauri is a possible future Rust host using the system webview;
it is not installed here. Go remains the service/agent language. WASM is an
optional later target for a bounded shared algorithm such as chunking or hashing,
after measurement. It does not grant unrestricted browser filesystem access,
replace a web renderer, or remove OS background restrictions.

Windows/macOS/Linux are operating systems; ARM/RISC-V are CPU targets; Debian
is a Linux distribution. CI cross-compiles separate native Go binaries for
Linux amd64/arm64/riscv64, macOS amd64/arm64, and Windows amd64/arm64. Compilation
is not a claim of runtime/device testing. Android/iOS webview packaging, store
signing, tiny/embedded OS ports and background agents remain separate work.
