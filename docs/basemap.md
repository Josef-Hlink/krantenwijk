# Basemap: local file vs. shared host

krant's map (`web/src/lib/map/basemap.ts`) draws vector tiles from a
self-hosted Protomaps **PMTiles** archive over HTTP range requests, with the
MapLibre style built client-side (`@protomaps/basemaps`) and glyphs + sprites
vendored under `web/static/basemaps/`. There are two ways to supply the tile
archive; both render identically.

## 1. Local (default) — self-contained, offline

Leave `VITE_TILES_URL` unset. The engine serves `data/tiles/basemap.pmtiles`
at `/api/tiles/basemap.pmtiles` (range requests), and the web dev server
proxies `/api`. This is the ~2 GB Netherlands extract from the README:

```sh
pmtiles extract <europe-or-planet.pmtiles> data/tiles/basemap.pmtiles \
  --bbox=3.2,50.7,7.3,53.7      # the Netherlands
```

Use this for **development and any offline / air-gapped instance** — no
network, no dependency on other infra, and it fits the browser-first,
engine-stores-nothing design. It's the default for a reason.

## 2. Shared host — one basemap for all the hlink.dev map apps

A single self-hosted **Europe** archive lives on the `esther` homelab box and
is served publicly at `https://tiles.hlink.dev/europe.pmtiles` (static file,
HTTP range requests, CORS open, TLS + caching at the Cloudflare edge). It's
shared by every hlink.dev map front-end (krant, okai, klym). Point krant at it
with the build-time override — no code change:

```sh
VITE_TILES_URL=https://tiles.hlink.dev/europe.pmtiles pnpm build
# or set it in web/.env for a deployed instance
```

Glyphs and sprites stay vendored/local (served from krant's own origin) — only
the big tile archive moves to the shared host, so there's **no ~2 GB file to
carve, ship, or keep in sync** per deployment. Europe is a superset of the
Netherlands: krant only ever requests tiles inside its viewport, so pointing at
the Europe file costs nothing and looks identical.

Use this for a **deployed krant instance** where esther is reachable. The
trade-off vs. local: you gain "no per-app tile copy," you take on a runtime
dependency on esther + the internet being up.

## Notes

- The shared archive is a **manual ~48 GB root:root drop** on esther under
  `/var/lib/tiles/europe.pmtiles` — not in git anywhere. The caddy vhost,
  CORS, and Cloudflare tunnel that serve it are defined in the dotfiles repo
  (`hosts/esther/default.nix`). Regenerating/replacing the archive is an
  esther-side op, not a krant one.
- Sanity-check the shared host is live:
  `curl -I -H 'Range: bytes=0-99' https://tiles.hlink.dev/europe.pmtiles`
  → expect `HTTP/2 206` + a `Content-Range` header.
- Attribution (Protomaps © OpenStreetMap contributors) is baked into the style
  and required regardless of which source you use.
