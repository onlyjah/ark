# Ark Core

> “all my projects are sovereign” — Jah Noah, Q007
>
> “be sure to quote me on the shit that I be saying.” — Jah Noah, Q037

Ark Core is a small, runnable room-and-resource server for the OnlyJah / Ark direction. It connects independent installations through explicit, scoped sharing. Each room begins with a charter; at least three individually enrolled human members approve its exact revision before the owner can activate it. Files retain immutable revisions, and a second node can store a deliberately authorized recovery copy without mirroring the archive.

This new repository uses **Ark Core** as its title and **ark-core** as its git slug. It is a pilot implementation, not the full Ark system or a production launch. Its TypeScript/Node 24 executable is chosen from the user's permitted lightweight implementation options. A future Go/Rust implementation can use the same logical contracts, but no language-rewrite promise is made.

## Phone app

Open https://ark-core-testing.up.railway.app/app/ for private blog/article drafts and a personal 5 GB object archive. See [phone instructions](docs/PHONE-APP.md) for installation, private access-file sign-in, local unsaved drafts, revision history and current limits.

## Run and verify

Start with the [practical user guide](docs/USER-GUIDE.md): private operator access, collaborator enrollment, three-founder approval, document revisions, and an independent recovery node. Its commands use the included Python terminal helper and its topology follows the deployed implementation.

```sh
npm test
npm run check:quotes
node src/cli.ts help
node src/cli.ts identity 'Jah Noah' human
npm start
```

No dependency install is required. The direct Railway deployment is documented in [Railway deployment](docs/RAILWAY.md). See [deployment](docs/DEPLOY.md), [API](docs/API.md), [status and roadmap](docs/STATUS.md), and [quote catalog](quotes/README.md).

## Included

- Persistent node identity; embedded SQLite metadata and content-addressed local blobs.
- Operator-enrolled human and service identities with individually revocable expiring credentials.
- Rooms, immutable draft charters, three-founder approvals, owner activation, reader/editor membership.
- Owner-controlled scope grants, deliberate peer replication, integrity checks and revocation.
- Durable operation receipts, revision conflict detection, event polling and local snapshot/export.
- Container configuration and CI; a reusable client interface for a future static frontend.
- Forty attributed quote records and quote-led comments, checked automatically.

Governance is owner-led in this first pilot. Member-led decisions and executable charter rules remain future work. The three-founder policy applies to all rooms this server creates; no personal/two-person exception has been silently added. Human eligibility is vouched for by the local operator. Private backups remain private. No existing website, branch, database, billing service, or domain is changed by this repository.

## Shared frontend boundary

> “when I add a new feature, I don't got to edit 15 different projects at once” — Jah Noah, Q006

`client/ark-client.ts` shows a common API client with site configuration. A shared frontend repository can release modules once and deploy selected releases to opted-in sites. Independent projects must retain version pinning, rollback and self-hosting. This backend does not include the TanStack static website build or a mutable script loaded into every site.

## Authorship and reuse

Quotes are exact human excerpts from the supplied text, with source labels and stable IDs. Engineering prose and code are assistant-created implementation work and are not attributed to Jah Noah as verbatim speech. No AI-generated article or imagery has been published to the author's websites. No software license is selected yet; choose one before presenting this repository as licensed open source.

Platform refactor status, topology, encryption boundaries and staged-release usage: [docs/PLATFORM.md](docs/PLATFORM.md).
