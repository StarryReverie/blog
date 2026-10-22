{ config, inputs, ... }:
{
  perSystem =
    { system, pkgsDev, ... }:
    {
      devShells.default = pkgsDev.mkShellNoCC {
        packages = [
          pkgsDev.hugo
          pkgsDev.nodejs_latest

          pkgsDev.just

          pkgsDev.nixfmt
          pkgsDev.treefmt
        ];
      };
    };
}
