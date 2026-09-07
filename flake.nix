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
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      # Two build products, consumed by the host that serves them (for esther:
      # the dotfiles flake). `engine` is the FastAPI app as a `krantenwijk`
      # binary; `web` is the static SvelteKit build, a plain directory for any
      # file server to put behind the engine's /api. The module below wires
      # the engine into systemd; the web root is the host's caddy's business,
      # since it also decides the vhost, TLS and tunnel.
      packages = forAllSystems (pkgs: rec {
        default = engine;

        engine = pkgs.python313Packages.buildPythonApplication {
          pname = "krantenwijk";
          version = "0.1.0";
          pyproject = true;
          src = ./engine;

          build-system = [ pkgs.python313Packages.hatchling ];

          # Mirrors pyproject's dependency list; every one is in nixpkgs,
          # openrouteservice included — though nixpkgs' openrouteservice forgets
          # to declare `requests`, its one runtime dep, so it is listed here or
          # `import openrouteservice` dies at startup. pyproject spells the
          # psycopg extras as [binary,pool]: `binary` is PyPI's pre-built C
          # wheel, which is nixpkgs' `c` extra (built from source against libpq).
          dependencies = with pkgs.python313Packages; [
            click
            fastapi
            httpx
            openrouteservice
            requests
            psycopg
            pydantic
            pyyaml
            scikit-learn
            uvicorn
          ]
          ++ pkgs.python313Packages.psycopg.optional-dependencies.c
          ++ pkgs.python313Packages.psycopg.optional-dependencies.pool
          ++ pkgs.python313Packages.uvicorn.optional-dependencies.standard;

          # The metadata check knows nothing about extras and would refuse
          # psycopg[binary,…] since nixpkgs has no extra called binary.
          pythonRelaxDeps = true;
          pythonRemoveDeps = [ ];

          # The suite spins up a throwaway postgres cluster per run
          # (tests/conftest.py); that is the devShell's `uv run pytest` gate,
          # not something to repeat inside the sandbox on every deploy.
          doCheck = false;
          pythonImportsCheck = [ "krantenwijk" ];

          meta = {
            description = "Delivery-round planning engine (clustering, routing, time estimation)";
            license = pkgs.lib.licenses.mit;
            mainProgram = "krantenwijk";
          };
        };

        web = pkgs.stdenv.mkDerivation (finalAttrs: {
          pname = "krantenwijk-web";
          version = "0.1.0";
          src = ./web;

          nativeBuildInputs = [
            pkgs.nodejs_22
            pkgs.pnpm_10.configHook
          ];

          # Offline pnpm store. The hash pins the resolved dependency tree and
          # MUST be refreshed whenever pnpm-lock.yaml changes: set it to
          # `pkgs.lib.fakeHash`, build, paste back the "got: sha256-…" line.
          #
          # pnpm_10 (not nixpkgs' default pnpm 11) on purpose, like klym: with
          # the version-pinned attribute the fetch and the config hook run the same
          # pnpm, which is what keeps the offline store readable at install time.
          pnpmDeps = pkgs.pnpm_10.fetchDeps {
            inherit (finalAttrs) pname version src;
            fetcherVersion = 3;
            hash = "sha256-bF+5JqAoRnOqr+dc8B2636S0+jICt0k0GViVf6lCfJk=";
          };

          buildPhase = ''
            runHook preBuild
            pnpm build
            runHook postBuild
          '';

          # adapter-static writes build/ with index.html as the SPA fallback for
          # every route; the whole directory is the output.
          installPhase = ''
            runHook preInstall
            cp -r build $out
            runHook postInstall
          '';

          meta = {
            description = "krantenwijk web app (static SvelteKit build)";
            license = pkgs.lib.licenses.mit;
          };
        });
      });

      # services.krantenwijk — runs the engine on loopback. The host puts a
      # reverse proxy in front: /api/* to this port, everything else served
      # from `packages.web`. Storage is opt-in through databaseUrl (see
      # engine/.env.example for what setting it means).
      nixosModules.default =
        {
          config,
          lib,
          pkgs,
          ...
        }:
        let
          cfg = config.services.krantenwijk;
        in
        {
          options.services.krantenwijk = {
            enable = lib.mkEnableOption "krantenwijk delivery-round planning engine";

            package = lib.mkOption {
              type = lib.types.package;
              default = self.packages.${pkgs.stdenv.hostPlatform.system}.engine;
              defaultText = lib.literalExpression "krantenwijk.packages.\${system}.engine";
              description = "The engine package to run.";
            };

            host = lib.mkOption {
              type = lib.types.str;
              default = "127.0.0.1";
              description = "Bind address. Keep on loopback; the reverse proxy reaches it locally.";
            };

            port = lib.mkOption {
              type = lib.types.port;
              default = 4381;
              description = "Port the engine listens on.";
            };

            databaseUrl = lib.mkOption {
              type = lib.types.nullOr lib.types.str;
              default = "postgresql:///krantenwijk?host=/run/postgresql";
              description = ''
                Postgres connection string, or null to run the engine stateless
                (no accounts, no saved rounds; /api/rounds 404s). The default
                connects over the unix socket as the transient DynamicUser named
                "krantenwijk", which peer authentication maps straight onto the
                "krantenwijk" postgres role — no password, no secret file.

                The database and role are declared on the host (for esther, in
                dotfiles hosts/esther/postgres.nix); this module does not create
                them. The engine applies its schema on first connection, and the
                tables end up owned by whoever connects first — let the service
                do that, not a superuser shell.
              '';
            };

            environmentFile = lib.mkOption {
              type = lib.types.nullOr lib.types.path;
              default = null;
              example = "/etc/krantenwijk.env";
              description = ''
                systemd EnvironmentFile with secrets, kept out of the Nix store.
                Currently just ORS_API_KEY=… (openrouteservice.org). Unset, the
                engine silently falls back to straight-line routing badged
                "approximate" — check /api/status reports "routing": "ors".
              '';
            };
          };

          config = lib.mkIf cfg.enable {
            systemd.services.krantenwijk = {
              description = "krantenwijk delivery-round planning engine";
              wantedBy = [ "multi-user.target" ];
              # Ordering after postgresql matters when databaseUrl is set: a
              # reboot would otherwise race the engine against the cluster and
              # burn systemd's start-rate limit.
              after = [
                "network.target"
              ]
              ++ lib.optional (cfg.databaseUrl != null) "postgresql.service";
              wants = lib.optional (cfg.databaseUrl != null) "postgresql.service";

              environment = lib.optionalAttrs (cfg.databaseUrl != null) {
                KRANTENWIJK_DATABASE_URL = cfg.databaseUrl;
              };

              serviceConfig = {
                EnvironmentFile = lib.mkIf (cfg.environmentFile != null) cfg.environmentFile;
                ExecStart = "${lib.getExe cfg.package} serve --host ${cfg.host} --port ${toString cfg.port}";
                Restart = "on-failure";

                # DynamicUser is load-bearing: it creates a transient system user
                # literally named "krantenwijk", and peer auth over the unix
                # socket maps that name onto the postgres role of the same name.
                # Don't swap it for a static User= without giving the role a
                # password. The engine writes nothing to disk, so the rest can
                # stay locked down.
                DynamicUser = true;
                ProtectSystem = "strict";
                ProtectHome = true;
                PrivateTmp = true;
                NoNewPrivileges = true;
              };
            };
          };
        };

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
