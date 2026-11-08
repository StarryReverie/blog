{ config, inputs, ... }:
{
  perSystem =
    { system, pkgsDev, ... }:
    {
      checks.pre-commit = inputs.git-hooks.lib.${system}.run {
        src = ../../../.;
        hooks.markdownlint.enable = true;
        hooks.treefmt.enable = true;
        hooks.typos.enable = true;
      };
    };
}
