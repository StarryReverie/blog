---
title: Wednesday, October 7, 2026 - 20:23
date: 2026-10-07T20:23:00+08:00
draft: false
math: false
---

写了一个 Nix 函数库的 DSL，模仿 Haskell 的模块系统。

模块内：

```nix
{ lib, use }:
let
  inherit (use "data.nullable")
    mapNullables
    ;
in
# ...
```

模块树根部：

```nix
{
  pkgs ? import <nixpkgs> { },
  lib ? pkgs.lib,
}:
import ./modular.nix {
  inherit lib;
  moduleDir = ./src;
}
```

Haskell 的怎么组织模块，这里就怎么组织，不同之处就是用 `use` 代替 `import`。如果想要 qualified import，可以直接写 `nullable = use "data.nullable"`。

PS：其实这个语法更像 Zig（笑

`modular.nix` 的实现如下：

```nix
{
  lib,
  moduleDir,
}:
let
  evaluate = x: builtins.seq x x;

  singletonAttrs = name: value: { ${name} = value; };

  makeModuleTreeWithEnv =
    env: dir:
    let
      dirEntries = builtins.readDir dir;

      names = lib.lists.uniqueStrings (
        lib.flip lib.lists.concatMap (lib.attrsets.attrsToList dirEntries) (
          { name, value }:
          if value == "directory" then
            [ name ]
          else if value == "regular" && lib.strings.hasSuffix ".nix" name then
            [ (lib.strings.removeSuffix ".nix" name) ]
          else
            [ ]
        )
      );

      modules = lib.attrsets.listToAttrs (
        lib.flip lib.lists.map names (name: {
          inherit name;
          value =
            let
              children = lib.attrsets.optionalAttrs (lib.attrsets.hasAttr name dirEntries) (
                makeModuleTreeWithEnv env (dir + /${name}/.)
              );
            in
            if lib.attrsets.hasAttr "${name}.nix" dirEntries then
              rec {
                inherit children;
                path = dir + /${name}.nix;
                content = import path env;
              }
            else
              { inherit children; };
        })
      );
    in
    modules;

  makeModuleTree =
    dir:
    let
      moduleTree = makeModuleTreeWithEnv moduleEnv dir;

      moduleEnv = {
        inherit lib;

        use =
          modulePath:
          let
            rawAttrPath = lib.strings.splitString "." modulePath;
            attrPath = (lib.intersperse "children" rawAttrPath) ++ [ "content" ];
            err = builtins.abort "module path \"${modulePath}\" doesn't exist";
          in
          evaluate (lib.attrsets.attrByPath attrPath err moduleTree);
      };

      evalModuleTree =
        tree:
        builtins.deepSeq (lib.flip lib.lists.map (lib.attrsets.attrValues tree) (
          mod: builtins.seq (builtins.seq (mod.content or { }) (evalModuleTree mod.children)) 1
        )) tree;
    in
    {
      inherit (moduleEnv) use;
      moduleTree = evalModuleTree moduleTree;
    };
in
makeModuleTree moduleDir
```
