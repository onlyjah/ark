# KASH app 0.3.0

KASH Home refactors the Ark Kash application around a reusable cutesy service map, scoped workspace observations, and Home/Writing/Archive/Thin navigation. Engineering interface work, not approved public editorial copy. Human quotations remain unchanged.

Existing account authentication, encrypted Markdown/key recovery, document revision checks, publication snapshots, S3 archive adapter, SQLite volume, billing readiness gates and SO/IL portal authority remain in place. Legacy /app routes, __Host-ark-session cookie, IndexedDB/localStorage namespaces, ARK_* variables, grant audiences and ark_kash database schema remain compatible. This release does not rename or delete persisted data.

## Actual changes

- Package and installable application identity are KASH, version 0.3.0.
- Home opens the embedded Canvas/HTML map. The public sign-in screen offers a clearly labeled local map simulation.
- /app/api/kash/map checks the existing authenticated session and returns owner-only project/document/revision/usage observations. Metadata labels, object keys, private paths, tokens and bodies are not exposed by this observer.
- Current browser document display metadata is supplied only inside its already authorized endpoint. Late observations are rejected after owner/context changes. Vault lock/sign-out clear retained map state.
- Archive configuration is reported separately from verified reachability/protection. Backup and offsite roles remain unconfigured. No automatic cleanup or device agents are activated.
- The Thin view routes to existing working files and queued-save behavior. It does not claim a complete all-file background uploader, filesystem mounting or automatic eviction.
- The service worker caches only the updated public app shell. Private observation responses are excluded.
- The reusable map source is in web/kash; SO/IL's read-only observation definition is in soil/contracts. Five existing service factories still support compact or optional split execution.

The observer lives within the existing workspace service, so this release does not require another always-on container or a plan upgrade. Owner filters use additive indexes on existing tables. Collection replica targets shown by the map are proposed targets, not current backup guarantees.

## Deployment

Target the existing Ark Core testing environment/service. Use the tested bounded gzip/chunk loader with a hash of the complete built release; code stays out of an oversized startup argument. Read back the source and staged metadata before committing. Preserve the existing /data volume and archive bucket. Commit only the reviewed patch for this service.

## Remaining verification

Check full browser/PWA behavior and actual Android/Pi CPU/RAM in the host. Provider-backed two-account sign-in, payment activation and actual S3 durability/recovery remain separate gates. Native device identity, volume enrollment, multi-site protected receipts, safe cache release and ordered event subscriptions are future work.

The map consumes compatible scoped snapshots and exposes host-mediated action requests, but this release grants no map write/delete actions. Future controller work must enforce the exact revision, local generation, independent retained copies, retention, recovery, policy freshness and pin checks documented in KASH-Storage-Profiles.md.
