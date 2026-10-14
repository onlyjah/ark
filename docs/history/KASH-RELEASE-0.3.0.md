# KASH release 0.3.0

State: tested and STAGED, not deployed. 13 October 2026, America/New_York.

The single reviewed Railway testing patch has 36 changes, all on ark-core: the bounded loader plus 33 compressed release chunks, count and checksum. There are no service/volume/bucket deletes, region/replica changes, new resources, or billing-plan changes. Constellation client/API are untouched.

The commit action was rejected by deployment approval. The tool returned: "Cancelled — the user did not approve this action. No changes were made." No successful deployment of this candidate was observed. Review the staged patch in the Railway environment before committing it.

Release SHA-256: c1be30552c155dfee201b9b51a64ddce5e46ddab4de13d4ec06cafeef3468f05

Verification:
- Node suite: 34 pass, zero fail, one Bun-only test skipped.
- Bun 1.4.0: eight selected service/portal/loader checks pass; four final bundle/observer checks pass after the last UI compatibility change.
- Three DOM integration checks pass: Markdown editor/sanitization, member vault/encrypted queued-save recovery, and KASH Home with late-response rejection after logout.
- 40 human catalog quotes and 37 comment references pass the exact-quote checker.
- Complete service bundles and the hash-checked 33-chunk loader build successfully.

No physical browser/mobile performance, provider end-to-end signup/payment, actual S3 health/redundancy, or device pairing is claimed. Map observations are private, owner-filtered and uncached. Backup roles and automatic cleanup remain unconfigured; map release/write actions are not granted. Legacy identity/storage/protocol namespaces remain compatible.

Railway environment: https://railway.com/project/29c6b365-6d5d-4eaa-9464-fde7f3182be8/service/fb8f559e-cadd-4555-a59a-0c8e045089af?environmentId=7e3a5a42-4351-44e8-960d-007f3071b031

Existing app address after deployment: https://ark-core-testing.up.railway.app/app/
