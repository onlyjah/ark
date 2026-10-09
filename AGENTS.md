# Ark Constellation implementation rules

This repository holds a portable backend. The canonical static client remains
in onlyjah/onlyjah-com. No template or proprietary OnlyJah finance module is
included in this public core preview.

Preserve exact human quotes. Brief API/status documentation is technical prose,
not editorial wording attributed to Jah. Comments must explain requirement IDs,
authority boundaries, assumptions, retry/denial behavior and remaining gaps.

Read docs/DECISIONS.md before changing a module boundary. Private data must never
enter data/public-catalogue.json, public responses, logs or browser caches.
Graph presence, payment, organization labels and mesh membership grant nothing.
Do not add a permissive temporary login or a token in the browser to bypass IAM.

Use pnpm and the checked-in lockfile. Run pnpm build and pnpm test. Deploy code
from a bounded branch and verify terminal SUCCESS plus actual HTTPS responses.
Keep staged production patches and existing Ark phone storage independent.

No live finance, PostgreSQL migration, identity replacement or mesh enrollment
is activated by this pilot. Add reviewed adapters and negative integration
checks before claiming those capabilities. Record actual source, release,
verification and unresolved work in docs/DEPLOYMENT.md and docs/WEEDS.md.
