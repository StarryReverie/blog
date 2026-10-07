{ config, inputs, ... }:
{
  perSystem =
    { system, pkgsDev, ... }:
    {
      devShells.default = pkgsDev.mkShellNoCC {
        packages = [
          pkgsDev.hugo
          pkgsDev.nodejs

          pkgsDev.nixfmt
          pkgsDev.treefmt
        ];
      };
    };
}
