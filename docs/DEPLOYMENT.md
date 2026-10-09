# Constellation Railway testing release

The public API runs in Ark Core's **testing** environment as its own `constellation-api` service. The existing `ark-core` service, production site, Clerk identity and Neon policies were not changed.

- Public origin: https://constellation-api-testing.up.railway.app
- Public contract: https://constellation-api-testing.up.railway.app/openapi.json
- Client preview: https://constellation-client-testing.up.railway.app/realm/constellation
- Backend source branch: `deploy/constellation-0.1` in `onlyjah/ark`.
- Client source branch: `deploy/constellation-0.1` in `onlyjah/onlyjah-com`.
- Runtime port and public-domain target: **3000** for API, **8080** for client.
- Pilot limit for each service: 0.25 GB and 0.25 vCPU, one replica. These are resource limits, not an account billing ceiling.

## Observed API release
Commit `9453ade2000b2c7a7103404bddf3b6b2aea69725` reached terminal Railway SUCCESS. Direct HTTPS checks returned readiness 200, capabilities 200, seven published concepts, public CORS without credentials, and 401 for a forged private command. The SSE endpoint returned 200 `text/event-stream` and the actual catalogue revision. A one-hour provider metric query after light verification traffic reported current API memory 0.021815296 GB. This is an observation of the pilot, not a load benchmark or capacity promise.

## Repeatable publication
Both services follow their Git deployment branches after the initial pinned-commit verification. Reviewed pushes rebuild the corresponding service. Inspect the resolved commit and terminal SUCCESS, then verify health, public response shape, private denial and HTTPS asset/permalink behavior. A build or queued deployment alone is not a live-release result.

Changing catalogue content currently means updating the reviewed API snapshot and the client snapshot. A new project also needs a client build so its HTML permalink exists. Existing pages can refresh public content from the API. This temporary two-repository publication step is documented rather than hidden behind a privileged write endpoint. Future source automation must preserve review and public projection validation.

## Portability
Run `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm test`, then `PORT=3000 pnpm start` without Railway. Or build this repository's Dockerfile and expose container port 3000 behind the organization's TLS proxy. No Railway SDK is required by the catalogue domain. The storage adapter reads Git-reviewed public JSON; transactional private storage is a later adapter.

The client Dockerfile is a separate multi-stage build. Its release stage contains Caddy and static assets only. Supply its public API origin as the `VITE_ARK_PUBLIC_API_URL` build argument. Change hostnames and TLS outside the domain module; never put a backend secret into that argument.

## Recovery notes
The provider's first repository deployment resolved the old main README commit despite the branch request. Pinning the intended SHA corrected source selection. An explicit PORT matching the public-domain target corrected the initial 502. The services now follow the verified deployment branches. Old failed builds are retained as history, not additional running replicas.

Client browser interaction checks use actual HTTPS API responses forwarded through the session transport because standalone Chromium cannot reach the external TLS proxy directly. Direct API HTTP/SSE evidence is independent. Native end-user browser transport remains an explicit verification gap.
