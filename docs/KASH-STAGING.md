> Current migration status: [KA$H.app Go architecture](KASH-GO.md). The legacy 17-change patch below was later applied, but its build failed because Docker VOLUME is unsupported. The subsequent two-change retry at 1641da5 remains staged after automatic approval cancellation. The Go preview has not replaced the live release.

# KASH staging, 0.4.0

Engineering release record. The canonical project is **KASH App**, environment
**staging**, in OnlyJah's Railway workspace. The durable service retains the
`ark-core` service identity and mounted data. The source repository is
`onlyjah/ark`, because `onlyjah/kash` was not found through the connected account.

| Layer | Canonical source | Responsibility |
| --- | --- | --- |
| KASH client | `web/` | Map, writing, thin view, local encrypted drafts and account view |
| SO/IL SDK | `xtp/soil/` | Provider configuration, view bridge and verified session contract |
| Ark | `packages/core/`, `services/workspace/` | Immutable revisions, storage, local authority and receipts |
| Service boundary | `services/`, `plugins/so-il/` | Bounded authenticated forwarding and registered ports |
| Installation | `Dockerfile`, `compose.yaml`, `scripts/install.ts`, `.devcontainer/` | Runnable local/VPS installation |
| Portable entry | `portable/`, `scripts/build-portable.ts` | Platform launchers and OS/network diagnostics |

The previous `platform/2026-10-09` source is consolidated into the canonical
tree together with the modular 0.3 release. Earlier code remains in Git history.
The separate Constellation pilot deployment branch remains pinned for its
existing services; it is not an alternative source for the KASH operator.
Generated bundles are built from source rather than maintained on multiple branches.

## Shipped behavior

- Root URL opens KASH instead of exposing a service-route catalogue.
- SO/IL identity/access/accounts/payments client can load in an on-demand view
  or a selected popup, and has a standalone link.
- Strict provider mode verifies signed tokens, audience, session/client binding,
  current revocation status and scopes before private requests. Legacy access
  cannot bypass this mode. Local enrollment and resource grants remain required.
- Scope/capability settings come from verified provider responses. Unknown
  capabilities do not create controls or grant authority.
- Notices expire or dismiss; the mobile action bar flows with content. Account
  views close completely, and sign-out clears private visible state. Cancelled
  login or vault work cannot restore a prior session's data.
- The signed service boundary forwards stable save-operation IDs. Save retry
  receipts persist across restart; new typing and conflicting revisions remain
  recoverable rather than being overwritten silently.
- Local filesystem archive is an explicit installation option, with immutable
  publication and read-time integrity checks. It never becomes an automatic
  fallback for a failing remote archive.

## Verification

Build the release before running the bundle tests. Node behavior checks include
owner isolation, encrypted storage, revocation, provider outage, forged identity,
wrong audience/client/session, crash rollback, retries across restart, concurrent
writers, immutable local object capture and corruption detection. UI behavior
checks exercise the existing Markdown editor/vault, notifications, account view
removal and rejection of delayed responses after logout. The UI checks use
JSDOM, not a real browser or mobile layout engine.

Run `npm ci --ignore-scripts`, `npm run build`, `npm test`,
`npm run check:quotes`, `bun test test/railway-loader.test.ts test/railway.test.ts`,
and `npm run test:ui` after installing the UI test dependencies.

## Current boundaries

The newly specified SO/IL provider contract is tested against a local issuer.
The actual `soil.jah.earth` API/account app has not been verified here. Staging
therefore remains explicitly in **compatible** mode until that provider is ready.
This release does not create a production identity provider or migrate accounts.

Independent multi-site backup workers, restore drills, encrypted attachments,
native file watchers, concurrent delete/edit tombstone merging, multi-tab draft
reconciliation and automatic cleanup are not implemented. Existing local drafts
and conflict copies remain retained. Public publication is still an explicit,
separate plaintext snapshot. There is no claim of guaranteed redundancy.

Railway release outcome and pinned source SHA are recorded in
`deploy/staging.json` after publishing. A completed build or staged patch does
not establish that a deployment is live; terminal SUCCESS and HTTP verification
must be checked independently.

## Release outcome

Source commit `7ea4a3af5ed3d89b9d77e5ca45840211c1ca5520` was published to
`onlyjah/ark` main. Railway patch `4f346259-4cab-437c-a359-1a9fd2a64a12`
contains 17 non-destructive changes, all on `ark-core` in staging. Automatic
approval rejected committing the patch; no new deployment was started. The
previous successful deployment remains `7192885e-5750-4fde-8a98-7d28cc08f5cf`.
The Docker image itself has not been built/deployed on Railway for this release.
The startup smoke check used the current local data owner; migration to another
UID still requires actual container verification.
