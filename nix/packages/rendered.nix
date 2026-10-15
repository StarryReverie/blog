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

  buildPhase = ''
    # Hugo doesn't follow symlinks.
    cp -r ${finalAttrs.npmDeps}/node_modules node_modules
    hugo --minify --destination=$out ${lib.optionalString (baseUrl != null) "--baseURL=\"${baseUrl}\""}
  '';
})
