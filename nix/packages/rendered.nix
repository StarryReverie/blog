{
  hugo,
  importNpmLock,
  lib,
  nodejs_latest,
  stdenvNoCC,

  blogRevision ? null,
  baseUrl ? null,
}:
let
  nodejs = nodejs_latest;
in
stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "blog-rendered";
  version = "ng-${if blogRevision != null then blogRevision else "unversioned"}";

  __structuredAttrs = true;
  strictDeps = true;

  src = lib.fileset.toSource {
    root = ../../.;
    fileset = lib.fileset.unions [
      ../../content
      ../../site

      ../../hugo.yaml
      ../../package-lock.json
      ../../package.json
    ];
  };

  npmDeps = importNpmLock.buildNodeModules {
    npmRoot = finalAttrs.src;
    inherit nodejs;
  };

  nativeBuildInputs = [
    hugo
    nodejs
  ];

  configurePhase =
    let
      optionalCfg = key: value: lib.optionalString (value != null) "${key}: ${value}";
    in
    ''
      cat > hugo.override.yaml <<EOF
      ${optionalCfg "baseURL" baseUrl}
      params:
        build:
          ${optionalCfg "revision" blogRevision}
      EOF
    '';

  buildPhase = ''
    # Hugo doesn't follow symlinks.
    cp -r ${finalAttrs.npmDeps}/node_modules node_modules
    hugo --config=hugo.yaml,hugo.override.yaml \
      --minify \
      --destination=$out
  '';
})
