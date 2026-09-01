# Basemap: shared host (default) vs. local

krant's map (`web/src/lib/map/basemap.ts`) draws vector tiles from a self-hosted
Protomaps **PMTiles** archive over HTTP range requests, with the MapLibre style
built client-side (`@protomaps/basemaps`). Both the tile archive and the
glyphs/sprites have a default source and a build-time override.

## Default — the shared host, zero config

Out of the box krant points at the shared self-hosted tile service:

- tiles  → `pmtiles://https://tiles.hlink.dev/europe.pmtiles`
- glyphs → `https://tiles.hlink.dev/fonts/{fontstack}/{range}.pbf`
- sprite → `https://tiles.hlink.dev/sprites/v4/{light,dark}`

`tiles.hlink.dev` is a single **Europe** archive (+ glyphs + sprites) served
from the `esther` homelab box: a static vhost with HTTP Range support, open
CORS, and TLS/caching at the Cloudflare edge. It's shared by every hlink.dev
map front-end (krant, forj, klym) — no per-app tile copy, no third-party
basemap, no tokens. Europe is a superset of the Netherlands, so krant only ever
requests tiles inside its viewport; pointing at the Europe file costs nothing
and looks identical.

Nothing to set up — a fresh `pnpm build` / `pnpm dev` just works, provided
esther is reachable. This is the right default for any deployed instance.

## Override — fully local / offline

Two `VITE_*` build-time vars (see `basemap.ts`) redirect the two sources; set
them to run with no dependency on esther or the internet (development, or an
air-gapped instance — fits krant's browser-first, engine-stores-nothing design):

- `VITE_TILES_URL` — the `.pmtiles` archive. Point at the engine's range
  endpoint (`/api/tiles/basemap.pmtiles`), which serves the local extract from
  `data/tiles/basemap.pmtiles`. Carve that file per the README:

  ```sh
  pmtiles extract <europe-or-planet.pmtiles> data/tiles/basemap.pmtiles \
    --bbox=3.2,50.7,7.3,53.7      # the Netherlands
  ```

- `VITE_TILES_ASSETS` — the glyphs/sprites base. Point at the vendored assets
  under `web/static/basemaps/` (served at `/basemaps`), so no font/sprite fetch
  leaves the origin.

## Notes

- The shared archive is a **manual ~48 GB root:root drop** on esther under
  `/var/lib/tiles/` (`europe.pmtiles` + `fonts/` + `sprites/`) — not in git.
  The caddy vhost, CORS, Cloudflare tunnel, and the **from-scratch rebuild
  command** for the archive all live in the dotfiles repo
  (`hosts/esther/default.nix`). Regenerating it is an esther-side op, not a
  krant one.
- Health-check the shared host:
  `curl -I -H 'Range: bytes=0-99' https://tiles.hlink.dev/europe.pmtiles`
  → expect `HTTP/2 206` + a `Content-Range` header.
- Attribution (Protomaps © OpenStreetMap contributors) is baked into the style
  and required regardless of source.
