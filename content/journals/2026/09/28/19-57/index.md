---
title: Unused
date: 2026-09-28T19:57:00+08:00
draft: false
math: false
---

纯 Nix 实现的 `nix-eval-jobs` —— `eval-jobs.nix` 来了（

```nix
{ lib }:
let
  # If cond is true, then return the value, return null otherwise.
  optionalNullable = # ... -> Nullable x
    cond: # Bool
    x: # x
    if cond then x else null;

  # Map elements to other elements or nulls and filter out nulls.
  mapNullables = # ... -> [x] -> [x]
    f: # x -> Nullable x
    lib.lists.concatMap (
      x:
      let
        y = f x;
      in
      if y != null then [ y ] else [ ]
    );

  # Transform the attrset and optionally filter out some elements.
  filterMapAttrsRecursiveCond = # ... -> Attrset
    recursePred: # AttrSet -> Bool | Whether to recurse into this attrset or treat it as leaf.
    mapper: # [String] -> Any -> Nullable Any | Map this leaf element given its path.
    attrs: # AttrSet | The attrset to transform.
    let
      recurseImpl = # ... -> Attrset
        path: # [String]
        attrs: # Attrset
        lib.pipe attrs [
          lib.attrsets.attrsToList
          (mapNullables (
            { name, value }:
            let
              subPath = path ++ [ name ];
              shouldRecurse = lib.isAttrs value && recursePred value;
              newValue = if shouldRecurse then recurseImpl subPath value else mapper subPath value;
            in
            lib.mapNullable (lib.attrsets.nameValuePair name) newValue
          ))
          lib.attrsets.listToAttrs
        ];
    in
    recurseImpl [ ] attrs;

  # Selectively retrieve packages with some convenient metadata and filter out non-derivation
  # elements using a custom predicate.
  evalJobsWithPred = # ... -> [AttrSet]
    drvPred: # Derivation -> Bool | Whether to build this derivation.
    packageSet: # AttrSet | Package set to process.
    let
      toJobMetadata = path: drv: {
        inherit drv;
        inherit (drv)
          name
          drvPath
          outputs
          system
          ;
        attr = lib.strings.concatStringsSep "." path;
        attrPath = path;
        outPaths = lib.lists.map (outputName: drv.${outputName}.outPath) drv.outputs;
        type = "jobMetadata";
      };

      filteredPkgs = filterMapAttrsRecursiveCond (attrs: !(lib.isDerivation attrs)) (
        path: value: optionalNullable (lib.isDerivation value && drvPred value) (toJobMetadata path value)
      ) packageSet;

      flattenedPkgsList =
        let
          flattenImpl =
            value:
            if lib.isAttrs value then
              if value.type or "" == "jobMetadata" then
                [ value ]
              else
                lib.lists.concatMap flattenImpl (lib.attrsets.attrValues value)
            else
              [ ];
        in
        flattenImpl filteredPkgs;
    in
    flattenedPkgsList;

  # Default predicate for filter derivations that needn't to built.
  defaultDrvPred = # ... -> Bool
    drv: # Derivation
    let
      isBuildable =
        drv:
        let
          licenseFromMeta = drv.meta.license or [ ];
          licenseList = if lib.isList licenseFromMeta then licenseFromMeta else [ licenseFromMeta ];
        in
        !(drv.meta.broken or false) && lib.lists.all (license: license.free or true) licenseList;

      isCacheable = drv: !(drv.preferLocalBuild or false);
    in
    isBuildable drv && isCacheable drv;

  # Selectively retrieve packages with some convenient metadata and filter out non-derivation
  # elements.
  evalJobs = # ... -> [AttrSet]
    packageSet: # AttrSet | Package set to process.
    evalJobsWithPred defaultDrvPred packageSet;
in
{
  inherit
    evalJobs
    evalJobsWithPred
    defaultDrvPred
    ;
}
```
