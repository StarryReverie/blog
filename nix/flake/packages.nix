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

        rendered = pkgs.callPackage ../packages/rendered.nix (
          lib.optionalAttrs (inputs.self.rev or inputs.self.dirtyRev or null != null) {
            blogRevision = inputs.self.rev or inputs.self.dirtyRev;
          }
        );
      };

      packages = lib.attrsets.filterAttrs (_: lib.isDerivation) config.legacyPackages;
    };
}
