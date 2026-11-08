{ config, inputs, ... }:
{
  perSystem =
    { config, pkgsDev, ... }:
    {
      devShells.default = pkgsDev.mkShellNoCC {
        packages = [
          pkgsDev.hugo
          pkgsDev.nodejs_latest

          pkgsDev.just

          pkgsDev.markdownlint-cli2
          pkgsDev.nixfmt
          pkgsDev.treefmt
          pkgsDev.typos
        ]
        ++ config.checks.pre-commit.enabledPackages;

        inherit (config.checks.pre-commit) shellHook;
      };
    };
}
