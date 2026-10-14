# KASH on Ark

KASH is the browser/client operator. Ark supplies durable storage, immutable
revisions and resource authority. This is the canonical runnable source for
**KASH App → staging**, version **0.4.0**.

Source is published; the 17-change Railway release is staged and blocked by the
automatic approval layer. The running release has not been replaced.

Start with [installation](docs/INSTALL.md), the [SO/IL SDK](xtp/soil/README.md),
and the [staging record](docs/KASH-STAGING.md). Private state and credentials
stay out of the repository.

```sh
npm ci --ignore-scripts
npm run build
npm test
npm run check:quotes
node scripts/install.ts --data /absolute/path/on/your/drive/kash/ark
```

The installer needs Docker Compose. It prepares a persistent local installation,
including a private access file, rather than merely cloning source. Android uses
the installable browser app; portable launchers are separate per-platform builds.

The new shared SDK lives at **`xtp/soil`**. `SOIL_API_URL` selects the provider API;
`SOIL_APP_URL` selects the embedded/standalone identity and accounts app. Strict
SO/IL mode verifies every private request. Staging currently preserves existing
compatible enrollment and Neon sessions while the remote provider contract is
prepared; those sessions are not labelled as remotely SO/IL-verified.

The map reports observed state. Independent backups, native all-file sync,
concurrent delete/edit merging and automatic eviction remain unfinished. A cloud
save is not proof of redundant protection.

The older platform and Constellation previews remain in Git history and their
pinned deployment branches. `web/`, `xtp/soil/`, `services/` and `packages/core/`
are the current implementation; generated bundles are built rather than edited.
Human quotes remain exact in [the quote catalog](quotes/README.md). This technical
README is implementation documentation and is not attributed as Jah's wording.
No software license has been selected.
