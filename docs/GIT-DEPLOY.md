# GitHub deployment without a hidden build pipeline

The Go preview uses ordinary GitHub source and `Dockerfile.go`. Railway can
autodeploy Go just as it can Node. A commit pin intentionally disables following
new branch pushes; a pinned review release is different from branch tracking.

## Same code, separate environments

| Environment | Source | Data and credentials | Release rule |
| --- | --- | --- | --- |
| Development | Local checkout | Local `data-go`, test identity provider and keys | Native `make build` / Go run |
| Staging | Selected staging ref or staging repo | Staging Postgres/bucket/provider | Green CI, then deployment |
| Production | Selected production ref or production repo | Production data and credentials | Promote the reviewed commit |

Separate repos and environment branches both work. This change does not create
a second repo or alter production. Select the actual connected refs in Railway;
the table describes the release model, not links already configured there.

For the Go profile, use these service fields:

| Field | Value | Reason |
| --- | --- | --- |
| Repository | `onlyjah/ark`, or an explicitly selected replacement | Current canonical source |
| Root directory | `/` | Build sees backend, client, UI and SO/IL SDK |
| Dockerfile | `Dockerfile.go` | Explicit three-stage build |
| Build command | Empty | Dockerfile contains the steps |
| Start command | `/app/kash serve`, or image CMD | Run the compiled Go binary |
| Healthcheck | `/ready`, 120-second timeout | Verify metadata startup |
| Public port | `8080` | Go listens on `0.0.0.0` inside the image |

Connect a branch without `commitSha` to follow pushes. Pin a commit for review.
Keep staging and production data separate. No proprietary source transformer
or `ARK_RELEASE_*` chunks are needed for Go. Keep legacy variables for rollback.

## Runtime configuration

| Variable | Purpose |
| --- | --- |
| `KASH_APP_ORIGIN` | Exact public origin for browser origin checks |
| `KASH_DATABASE_URL` | Server-only Postgres DSN; absent means local SQLite |
| `KASH_OBJECT_STORE` | Explicit `local` or `s3` adapter |
| `KASH_S3_ENDPOINT`, `KASH_S3_REGION`, `KASH_S3_BUCKET` | S3-compatible destination |
| `KASH_S3_ACCESS_KEY_ID`, `KASH_S3_SECRET_ACCESS_KEY` | Server-only credentials |
| `KASH_DATA` | New local directory; never the old `ark.sqlite` path |
| `SOIL_API_URL`, `SOIL_APP_URL`, `SOIL_AUDIENCE` | Provider and identity/accounts view |
| `SOIL_ISSUER`, `SOIL_JWKS_URL` | Optional verification overrides |
| `KASH_EMBED_ORIGINS` | Space-separated exact origins allowed to embed the UI |

Use Railway variable references rather than copying credentials into source.
Public config includes only URLs, adapter kinds and limits. The frontend build
consumes no runtime secrets. The Go service does not silently reinterpret old
`ARK_*` names. See `backend/.env.example`; Go reads process environment and
does not automatically source that file.

## Volumes and replicas

Postgres + S3 can operate without local persistent application data. Local
SQLite/filesystem storage needs a persistent mount and one owner/node. The
image uses UID 10001. Railway mounts volumes as root, so local-data deployments
need deliberate mount ownership or Railway's documented run-UID setting.
Build-time chown does not change a mounted volume. Do not recursively chown or
detach the existing archive during migration. A blank Go database is not an
import. No extra paid cluster or bucket is provisioned by these instructions.

## Local native / Compose

```sh
make build
./backend/bin/kash serve
```

The default listener is loopback. Open `http://localhost:8080`. Private routes
need a functioning configured SO/IL provider. Compose uses a separate directory:

```sh
mkdir -p data-go
KASH_UID=$(id -u) KASH_GID=$(id -g) docker compose -f compose.go.yaml up --build -d
```

For the Vite development client, set `KASH_APP_ORIGIN=http://localhost:5173` on
the Go API, then run `npm run --prefix client dev`.

## Native bridge

`kash keygen` prints a new key to save privately. Keep it separate from synced
data. Provide `KASH_CONTENT_KEY`, `KASH_SOIL_TOKEN` and `SOIL_CLIENT_ID` through
private device environment/secret storage. Never paste real keys into source,
chat, shared logs or URLs. Then run:

```sh
./backend/bin/kash bridge --root /home/jah/kash/xtp/selected-project --url https://YOUR-STAGING-HOST --namespace selected-project --once
```

Omit `--once` for 5-second polling. A folder journal binds its destination,
namespace and key fingerprint. A newly discovered path uses create-only CAS;
it conflicts if that resource already exists remotely. Initial pull/pairing
and a conflict resolution UI remain pending.

A 409 stops that pass and preserves the encrypted pending snapshot. Reconcile
the remote head and local candidate before editing journal state; no supported
automatic conflict-resolution command exists yet. Local deletion does not
delete remote bytes; upload never removes a working file. This is a native
push preview, not yet a production bidirectional sync client.

## Cutover gates

Retain the legacy app until SO/IL activation, verified old-data import, required
legacy function ports and a successful restore drill. CI and container builds
alone do not satisfy those gates. Production durability also needs independent
site receipts and tested restore procedures.

Official references: [Go on Railway](https://docs.railway.com/guides/go-fiber),
[GitHub autodeploys](https://docs.railway.com/deployments/github-autodeploys),
[Dockerfiles](https://docs.railway.com/builds/dockerfiles),
[volume permissions](https://docs.railway.com/volumes#permissions),
[Go WebAssembly](https://go.dev/wiki/WebAssembly),
[Tauri webviews](https://v2.tauri.app/reference/webview-versions/),
[shadcn theming](https://ui.shadcn.com/docs/theming),
[shadcn Vue theming](https://www.shadcn-vue.com/docs/theming).
