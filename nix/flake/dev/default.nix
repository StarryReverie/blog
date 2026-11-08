{ config, inputs, ... }:
{
  imports = [
    ./checks.nix
    ./devshells.nix
  ];

  perSystem =
    { system, pkgs, ... }:
    {
      _module.args.pkgsDev = pkgs;
    };

  flake.inputsDev = inputs;
}
