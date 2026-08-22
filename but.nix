{
  but-nix,
  system,
}:
let
  packages = but-nix.packages.${system};
in
[
  packages.gitbutler-cli
  packages.pr-stack-footer
]
