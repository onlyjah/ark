# KA$H.app Go backend

This is a native Go HTTP server and selected-folder sync bridge. It is not a
wrapper around the TypeScript/Bun server.

```sh
go test ./...
go run ./cmd/kash serve
```

The standalone Go build embeds a small fallback page. From the repository root,
`make build` embeds the React client and creates `backend/bin/kash`.

The service verifies SO/IL signatures, issuer, audience, expiry, session ID,
client ID and signed scopes, then checks revocation at the provider on each
private request. The remote provider must implement the documented contract.

| Directory | Responsibility |
| --- | --- |
| `cmd/kash` | Server, bridge and local key generation commands |
| `internal/soil` | Session verification and current provider state |
| `internal/httpapi` | Owner-scoped API and static client delivery |
| `internal/metadata` | SQLite or Postgres heads, revisions and retry receipts |
| `internal/objects` | Immutable local or S3-compatible encrypted byte storage |
| `internal/sealed` | Go/WebCrypto AES-256-GCM envelope |
| `internal/bridge` | Durable encrypted upload queue for one selected folder |
| `internal/client` | Embedded static client files |

Read [architecture](../docs/KASH-GO.md), [build explanation](../docs/BUILD.md),
[API](../docs/GO-API.md) and [deployment](../docs/GIT-DEPLOY.md).
