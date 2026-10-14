> Current implementation: [Portalizer and service refactor, version 0.2.0](PORTALIZER.md). Earlier topology/deployment notes below describe the preceding pilot or future plans. The full-source Railway Function startup command is superseded by the bounded loader.

# Railway deployment — October 5, 2026

> “let's explore this nebula. Let's coalesce it into something that I can deploy” — Jah Noah, Q008

Ark Core is deployed directly as a Railway Function, without GitHub. The Bun 1.4.0 runtime runs a generated single-file bundle of the same server exercised locally. Railway supports a volume on a Function, so this deployment stores its SQLite database and immutable objects on a persistent volume instead of ephemeral container storage.

| Item | Value |
|---|---|
| Workspace | OnlyJah's Projects |
| Project | Ark Core · 29c6b365-6d5d-4eaa-9464-fde7f3182be8 |
| Environment | testing · 7e3a5a42-4351-44e8-960d-007f3071b031 |
| Service | ark-core · fb8f559e-cadd-4555-a59a-0c8e045089af |
| Runtime | Bun 1.4.0 |
| Persistent volume | ark-core-data · 512 MB · /data |
| Port | 8080 |
| Healthcheck | /health · 120-second timeout |
| Resource ceiling | 0.5 CPU / 0.25 GB configured |
| Initial stable node ID | 98cda62c-94a3-45fa-ab57-ad25388dae6f |
| Public domain | https://ark-core-testing.up.railway.app · explicitly authorized by the owner October 5, 2026. |

Railway reported a successful deployment and one running replica with no issues. Runtime logs show Bun 1.4.0 startup, volume mounting, and the same node ID before and after redeployment. External HTTPS checks passed after domain creation: root and /health returned 200; unauthenticated /v1/node and /v1/rooms returned 401; authenticated requests returned 200 and the expected stable node identity. The deployed room list was empty.

## Access

The separate `private-access/operator-access.json` in the deployment ZIP contains the operator account ID and credential. It is excluded from source control. Keep the archive private. The bootstrap credential expires 30 days after first database initialization. Ordinary collaboration accounts default to 24 hours and can be enrolled for up to 30 days. No collaborators have been enrolled and no room has been activated on this deployment.

Only token hashes reach Railway bootstrap configuration and account enrollment. Authentication later uses the credential as a bearer token over TLS. Operator enrollment is separate from room ownership; the operator cannot bypass another account's room permissions through the API. Local infrastructure operators remain able to access the database and must be trusted.

The authorized public origin is https://ark-core-testing.up.railway.app and is recorded in the private access file. Use `/v1/admin/identities` with the operator token to enroll verified people. Generate each collaborator token locally using a cryptographic random generator; send its SHA-256 hash as `token_hash`, never the raw new token, in the enrollment body. Distribute each secret privately to its intended person. Do not treat several generated accounts as verification of several distinct humans.

Example request body (illustrative, not a usable credential):

```json
{"name":"Collaborator A","human":true,"token_hash":"SHA256_OF_LOCALLY_GENERATED_RANDOM_TOKEN","ttl_seconds":86400}
```

POST requests require a unique `Idempotency-Key`. Enrollment receipts retain only public account metadata, not plaintext tokens. Account expiry/recovery and renewal UI remain pilot limitations; recover the operator through trusted local administration or a reviewed source/config update before its credential expires. Merely setting a different bootstrap hash does not rotate an existing database account.

## Update and rollback

Run `npm run build:railway`, `npm test`, and `npm run check:quotes` before uploading the complete `railway/ark-core.function.ts` through Railway's Function source editor/tool. The generated bundle is not a second independently maintained server. The persistent volume must remain mounted at `/data`; the entry refuses to initialize without the Railway volume mount marker.

Railway keeps Function deployment versions. Roll back code through its deployment controls while preserving the volume. Code rollback alone does not restore an older database; schema changes need explicit migrations and database recovery testing. This version uses a single writer/replica and is not a distributed SQL database.

Source references checked for deployment compatibility:

- https://docs.railway.com/functions
- https://bun.com/blog/bun-v1.4
- https://docs.railway.com/volumes
