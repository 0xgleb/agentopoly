{
  lib,
  stdenv,
  fetchurl,
}:

if stdenv.hostPlatform.isDarwin && stdenv.hostPlatform.isAarch64 then
  stdenv.mkDerivation {
    pname = "bare-runtime";
    version = "1.31.0";

    src = fetchurl {
      url = "https://registry.npmjs.org/bare-runtime-darwin-arm64/-/bare-runtime-darwin-arm64-1.31.0.tgz";
      hash = "sha512-WcDMErk9Z+aXykvWrntKHZd3886w8dSFlBKB7vCRq4fRhVvOOuQA3dAfZOyoyjapLDbAmDuz3z1J3oWi1ejTHg==";
    };

    sourceRoot = "package";
    unpackPhase = "tar -xzf $src";

    installPhase = ''
      install -Dm755 bin/bare $out/bin/bare
    '';

    meta = {
      description = "Bare runtime for protocol compatibility fixtures";
      homepage = "https://github.com/holepunchto/bare-runtime";
      license = lib.licenses.asl20;
      platforms = lib.platforms.darwin;
    };
  }
else
  throw "Bare protocol fixtures currently require a dedicated prebuilt runtime for this platform"
