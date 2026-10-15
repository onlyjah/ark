# KA$H.app client

TypeScript, React, TanStack Router and TanStack Query. Vite produces static
assets; there is no Node application server in this Go profile.

```sh
npm ci --ignore-scripts
npm run dev
```

Run the Go API on `127.0.0.1:8080`. Vite proxies `/app/api` and `/kash/v1` there.
Set `KASH_APP_ORIGIN=http://localhost:5173` on the API when using Vite's default
development URL; browser origins are checked explicitly.

`../ui/theme.css` contains shared semantic tokens compatible with shadcn themes.
The current primitives are local React/HTML components, not installed shadcn
registry components. Vue and Solid adapters have not been implemented.

The storage-world map is a framework-independent custom element loaded only
when the signed-in map view opens. It uses Canvas2D, not a game-engine runtime.

Tokens and unlocked content keys stay in memory. Only the non-secret client ID
is stored in localStorage. The files view encrypts file names and bytes locally;
the server sees the placeholder name, resource IDs, ciphertext sizes and times.

The SO/IL provider iframe uses the existing `xtp/soil` handshake. The actual
provider integration still needs an end-to-end activation check.
