{
  hugo,
  importNpmLock,
  lib,
  nodejs,
  stdenvNoCC,

  blogRevision ? "unversioned",
  baseUrl ? null,
}:
stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "blog-rendered";
  version = "ng-${blogRevision}";

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

  configurePhase = ''
    cat > hugo.override.yaml <<EOF
    params:
      build:
        revision: "${blogRevision}"
    EOF
  '';

  buildPhase = ''
    # Hugo doesn't follow symlinks.
    cp -r ${finalAttrs.npmDeps}/node_modules node_modules
    hugo --config=hugo.yaml,hugo.override.yaml \
      --minify \
      --destination=$out \
      ${lib.optionalString (baseUrl != null) "--baseURL=\"${baseUrl}\""}
  '';
})
