# krantenwijk

*Dutch: paper round.* A config-driven planner for door-to-door delivery
routes: upload a CSV of addresses, see them as dots on a map, hand-draw
delivery buckets, assign carriers, compute walking routes, and export a
sorted delivery list.

Privacy-first by construction: the CSV is parsed, mapped, and exported
entirely in your browser. The Python engine only ever receives coordinates
and stores nothing. Upload a file that already has `lat`/`lon` columns and
no address data leaves the browser at all.

## Development

Requires [nix](https://nixos.org) + [direnv](https://direnv.net) (or bring
your own Python 3.13 + uv and Node 22 + pnpm).

```sh
direnv allow                  # devShell: python, uv, node, pnpm, pmtiles
cd engine && uv sync --extra dev && cd ..
direnv reload                 # picks up engine/.venv
cd web && pnpm install
```

Basemap: by default the app reads tiles, glyphs, and sprites from the shared
self-hosted tile service at `tiles.hlink.dev` (Protomaps-schema PMTiles —
no third-party map requests). To go fully offline or self-host, place a
PMTiles extract at `data/tiles/basemap.pmtiles` (the engine serves it at
`/api/tiles/basemap.pmtiles` with range requests):

```sh
pmtiles extract <europe-or-planet.pmtiles> data/tiles/basemap.pmtiles \
  --bbox=3.2,50.7,7.3,53.7      # the Netherlands
```

and point the web build at it with `VITE_TILES_URL` (plus `VITE_TILES_ASSETS`
for a glyphs/sprites host).

Run (two terminals):

```sh
uv run krantenwijk serve --reload   # engine  → 127.0.0.1:4381
cd web && pnpm dev                  # web app → localhost:4382, proxies /api
```

Try it with the Vlissingen demo on the landing page — real addresses from
[OpenStreetMap](https://www.openstreetmap.org/copyright) (© OpenStreetMap
contributors, ODbL), carrying an entirely fictional delivery round. No real
people or deliveries are referenced anywhere in this repo.

## License

[MIT](LICENSE)
