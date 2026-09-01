{
  description = "krantenwijk — config-driven planner for door-to-door delivery routes";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "aarch64-darwin"
        "x86_64-darwin"
        "aarch64-linux"
        "x86_64-linux"
      ];
      forAllSystems =
        f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      devShells = forAllSystems (pkgs: {
        # Engine (Python via uv) + web app (Node via pnpm). Both managers vendor
        # their deps locally — uv into engine/.venv, pnpm into web/node_modules —
        # and use only pre-built wheels/packages, so mkShellNoCC keeps the
        # C/clang toolchain off PATH. pmtiles (go-pmtiles) provides the CLI for
        # carving the basemap extract into data/tiles/. postgresql is here for
        # its client/server binaries, not a running service: the engine's tests
        # spin a throwaway cluster into a tmpdir (see engine/tests/conftest.py).
        # Pinned to 16 to match esther, so the SQL we test is the SQL we run.
        default = pkgs.mkShellNoCC {
          packages = [
            pkgs.python313
            pkgs.uv
            pkgs.nodejs_22
            pkgs.pnpm
            pkgs.pmtiles
            pkgs.postgresql_16
          ];

          shellHook = ''
            # Use the nix-provided interpreter; don't let uv fetch its own.
            export UV_PYTHON="${pkgs.python313}/bin/python3.13"
            export UV_PYTHON_DOWNLOADS=never
            # Auto-install the privacy pre-commit guard (idempotent).
            git config core.hooksPath .githooks 2>/dev/null || true
            echo "krantenwijk dev — $(python3 --version), uv $(uv --version), node $(node --version), pnpm $(pnpm --version), $(pg_ctl --version)"
          '';
        };
      });
    };
}
