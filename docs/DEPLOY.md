# Running Ark Core

> “let's explore this nebula. Let's coalesce it into something that I can deploy” — Jah Noah, Q008

Requires Node 24.19.x. No npm dependencies, npm install, cloud account, Keycloak, Kubernetes, Git server, or separate database daemon is required. Node's embedded SQLite API currently carries an experimental warning; the runtime is pinned and upgrading requires running the tests. This is a pilot for a small trusted group, not a production-ready identity or file hosting service.

## Native

From the repository root:

```sh
node src/cli.ts identity 'Jah Noah' human
node src/cli.ts identity 'Collaborator A' human
node src/cli.ts identity 'Collaborator B' human
npm start
```

Enrollment emits each ID and secret once. Store secrets in a protected password store; never commit them, paste them into source, or reuse one person's token for everybody. The operator must actually verify distinct people; three generated identities alone do not prove three humans. `ARK_DATA` chooses the durable local directory. Default port is 8080 and default host is 127.0.0.1.

Use the API table for room creation, membership, three approvals and activation. `test/core.test.ts` contains a complete five-person HTTP example and a two-node replication example. For local inspection:

```sh
node src/cli.ts node
node src/cli.ts revoke IDENTITY_ID
```

## Container

```sh
docker compose up --build -d
docker compose exec ark-core node src/cli.ts identity 'Jah Noah' human
```

The Compose file exposes only 127.0.0.1:8080 and retains data in a named volume. The image runs as the node user. Put a TLS reverse proxy in front before permitting remote connections. Do not expose bare HTTP credentials to the internet. The 256 MB/0.5 CPU settings are a starting resource ceiling, not measured capacity or an uptime claim. The Docker engine is unavailable in the build workspace; the Docker image was not built here.

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
