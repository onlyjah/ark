# SO/IL SDK

This package is the new KASH integration boundary at `xtp/soil`. It contains a
small browser/webview client, server verifier, and provider configuration.
It does not implement the remote identity, payment or account provider.

| Variable | Default | Role |
| --- | --- | --- |
| `SOIL_API_URL` | `https://soil.jah.earth/api/v1` | Server-to-server verification and account API |
| `SOIL_APP_URL` | `https://soil.jah.earth/app` | Embedded or standalone account client |
| `SOIL_ISSUER` | API URL | Exact signed-token issuer |
| `SOIL_JWKS_URL` | API URL + `/.well-known/jwks.json` | Trusted verification keys |
| `SOIL_AUDIENCE` | `kash` | Signed-token audience |
| `SOIL_AUTH_MODE` | `compatible` | Existing enrollment/Neon compatibility, or strict `soil` mode |

Provider URLs require HTTPS, except explicit loopback development providers.
Secrets, query strings and fragments are rejected. Public configuration contains
only URLs, audience and mode; provider credentials never enter the bundle.

## Provider contract, version 1

This is the contract implemented and tested by this new SDK. The provider must
implement it before strict mode is activated. It is not a claim that the named
remote domain currently implements these endpoints.

The account view receives an exact-origin `postMessage`:

```json
{"type":"soil:connect","protocol":1,"request_id":"nonce","audience":"kash","client":{"id":"client-id"}}
```

After authenticating the person, the selected view returns:

```json
{"type":"soil:session","protocol":1,"request_id":"same-nonce","token":"short-lived-signed-jwt"}
```

The host checks the exact origin, selected iframe/popup window and nonce. It
then asks its own backend to verify the token. The token remains in memory and
is never accepted from a URL, browser storage or an unrelated message source.
Cancelled views and late responses cannot restore a session.

The JWT uses EdDSA or ES256 and requires `iss`, `aud`, `sub`, `iat`, `exp`, `sid`,
`client_id`, and a space-delimited `scope`. Token age is at most 16 minutes.
`sub` currently maps to an existing UUID account. The receiving backend verifies
the signature, issuer, audience, age and client binding, then calls:

```http
GET {SOIL_API_URL}/session
Authorization: Bearer <same token>
```

The provider must respond with:

```json
{
  "protocol": "soil.session.v1",
  "id": "same sid",
  "client": {"id": "same client_id"},
  "subject": "same sub",
  "issuer": "configured issuer",
  "audience": "kash",
  "active": true,
  "verified": true,
  "expires_at": 0,
  "scopes": ["kash:read"],
  "capabilities": ["identity", "access", "accounts"]
}
```

`expires_at` is a future Unix timestamp in milliseconds and cannot outlive the
signed token. Provider scopes must be a subset of its signed scopes. Every
private request checks the provider again; no positive authorization cache can
hide a revocation. Provider failure blocks access. Neither a client ID nor a
caller-supplied `verified` boolean authorizes anything.

KASH returns the verified projection from `GET /app/api/soil/session` and hides
unknown account-view capabilities. `soil:view` messages select only explicitly
shown identity/access/accounts/payments views. Payment actions remain in SO/IL.

## Scope boundaries

| Scope | Allows |
| --- | --- |
| `kash:read` | Owner-scoped workspace observations and document reads |
| `kash:write` | Workspace writes; existing revision and publication checks still apply |
| `vault:read` | Retrieve encrypted recovery records and verify an owner's envelope |
| `vault:write` | Store an encrypted recovery record |
| `ark:api` | Reach the core API; separate local enrollment and resource grants still apply |
| `ports:read` | List explicitly registered application ports |
| `ports:use` | Invoke a registered, owner/recipient-authorized port |

The account provider also supplies authenticated `GET/POST /account/keys` for
the existing encrypted vault record format. Reads are bounded and signatures
are checked against the provider's public key. No private signing key belongs
on the server. Account key rotation, native agents, cross-provider account
mapping and delegated peer sessions require further provider contracts.

Compatibility mode preserves existing pilot access and Neon authentication.
It does **not** label those sessions as remotely verified by SO/IL. Strict mode
rejects pilot cookies and access-file login entirely. New SO/IL identities do
not automatically become Ark administrators, founders or room members.
