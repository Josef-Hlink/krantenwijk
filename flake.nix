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
        # C/clang toolchain off PATH. go-pmtiles provides the `pmtiles` CLI for
        # carving the basemap extract into data/tiles/.
        default = pkgs.mkShellNoCC {
          packages = [
            pkgs.python313
            pkgs.uv
            pkgs.nodejs_22
            pkgs.pnpm
            pkgs.go-pmtiles
          ];

          shellHook = ''
            # Use the nix-provided interpreter; don't let uv fetch its own.
            export UV_PYTHON="${pkgs.python313}/bin/python3.13"
            export UV_PYTHON_DOWNLOADS=never
            # Auto-install the privacy pre-commit guard (idempotent).
            git config core.hooksPath .githooks 2>/dev/null || true
            echo "krantenwijk dev — $(python3 --version), uv $(uv --version), node $(node --version), pnpm $(pnpm --version)"
          '';
        };
      });
    };
}
