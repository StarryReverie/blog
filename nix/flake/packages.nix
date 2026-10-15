{
  config,
  inputs,
  lib,
  ...
}:
{
  perSystem =
    { config, pkgs, ... }:
    {
      legacyPackages = {
        default = config.legacyPackages.rendered;

        rendered = pkgs.callPackage ../packages/rendered.nix {
          # blogRevision = inputs.self.rev or inputs.self.dirtyRev or null;
        };
      };

      packages = lib.attrsets.filterAttrs (_: lib.isDerivation) config.legacyPackages;
    };
}
