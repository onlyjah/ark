# KA$H.app

**Go backend and native bridge. TypeScript / React / TanStack client.**

The new **0.5 Go migration preview** is runnable and separate from the existing
TypeScript/Bun release. It does not silently import the old archive or claim
completed multi-site redundancy. The Railway project still displays `KASH App`;
this repository and the new client use the requested **KA$H.app** product name.

Start with [what each build step and dependency does](docs/BUILD.md),
[architecture and implementation status](docs/KASH-GO.md),
[GitHub / local deployment](docs/GIT-DEPLOY.md) and [Go API](docs/GO-API.md).

| Source | Responsibility |
| --- | --- |
| `backend/` | Native Go API, SO/IL verifier, SQLite/Postgres metadata, object adapters, folder bridge |
| `client/` | React client, TanStack routing/query, local encrypted upload/download |
| `ui/` | Shared theme tokens and typed block contracts |
| `xtp/soil/` | Shared provider configuration and browser handshake SDK |
| `web/kash/` | Lightweight framework-independent storage-world map |
| `Dockerfile.go`, `Makefile`, `compose.go.yaml` | Commented, conventional Go/client build and local installation |

```sh
make build
make test
./backend/bin/kash serve
```

Building needs Go **1.27.2** and Node **24.19.0**; the compiled executable needs
neither runtime. `docker build -f Dockerfile.go -t kash-go .` performs the same
build in containers. Private APIs require the configured SO/IL provider.

The Go path implements owner-scoped revisions, compare-and-swap edits,
tombstones, durable retry receipts, local/S3 object verification and an encrypted
selected-folder push bridge. The client and bridge share a content envelope.
The bridge keeps local files and pending snapshots when a transfer or conflict
fails. Local cleanup remains disabled.

Not yet migrated: legacy room/editor/publication/payment APIs and old data.
Not yet implemented: database/object replication across sites, verified backup
workers and restore drills, large-file chunking, initial pull/pairing,
bidirectional sync, automatic conflict merging, key recovery/rotation,
mobile native packaging, and automatic eviction. Postgres is a shared metadata
authority; adding it alone is not a distributed multi-site database.

The root `Dockerfile`, root `package.json`, `services/`, `packages/`, `plugins/`,
`railway/` and most of `web/` retain the **0.4 TypeScript/Bun implementation** for
migration and rollback. They are not the runtime of `Dockerfile.go`. The
previous portable binaries were browser launchers; the new Go binary has an
actual folder push agent. See [legacy installation](docs/INSTALL.md) only when
working on the retained 0.4 profile.

No project software license has been selected. Human quotations remain exact
in [the quote catalog](quotes/README.md). These technical documents are
implementation notes, not quotations or editorial copy attributed to Jah.
