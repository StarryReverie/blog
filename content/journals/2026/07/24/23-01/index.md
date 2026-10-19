---
title: Friday, July 24, 2026 - 23:01
date: 2026-07-24T23:01:00+08:00
draft: false
math: false
---

Nix 打包时可能会遇到需要引用包自身的情况，如果 `finalAttrs` 可用，则可以用 `finalAttrs.finalPackage`。但是如果没办法使用 `finalAttrs`，情况就不一样了。`finalPackage` 可以通过 `package.nix` 这个 lambda 的参数传入，在 `callPackage` 后利用 `let in` 或 `fix` 函数来把这个结果传入进去。这样的问题在于传入的 `finalPackage` 不会跟随 `override` 和 `overrideAttrs` 变化。

我的解决方案是在 `callPackage` 后替换原有的 `override` 和 `overrideAttrs` 为自己的版本，调用原来的 `override`/`overrideAttrs` 后额外 `override` 一次 `finalPackage` 参数。

假设有以下 `package.nix`：

```nix
{
  stdenvNoCC,
  testFinalPackage,
  myText ? "myText",
}:

stdenvNoCC.mkDerivation {
  pname = "test-package";
  version = "0";

  dontUnpack = true;

  installPhase = ''
    echo ${myText} > $out
  '';

  passthru.finalPackage = testFinalPackage;
}
```

以下代码片段实现了 `override` 和 `overrideAttrs` 自动传入新 `finalPackage`：

```nix
let
  pkgs = import <nixpkgs> { };
  lib = pkgs.lib;
in

let
  makePackageOverridable =
    finalPackageName: package:
    package
    // {
      override =
        args:
        let
          overriddenPackage = ((package.override args).override { ${finalPackageName} = newPackage; });
          newPackage = makePackageOverridable finalPackageName overriddenPackage;
        in
        newPackage;

      overrideAttrs =
        args:
        let
          overriddenPackage = ((package.overrideAttrs args).override { ${finalPackageName} = newPackage; });
          newPackage = makePackageOverridable finalPackageName overriddenPackage;
        in
        newPackage;
    };

  finalPackageAwaredCallPackage =
    callPackage: func: finalPackageName: attrs:
    let
      called = callPackage func (attrs // { ${finalPackageName} = finalPackage; });
      finalPackage = makePackageOverridable finalPackageName called;
    in
    finalPackage;

  p = finalPackageAwaredCallPackage pkgs.callPackage ./package.nix "testFinalPackage" { };
in
{
  inherit pkgs lib;

  inherit p;
}
```

在 Nix REPL 中测试：

```plain
nix-repl> :l ./test.nix
Added 3 variables.

nix-repl> p
«derivation /nix/store/a5a5pykbm30fgyhy40nqz0iis969k6yc-test-package-0.drv»

nix-repl> p.finalPackage
«derivation /nix/store/a5a5pykbm30fgyhy40nqz0iis969k6yc-test-package-0.drv»

nix-repl> p2 = (p.override { myText = "myText2"; }).overrideAttrs { version = "1"; }
Updated p2.

nix-repl> p2
«derivation /nix/store/wpxlrqdqminbhhsn3g1yws2160lnwn5k-test-package-1.drv»

nix-repl> p2.finalPackage
«derivation /nix/store/wpxlrqdqminbhhsn3g1yws2160lnwn5k-test-package-1.drv»
```
