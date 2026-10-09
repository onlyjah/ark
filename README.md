# Ark
What if the oceans were skies and ships were made of clouds? That's Ark

## Constellation 0.1
Portable modular public-index backend. The canonical static client lives in
[onlyjah/onlyjah-com](https://github.com/onlyjah/onlyjah-com). This is a bounded
read-only first slice; private commands, financial automation and mesh enrollment
are inactive. See [decisions](docs/DECISIONS.md), [deployment](docs/DEPLOYMENT.md), and [weeds](docs/WEEDS.md).

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm start
```

Default port: 3000. Railway uses PORT. Only data/public-catalogue.json is exposed;
private research snapshots and credential inventories are excluded.

Endpoints: /health/live, /health/ready, /api/v1/capabilities,
/api/v1/public/catalogue, /api/v1/public/projects,
/api/v1/public/projects/{id}, /api/v1/public/graph,
/api/v1/public/events and /openapi.json.

The public API has conditional reads, bounded graph traversal and public revision
notifications. Publication updates use reviewed Git commits and deployment.
Private endpoints require a future verified session and resource-grant adapter;
sending an arbitrary bearer token never provides access.

The Dockerfile supplies an organizational-hosting profile. Production needs an
image digest, host TLS, monitoring, an operator and measured acceptance evidence.
The reference PostgreSQL finance model remains in the private research package.
