{
  description = "Blog (Development)";

  # From super-flake.
  inputs.flake-parts = {
    url = "github:hercules-ci/flake-parts/main";
    inputs.nixpkgs-lib = {
      follows = "nixpkgs";
    };
  };

  inputs.nixpkgs = {
    url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  inputs.systems = {
    url = "github:nix-systems/default/main";
  };

  # Development only.
  inputs.flake-compat = {
    url = "https://git.lix.systems/lix-project/flake-compat/archive/main.tar.gz";
    flake = false;
  };

  outputs = _inputs: { };
}
