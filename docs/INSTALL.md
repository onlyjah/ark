# Install KASH

KASH is the client operator. Ark supplies durable storage and resource authority.
The same source builds the Railway staging service and a local/VPS container.
Cloning obtains source; the installer prepares a persistent runnable installation.

## Local desktop or drive

With Node 24 and Docker Compose installed:

```sh
git clone https://github.com/onlyjah/ark.git
cd ark
node scripts/install.ts --data /absolute/path/on/your/drive/kash/ark
```

The installer generates a private access file and server-side token hash once,
starts the compact container, and prints the app URL. Open
`http://localhost:8080/app/` and select `.kash-install/operator-access.json`.
The access file stays private. `--prepare-only` prepares configuration without
starting Docker. Repeating the command preserves the existing identity and data.
Windows paths can be supplied in quotes. The Docker host must be able to mount
the selected drive; operating-system permissions remain in effect.

The default local profile explicitly uses the filesystem archive. Object bodies
and integrity metadata are synced before an immutable object becomes visible.
SQLite uses WAL and FULL synchronization. A successful write is not evidence
of another independent copy. The map therefore keeps backup protection and
automatic local eviction unconfigured.

## VPS

```sh
node scripts/install.ts --origin https://your-kash-host.example --data /srv/kash/ark
```

Put an existing HTTPS reverse proxy in front of `127.0.0.1:8080`. Do not expose
the HTTP container port publicly. Configure external identity origins when
using a managed account provider. The container runs as the existing mounted data owner without changing archive
ownership. Local Compose selects the host UID/GID. The drive must permit that identity, and SQLite requires a filesystem with reliable locking and flushes.
Do not open one SQLite directory from several machines or start two Ark servers
on the same rotated archive simultaneously. Preserve the drive's ownership and
encrypted storage policy when moving it between hosts.

No local `.env`, access file, credentials, database or exported private data is
included in Git, the Docker build context or portable downloads.

## SO/IL provider

The public API and account-app URLs are separate in `.env.example` and Railway.
Activate `SOIL_AUTH_MODE=soil` only against a provider implementing the contract
in [xtp/soil](../xtp/soil/README.md). Strict mode checks current SO/IL authorization
before private workspace and core API access. Keep existing compatibility data
in place while preparing a provider migration; changing an environment flag does
not silently migrate account IDs, keys, recovery records or subscriptions.

## Browser, Android and portable launchers

The browser app is the client operator. Android installs it from the browser's
Install app/Add to Home screen control. The map remains a small Canvas2D web
component with event-driven redraws, a capped pixel ratio, accessible controls
and no game-engine dependency. It can be embedded in Jah.earth independently;
the complete app's frame allowlist is configured by `KASH_EMBED_ORIGINS`.

`portable/start.html` opens the staging client. `npm run build:portable`, with
Bun 1.4 installed, builds separate Linux x64/ARM64, macOS x64/ARM64 and Windows
x64 launchers plus `SHA256SUMS`. Run the matching launcher directly, or pass
your HTTPS app URL. `--doctor` reports OS, architecture and endpoint reachability.
The Linux builds use glibc; other distributions can use the container or browser.

These executables open the browser and exit. They are **not** a native file
watcher or a background Android sync service. Cross-compilation succeeded for
all five targets; only Linux x64 was executed in this workspace. Code signing,
native installation prompts and other OS runtimes have not been validated.
No executable is silently launched by a web page and no permission escalation
is attempted. User-selected files remain subject to host/browser permissions.

The devcontainer provides the pinned Node toolchain and an opt-in Docker host
connection. It is a development environment, not a backup or production image.
