{
  description = "Blog Environment";

  inputs = {
    flake-parts.url = "github:hercules-ci/flake-parts";
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, flake-parts, ... }@inputs:
    flake-parts.lib.mkFlake { inherit inputs; } {
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];

      perSystem = { self', inputs', system, ... }: let
        pkgs = import inputs.nixpkgs { inherit system; };
      in {
        devShells.default = let
          mkShell = pkgs.mkShell.override { stdenv = pkgs.stdenvNoCC; };
        in
          mkShell {
            buildInputs = with pkgs; [ hugo ];
            packages = with pkgs; [ marksman ];
          };
      };
    };
}
