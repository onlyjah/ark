# Modular deployment update

Version 0.2.0: [Portalizer and service topology](PORTALIZER.md) is the current service/deployment contract. Run `npm ci` and `npm run build` before starting the full app with Bun 1.4.0. `npm start` runs the compact web app; `npm run start:core` runs only the original room API.

- Default: `docker compose up --build -d`, existing one-container profile.
- Optional split: generate `.env.portal` with `node scripts/generate-portal-keys.ts`; put only the appropriate keys in each service. Configure scoped accounts/billing URLs and the existing volume name, then use `docker compose --env-file .env -f deploy/compose.split.yaml up --build -d`.
- Railway Functions: stage `railway/loader.function.ts` and all mappings from `railway/release-variables.json` together, then commit once. The full generated source exceeds safe startup-argument size.
- Railway containers: the shared Docker image defaults to compact. Other roles start with `bun /app/portalizer.mjs`, `accounts.mjs`, `billing.mjs`, `client.mjs`, or `workspace.mjs`. Only workspace has a volume; only Portalizer needs a public domain.

Do not enable split services before checking their total budget and snapshotting the existing archive. Neither Docker orchestration nor provider end-to-end signup/payment was verified here. The account schema is unchanged; optional privilege groups in migration 002 were not applied.

# Running Ark Core

> “let's explore this nebula. Let's coalesce it into something that I can deploy” — Jah Noah, Q008

The native room API requires Node 24.19.x and its built-in SQLite. The full Ark Kash app requires `npm ci` and the Bun web bundle, with optional Neon identity/account storage and Stripe billing connections. Node's embedded SQLite API currently carries an experimental warning; the runtime is pinned and upgrading requires running the tests. This is a pilot for a small trusted group, not a production-ready identity or file hosting service.

## Native

From the repository root:

```sh
node src/cli.ts identity 'Jah Noah' human
node src/cli.ts identity 'Collaborator A' human
node src/cli.ts identity 'Collaborator B' human
npm run start:core
```

Enrollment emits each ID and secret once. Store secrets in a protected password store; never commit them, paste them into source, or reuse one person's token for everybody. The operator must actually verify distinct people; three generated identities alone do not prove three humans. `ARK_DATA` chooses the durable local directory. Default port is 8080 and default host is 127.0.0.1.

Use the API table for room creation, membership, three approvals and activation. `test/core.test.ts` contains a complete five-person HTTP example and a two-node replication example. For local inspection:

```sh
node src/cli.ts node
node src/cli.ts revoke IDENTITY_ID
```

## Full app container

The Dockerfile now builds the full web/API bundle and runs it on Bun 1.4.0 as the `bun` user. It requires a writable named volume mounted at `/data`. The private object store uses an S3-compatible endpoint. The image is defined but has not been built here because Docker is unavailable.

For a fresh installation, copy `.env.example` to `.env`, set your HTTPS `ARK_APP_ORIGIN`, and generate the pilot bootstrap hash locally:

```sh
ARK_APP_ORIGIN=https://your-app.example node scripts/bootstrap.ts
```

Copy the generated ID/hash from `.env.bootstrap` into `.env`. Keep `operator-access.json` private and outside the source package. Configure your S3 endpoint/bucket credentials. Existing volumes with enrolled credentials do not need a new bootstrap identity.

```sh
docker compose up --build -d
```

Compose exposes loopback port 8080 and retains SQLite in `arc-data`. Put a TLS proxy in front. The 256 MB/0.5 CPU settings are unmeasured starting limits. The app, account registry and storage connection are separate modules; auth/billing fail closed when not configured.

For member accounts, apply `migrations/001-ark-kash.sql` on a staging branch before the selected identity branch. Give a dedicated application database role only schema usage, account/purchase/key table SELECT/INSERT/UPDATE, and SELECT on identity id/name/email/emailVerified/banned. Do not grant session-table access. Set its pooled URL as `ARK_DATABASE_URL`, the matching managed Auth URL as `NEON_AUTH_BASE_URL`, and register your exact app origin with Neon.

See [OVERHAUL-2026-10-10.md](OVERHAUL-2026-10-10.md) for Stripe setup and current validation limits. No provider-specific secret is included in the source package.

## Explicit copy between two installations

On source A, enroll a service identity for B. The resource owner grants that identity `read` and `replicate` for one resource, with an expiry no more than 24 hours ahead. Store the token only on B in a chmod-600 file `peers.json`, outside git:

```json
{
  "source-a": {
    "url": "https://source-a.example",
    "node_id": "SOURCE_A_STABLE_NODE_ID",
    "token": "DEDICATED_SERVICE_TOKEN"
  }
}
```

On B:

```sh
node src/cli.ts replicate /secure/path/peers.json source-a RESOURCE_ID REVISION_ID
```

Configured origins only; HTTPS required except loopback; redirects rejected; transfers time out; response size and hash are checked. A replica receipt identifies source node/resource/revision, digest, byte size, and verification time. Repeated copies do not create duplicate receipts. Replicas are not automatically public or mounted into a room; they are local recovery objects. The local operator can recover bytes from `blobs/DIGEST`. Revocation prevents future retrieval but cannot erase an already delivered copy. There is no automatic replication scheduler, browser video player, or peer discovery yet.

## Export and restore

```sh
node src/cli.ts export /secure/new-backup-directory
```

Export performs a SQLite snapshot and copies immutable blobs. Protect the full export: it contains account/token hashes, room membership, grants and private bytes. Pause writes for a tightly matched backup, and keep it on an independent device. Peers files and reverse-proxy configuration are outside the data store and must be backed up separately.

Restore by stopping the service and starting it with `ARK_DATA` pointing to the exported directory. The stable node ID survives restoration. Never run two live copies of one restored node identity as independent nodes. Test restoration before relying on a backup. Export is a local operator command, not an unrestricted remote download endpoint.
