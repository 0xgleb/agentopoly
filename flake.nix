{
  description = "Agentopoly development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";
    flake-utils.url = "github:numtide/flake-utils";
    but-nix.url = "github:dataclique/but.nix/53d9f2d49b14354acbbd2fc832f19059c2bfc751";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
      but-nix,
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs { inherit system; };
        butPackages = import ./but.nix {
          inherit system but-nix;
        };
      in
      {
        devShells.default = pkgs.mkShell {
          packages =
            with pkgs;
            [
              bun
              nodejs_22
              nixfmt
              deadnix
              statix
              nushell
            ]
            ++ butPackages;

          shellHook = ''
            export AGENTOPOLY_REPOSITORY_ROOT="$PWD"
          '';
        };

        formatter = pkgs.nixfmt;

        checks.nix-format =
          pkgs.runCommand "agentopoly-nix-format" { nativeBuildInputs = [ pkgs.nixfmt ]; }
            ''
              cp -r ${self} source
              chmod -R u+w source
              nixfmt --check source/flake.nix source/but.nix
              touch $out
            '';
      }
    );
}
