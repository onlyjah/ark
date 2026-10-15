# Go API and SO/IL contract

The preview serves the static React client and these routes from the same origin.
There is no implicit proxy to the old `/v1` or `/app/api/documents` APIs.

| Route | Authority | Response / effect |
| --- | --- | --- |
| `GET /health` | Public | Process liveness, Go runtime and release |
| `GET /ready` | Public | Metadata connectivity; object health is checked during transfers |
| `GET /app/api/config` | Public | Public provider URLs, storage adapter kinds and limits; no credentials |
| `GET /app/api/soil/session` | Signed token + fresh provider session | Session projected for the shared browser SDK |
| `GET /kash/v1/status` | `kash:read` | Actual adapter types and explicit unfinished protection state |
| `GET /kash/v1/map` | `kash:read` | Bounded read-only `soil/contracts/kash-map.openapi.yaml` snapshot |
| `GET /kash/v1/resources?after=ID` | `kash:read` | At most 100 current heads for this owner and a next cursor |
| `GET /kash/v1/resources/ID` | `kash:read` | Current revision, including a tombstone head |
| `GET /kash/v1/resources/ID/content?revision=REV` | `kash:read` | Chosen immutable revision and canonical base64 ciphertext |
| `POST /kash/v1/resources/ID/revisions` | `kash:write` + `Idempotency-Key` | Verify bytes, CAS the head and persist a receipt |

All private routes require `Authorization: Bearer TOKEN` and
`X-Soil-Client-Id: CLIENT`. Browser requests must have the configured origin;
embedding a client does not grant the embedding parent access to its private API.
Every metadata/object lookup is scoped to the verified provider subject. Peer
authorization is not implemented by accepting another owner ID in a request.

A mutation has these fields:

```json
{
  "parent": null,
  "name": "Private file",
  "content_base64": "BASE64_OF_ENCRYPTED_ENVELOPE",
  "deleted": false
}
```

`parent:null` creates only. An edit supplies the exact current revision ID.
A tombstone supplies that parent, `deleted:true`, and empty content. The same
operation ID must use exactly the same input. A 409 preserves the old remote
head; callers retain their local candidate for reconciliation. A successful
receipt includes the committed revision, `object_verified`,
`redundant_backup:false` and `cleanup_allowed:false`.

The API treats content as opaque bytes and does not itself enforce an encrypted
envelope. The shipped client and bridge encrypt before using it. Do not claim
that arbitrary third-party API callers cannot upload plaintext.

## Provider endpoints

The Go verifier uses `SOIL_API_URL/.well-known/jwks.json` and
`SOIL_API_URL/session`. `SOIL_JWKS_URL` and `SOIL_ISSUER` can override the default
locations/issuer. Provider URLs require HTTPS except explicit loopback testing.
Redirects are rejected. Provider responses are bounded to 64 KiB with 5-second
timeouts; JWTs are bounded to 16 KiB. Only EdDSA and ES256 are accepted.

Required signed JWT claims: `iss`, `aud`, `sub`, `sid`, `client_id`, `iat`, `exp`,
and a space-separated `scope`. The token must have been issued within 16 minutes.

The fresh `/session` response must include:

```json
{
  "protocol": "soil.session.v1",
  "active": true,
  "verified": true,
  "id": "MATCH_JWT_sid",
  "client": { "id": "MATCH_JWT_client_id" },
  "subject": "MATCH_JWT_sub",
  "issuer": "MATCH_CONFIGURED_ISSUER",
  "audience": "kash",
  "expires_at": 0,
  "scopes": ["kash:read", "kash:write"],
  "capabilities": ["identity", "accounts"]
}
```

`expires_at` is milliseconds since epoch, must be in the future and no later
than JWT `exp`. Scopes must be a subset of the signed token's scopes. The zeros
and MATCH values above are explanatory placeholders, not valid session data.

The existing browser handshake in `xtp/soil/client.js` exchanges a nonce-bound
`soil:connect` / `soil:session` message with the exact configured provider window
and origin, then verifies the returned token through the Go API. A message's
boolean alone is not trusted. Tokens are never appended to iframe URLs.
