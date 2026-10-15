# What actually builds and runs

The current deployed 0.3 release and the pending 0.4 release use TypeScript/Bun.
The **0.5 Go migration profile** is separate and is not a completed data migration.
Go is suitable for GitHub autodeploy and containers. The earlier friction came
from the custom function packaging and service configuration, not from Go.

## The new Go path

`Dockerfile.go` has three ordinary, commented stages:

| Step | What it does | What leaves the stage |
| --- | --- | --- |
| Node / `npm ci --ignore-scripts` | Installs exact client dependencies from `client/package-lock.json`; disables package lifecycle scripts | Dependencies remain in the builder |
| `npm run build` | Runs TypeScript checking, then Vite to bundle React, TanStack, CSS and the lazy map | Static HTML/CSS/JS, no application server |
| Go / `go mod download`, `go mod verify` | Resolves exact `backend/go.mod` versions and verifies `go.sum` checksums | Dependencies remain in the builder |
| Copy client assets | Places the static files under `internal/client/static` for `go:embed` | The same frontend becomes part of the binary |
| `CGO_ENABLED=0 go build` | Compiles server, adapters and native bridge without C runtime linking | One `kash` executable |
| Alpine runtime | Adds CA certificates for TLS and a dedicated user, then starts `/app/kash serve` | No Node, npm, Bun or compiler at runtime |

`Makefile` exposes the same steps locally. There is no downloaded shell installer,
encoded release loader, or proprietary app build API in this path. Docker,
Alpine, Go, Node, Vite and the libraries are open-source software. Railway is
the optional proprietary hosting/control plane. npm and Go module proxies are
dependency distribution services, not runtime application backends.

Build an image with `docker build -f Dockerfile.go -t kash-go .`. Run a native
build with `make build`, then `./backend/bin/kash serve`. Building from source
needs Go and Node; running the compiled app needs neither. Build-time code
such as Vite still executes even though npm package lifecycle scripts are off.

## Dependencies with a reason

Exact versions and indirect dependencies are in the two lockfiles. This table
explains the direct dependencies rather than calling an SDK a black box.

| Dependency | Used for | Boundary and upstream |
| --- | --- | --- |
| Go standard library | HTTP, TLS, SHA-256, AES-GCM, process signals, selected-root file access | [Go packages](https://pkg.go.dev/std) |
| `pgx/v5` | Postgres SQL driver | Server only; [upstream](https://github.com/jackc/pgx) |
| `modernc.org/sqlite` | SQLite without CGO for local metadata and cross-compilation | Server only; [upstream](https://pkg.go.dev/modernc.org/sqlite) |
| AWS SDK for Go v2 S3 + credentials | Signs S3-compatible requests and transfers opaque bytes | Server only; works with the selected endpoint; [upstream](https://github.com/aws/aws-sdk-go-v2) |
| `golang-jwt/jwt/v5` | Verifies signed EdDSA/ES256 session tokens | Does not replace provider revocation checks; [upstream](https://github.com/golang-jwt/jwt) |
| `gofrs/flock` | Prevents two native agents from owning the same local folder journal | Bridge only; [upstream](https://github.com/gofrs/flock) |
| React / React DOM | Client rendering | Browser only; [React](https://react.dev/) |
| TanStack Router | Client navigation | [Router](https://tanstack.com/router/latest) |
| TanStack Query | Bounded API fetching, cancellation and cache invalidation | No database storage; [Query](https://tanstack.com/query/latest) |
| TypeScript / Vite / React plugin | Type checking and static bundling | Build only; [TypeScript](https://www.typescriptlang.org/), [Vite](https://vite.dev/) |
| Playwright | Browser integration tests | Development/CI only; [upstream](https://playwright.dev/) |
| GitHub Actions | CI runner and published test status | Optional proprietary hosted runner service; workflow YAML is readable in this repo |
| Devcontainer features | Installs Go and exposes the host Docker engine inside the dev environment | Development only; [feature source](https://github.com/devcontainers/features/tree/main/src) |

Copied upstream notices ship in `backend/THIRD-PARTY-NOTICES.txt`, the container
documentation directory and the built client's `/THIRD-PARTY-NOTICES.txt` route.
Licenses remain those of each upstream project. Source availability does not
grant a license to this repository; no project license has been selected.

## Old build path, kept for recovery

The root `Dockerfile`, root npm scripts, `services/`, `packages/`, `plugins/` and
`railway/` still belong to the 0.4 TypeScript implementation. They do not run
inside `Dockerfile.go`.

| Old script or component | Meaning |
| --- | --- |
| `scripts/build-services.ts` | esbuild bundles five TypeScript handler entry points and client assets |
| `scripts/build-railway.ts` | Bundles the compact service as a Bun Railway Function |
| `scripts/package-railway-function.ts` | Splits that bundle into `ARK_RELEASE_*` variables and hashes the payload |
| `railway/loader.function.ts` | Reads those chunks, checks their hash and imports the reconstructed function |
| `portable/runtime.mjs` | Selects the mounted data owner before importing the Bun compact bundle |
| `scripts/install.ts` | Prepares a private operator file and Compose settings, then asks Docker Compose to build/start |
| `scripts/bootstrap.ts` | Enrolls local identities for the legacy pilot |
| `scripts/generate-portal-keys.ts` | Generates signing material for legacy internal service grants |
| `scripts/build-portable.ts` / `portable/launch.mjs` | Compiles browser launchers, not native folder-sync applications |
| `@neondatabase/serverless` | Legacy hosted Postgres HTTP client |
| `@neondatabase/auth` | Legacy Neon identity client integration |
| `jose` | Legacy JWT and signing implementation |
| `stripe` | Legacy billing API client, not the identity authority of the new Go build |
| `web/vendor/*` | Locally shipped editor, Markdown renderer and sanitizer with their license notices |

These are local source scripts, not proprietary Railway scripts. The hosting,
identity and payment services they contact have separate API contracts. See
[architecture](KASH-GO.md) for where data and authority live.
