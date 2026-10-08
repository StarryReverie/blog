---
title: 自动化 NUR
date: 2026-10-08T09:46:45+08:00
draft: false
categories: Tech
tags:
  - Scripting
  - Nix
math: false
---

构建全自动构建、更新和缓存的 Nix User Repository。

<!--more-->

## 背景

随着我的 [NixOS 配置仓库](https://github.com/StarryReverie/StarryNix-Infrastructure) 中包含的非 Nixpkgs 包越来越多，每次 NixOS 更新的时间都大幅增加，大多数都浪费在复制各种工具链及构建时依赖和编译上。虽然我的几个个人项目已经相继集成了自己的 Binary Cache，理想情况下可以避免重复构建，但是在 NixOS 配置 Flake 中依赖这些 Flake 总感觉没有那么方便，且为了吃上缓存不得不间接引入多个 Nixpkgs。

因此我决定把大部分的第三方包都放进 NUR 并由 NUR 维护一个独立的 Binary Cache，NixOS 配置依赖 NUR，这样就可以尽可能减少额外的 Flake 依赖了。

为了使今后的使用更方便，自动化改造是非常必要的。本文记录了我的升级过程与自动化的方案。最终的 NUR 仓库位于 [StarryNix-Derivations](https://github.com/StarryReverie/StarryNix-Derivations)。

## 总体架构

### 打包方式

我认为 Nix 的打包可以分为两种：本地打包和外部打包（不要介意随意的命名）。

本地打包一般用于独立的软件项目，在同一个源码仓库中维护 Nix Derivation，Nix 在求值此 Derivation 时可以直接访问到所有的源代码，从 Derivation 的角度来说，这些内容都是 Input Sources。

外部打包就是 Nixpkgs 和 NUR 将要采取的方式，打包的目标是其他的仓库，Derivation 无法在求值阶段获取到源代码。这种方法获取源代码的方式是 Fixed Output Derivation，FOD 作为原 Derivation 的 Input Derivations。FOD 在求值阶段只指定一个预先写死的 Hash 约束源代码的内容是什么样子，在构建阶段 Nix 给这个源代码的 Derivation 开洞，允许其访问网络来获取源代码，但是最终的结果需要与 Hash 一致。最终源代码作为 Derivation Output 提供给原 Derivation，原 Derivation 就可以在构建期访问这些源代码了。

两种方式的区别在于源代码是在什么时候被获取到的。本地打包可以在求值阶段获取，外部打包在构建阶段获取。由于 Nix 的性能不是很好，在求值阶段无法并行，我想要尽可能减少求值的时间，把工作移动到构建阶段。

求值阶段获取源代码有巨大的问题，那就是网络请求会阻塞求值过程。Nix 不会自动并行化求值过程，也没有任何办法手动启用并行求值。所以网络请求将会大幅拖慢求值速度，Import From Derivation 备受诟病的性能问题其实也和这很类似。

Flake 其实是求值阶段获取源码的一个特殊形式。Flake 基于的 `builtins.fetchTree` 就是一个求值阶段的 Fetcher，所以在求值一个 Flake 的 Outputs 时理论上也会触发用 `builtins.fetchTree` 获取所有的 Flake 依赖。不过这个问题似乎没有那么容易察觉，我认为这与我们的工作流有关，大部分情况是先 `nix flake update`，这个过程会预先获取所有的依赖，随后再使用其他各种工具对 Flake 求值，同时 `direnv` 也会固定当前 Flake 的直接依赖使其不被 GC。但是 Flake 传递依赖不会被这个流程覆盖，所以当我们不 `follow` 直接依赖的依赖时，就可能会遇到求值阶段有额外的 `fetching github input ...` 或 `copying /nix/store/... from ...` 的输出。

外部打包使用的 FOD Fetcher，如 `pkgs.fetchFromGitHub`，就没有这种问题，因为这些 Fetcher 的参数完全是简单的值，Nix 不必在求值阶段做更多复杂的工作。所以外部打包即 FOD 方案是更适合 NUR 的，求值时间不会随着仓库维护的 Derivation 数量增长而大幅增长，NUR Flake 也不必为每一个包增加一个 Flake Input。

### 仓库结构

NUR 仓库是一个 Flake，所以 Flake Inputs 这一方面也有讲究。Flake 本身对于依赖没有分类，不存在开发依赖这一说法，导致各种依赖都会被无脑添加到下游 Flake 中。我对于 `agenix-rekey` 印象深刻，其带有 `treefmt-nix`、`devshell` 等仅仅和开发者相关的工具，但是在我的仓库求值阶段却仍然要获取。

对于这一问题，从根源上的解决方法是不要引入更多的 Flake 依赖。但是我还是想要用一些开发依赖，所以我使用了 [`flake-parts.flakeModules.partition`](https://flake.parts/options/flake-parts-partitions.html)。其可以把 Flake 额外划分成多个 Partition，部分 Flake Outputs 可以由 Partition 提供，因此求值过程和相关依赖获取也按需进行。对于我的 NUR，我使用了一个 `dev` Partition，把 `devShells` 等部分都放在这里。只要我不在下游 Flake 去引用这些 Flake Outputs，就不会有任何求值发生。

所以我按照这个思路设计了以下的结构，`./repo-nix/flake/` 是完全公开的部分，`./repo-nix/flake/dev/` 是开发环境的部分。

```bash
$ tree
.
├── repo-nix
│   ├── flake
│   │   ├── dev
│   │   │   ├── default.nix
│   │   │   ├── devshells.nix
│   │   │   ├── flake.lock
│   │   │   └── flake.nix
│   │   ├── default.nix
│   │   └── ...
│   ├── flake-compat.nix
│   └── ...
├── ...
```

剩下的部分，则是：

```bash
$ tree -L 2
.
├── pkgs
│   ├── drvgraph
│   ├── kvlibadwaita
│   ├── nclock-screensaver
│   ├── nmlinkd
│   ├── orchis-kde
│   ├── stinkpot
│   ├── updateUtils
│   └── default.nix
├── repo-nix
│   ├── ci
│   ├── flake
│   ├── lib
│   └── flake-compat.nix
├── default.nix
├── flake.lock
├── flake.nix
├── LICENSE
├── README.md
├── shell.nix
└── treefmt.toml
```

我选择了把供下游消费的部分和 NUR 内部使用的分离，对外公开的部分都放在顶层，如 `。/pkgs/`，NUR 内部的工具都放置在 `./repo-nix/` 中。

## 自动化相关功能

### Derivation 自动发现

对于 `./pkgs/` 目录下的各种 Derivation，按照目录结构自动转换为层级化的 Package Set。虽然不是 CI/CD 上的自动化，但是在维护包的时候还是很方便的。

Nixpkgs 中其实已经有一个 `packagesFromDirectoryRecursive` 可以完成这个功能，不过它不太能支持按文件名过滤，导致我无法使用 `./pkgs/default.nix` 作为 Package Set 的入口点。~~所以我选择了造轮子~~：

```nix
{
  system ? builtins.currentSystem,
  pkgs ? (import ../.).inputs.nixpkgs.legacyPackages.${system},
}:
let
  lib = pkgs.lib;

  singletonAttrs = name: value: { ${name} = value; };

  packageSetRecursiveImpl =
    includePred: newScope: dir:
    let
      dirEntries = builtins.readDir dir;

      leafPaths = lib.flip lib.attrsets.concatMapAttrs dirEntries (
        entry: type:
        if type == "directory" && builtins.pathExists (dir + /${entry}/package.nix) then
          singletonAttrs entry (dir + /${entry}/package.nix)
        else if type == "regular" && lib.strings.hasSuffix ".nix" entry && includePred entry then
          singletonAttrs (lib.strings.removeSuffix ".nix" entry) (dir + /${entry})
        else
          { }
      );

      branchPaths = lib.flip lib.attrsets.concatMapAttrs dirEntries (
        entry: type:
        if type == "directory" && !(builtins.pathExists (dir + /${entry}/package.nix)) then
          singletonAttrs entry (dir + /${entry}/.)
        else
          { }
      );

      scope = lib.makeScope newScope (
        self:
        let
          packages = lib.attrsets.mapAttrs (name: path: self.callPackage path { }) leafPaths;
          packageSets = lib.attrsets.mapAttrs (
            name: packageSetRecursiveImpl includePred self.newScope
          ) branchPaths;
        in
        packages // packageSets
      );
    in
    scope;

  packageSetRecursiveWithPred = includePred: packageSetRecursiveImpl includePred pkgs.newScope;

  packageSetRecursive = packageSetRecursiveWithPred (entry: entry != "default.nix");
in
packageSetRecursive ./.
```

### 基于 GitHub Actions 构建

本 NUR 用 GitHub Actions 来构建所有包并上传产物到 Cachix。这里用的方案尝试尽可能并行构建。

在 [`build.yaml`](https://github.com/StarryReverie/StarryNix-Derivations/blob/898c31682e39660cc676e3b19a1d2a847b59b115/.github/workflows/build.yaml) Workflow 中，`eval` Job 在各个平台上求值所有的 Derivation，使用 `nix-eval-jobs` 并行求值并批量输出相关信息：

```yaml
jobs:
  eval:
    strategy:
      fail-fast: false
      matrix:
        include:
          - system: x86_64-linux
            os: ubuntu-latest
          - system: aarch64-linux
            os: ubuntu-26.04-arm
          - system: aarch64-darwin
            os: macos-latest
    runs-on: ${{ matrix.os }}

    steps:
      # ...

      - name: Evaluate Derivations
        run: |
          all_drvs="$(nix run nixpkgs#nix-eval-jobs -- --flake '.#ciMetadata.${{ matrix.system }}.buildJobPackages' --force-recurse --check-cache-status)"
          unbuilt_drvs="$(echo "${all_drvs}" | jq --compact-output '
            select (.cacheStatus == "notBuilt")
            | {
              attr,
              attrPath,
              outPaths: [.outputs[]],
              system,
              os: "${{ matrix.os }}",
            }
          ')"
          echo "${unbuilt_drvs}" | jq
          echo "${unbuilt_drvs}" > eval-${{ matrix.system }}

      - name: Upload Evaluation Result
        uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7
        with:
          name: eval-${{ matrix.system }}
          path: eval-${{ matrix.system }}
```

Flake Output `ciMetadata.<system>.buildJobPackages` 表示在 `<system>` 上需要构建的 Derivation 集合，不符合构建条件的 Derivation 会被过滤掉。具体实现参考 [`./repo-nix/ci/top-level.nix`](https://github.com/StarryReverie/StarryNix-Derivations/blob/898c31682e39660cc676e3b19a1d2a847b59b115/repo-nix/ci/top-level.nix) 和 [`./repo-nix/flake/ci-metadata.nix`](https://github.com/StarryReverie/StarryNix-Derivations/blob/898c31682e39660cc676e3b19a1d2a847b59b115/repo-nix/flake/ci-metadata.nix)。`nix-eval-jobs` 会并行求值整个 Package Set，每行对应一个 Derivation 的结果。我们用 `jq` 收集并提取有用的信息。`nix-eval-jobs` 还可以同时检查这个 Derivation 是否已经构建过，脚本按照 `.cacheStatus == "notBuilt"` 过滤需要构建的 Derivation。

由于上一步的求值是在不同平台上完成的，不能直接创建 GHA Matrix，需要先用一个中间 Job `aggregate` 合并结果：

```yaml
jobs:
  aggregate:
    needs: eval
    runs-on: ubuntu-latest
    outputs:
      matrix: ${{ steps.aggregate.outputs.matrix }}

    steps:
      - name: Download Per-System Evaluation Results
        uses: actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8
        with:
          pattern: eval-*
          merge-multiple: true
          path: eval-results

      - name: Aggregate Evaluation Results
        id: aggregate
        run: |
          concat_drvs="$(cat eval-results/* | jq --slurp --compact-output)"
          echo "${concat_drvs}" | jq

          # GHA requires that at least one entry is presented in the matrix.
          matrix="$(echo "${concat_drvs}" | jq --compact-output '
            if length == 0 then
              [{
                attr: "__skip_build",
                attrPath: ["__skip_build"],
                outPaths: [],
                system: "x86_64-linux",
                os: "ubuntu-latest",
                skip: true
              }]
            else
              map(. + { skip: false })
            end
          ')"
          echo "matrix=${matrix}" >> ${GITHUB_OUTPUT}
```

需要注意 GHA Matrix 必须至少有一个元素，否则会报错，所以这里对于没有任何需要构建的情况加了一个假的元素。

最后是利用 GHA Matrix，对于每一个 Derivation 单独启动一个 Job 来构建并上传 Cachix：

```yaml
jobs:
  build:
    needs: aggregate
    strategy:
      fail-fast: false
      matrix:
        include: ${{ fromJson(needs.aggregate.outputs.matrix) }}
    name: build (${{ matrix.attr }}, ${{ matrix.system }}, ${{ matrix.os }})
    runs-on: ${{ matrix.os }}

    steps:
      # ...

      - name: Setup Cachix
        if: ${{ !matrix.skip }}
        uses: cachix/cachix-action@38b082610b782e7e93e209c35fd730d399dee866 # v17
        with:
          name: starrynix-derivations
          extraPullNames: nix-community
          skipPush: true
          authToken: ${{ secrets.CACHIX_AUTH_TOKEN }}

      - name: Build Derivation ${{ matrix.attr }}
        if: ${{ !matrix.skip }}
        run: |
          nix build '.#ciMetadata.${{ matrix.system }}.buildJobPackages.${{ matrix.attr }}' --print-build-logs
          if [[ "$?" -eq 0 ]]; then
            out_paths=$(echo '${{ toJson(matrix.outPaths) }}' | jq --raw-output '.[]')
            echo "${out_paths}"
            if [[ '${{ github.ref == 'refs/heads/main' }}' == 'true' ]]; then
              echo "${out_paths}" | cachix push starrynix-derivations
            fi
          fi
```

我没有使用 Cachix CLI 的自动上传功能，避免上传中间产物。对于我这样的白嫖用户来说，5 GiB 空间是很珍贵的。只有构建成功后，选择性上传 Derivation 的 Output Path 的闭包。同时我打算在 PR 中也不触发上传，只有主分支上可以上传，这样 PR 就可以比较干净地测试构建。

### 自动更新 Flake Inputs

交给 Renovate 或 Dependabot 即可。我选择了 Renovate，一些是配置文件：

```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": [
    "config:best-practices"
  ],
  "packageRules": [
    {
      "matchManagers": ["*"],
      "commitMessagePrefix": "chore: ",
      "commitMessageAction": "update"
    },
    {
      "matchUpdateTypes": ["pin", "pinDigest"],
      "commitMessageAction": "pin"
    },
    {
      "matchUpdateTypes": ["rollback"],
      "commitMessageAction": "roll back"
    },
    {
      "matchUpdateTypes": ["replacement"],
      "commitMessageAction": "replace"
    },
    {
      "description": "Nix Flake inputs",
      "matchManagers": ["nix"],
      "commitMessageAction": "update",
      "commitMessageTopic": "Nix Flake inputs"
    }
  ],
  "nix": {
    "enabled": true
  }
}
```

### 自动更新 Derivation

Nix 社区中已经有很好的自动更新脚本了，比如 [Mic92/nix-update](https://github.com/Mic92/nix-update)（又是你 Mic92），对于大多数的包都可以轻松更新。但是 `nix-update` 只是一个 CLI 工具，我更想要实现 Nixpkgs 中那样通过 `passthru.updateScript` 关联一个脚本，并以更 Nix 的方式调用。可惜 Nixpkgs 的 `maintainers/scripts/update.nix` 不方便在 Nixpkgs 之外使用，所以我再次造了轮子。

[`updateUtils`](https://github.com/StarryReverie/StarryNix-Derivations/tree/898c31682e39660cc676e3b19a1d2a847b59b115/pkgs/updateUtils) 是自动更新的一些 Wrapper，可以调用 `nix-update` 或者自己的脚本，并带有生成 Git Commit、运行格式化器等功能。

比如 [`nclock-screensaver`](https://github.com/StarryReverie/StarryNix-Derivations/blob/898c31682e39660cc676e3b19a1d2a847b59b115/pkgs/nclock-screensaver/package.nix#L39-L49) 中的使用方法：

```nix
{
  lib,
  rustPlatform,
  updateUtils,
  # ...
}:
rustPlatform.buildRustPackage (finalAttrs: {
  # ...

  passthru.updateScript =
    let
      baseUpdater = updateUtils.updateAuto {
        attrPath = [ "nclock-screensaver" ];
        branch = "main";
      };
    in
    lib.pipe baseUpdater [
      updateUtils.withFormatter
      updateUtils.withGitCommit
    ];
})
```

或者 [`drvgraph`](https://github.com/StarryReverie/StarryNix-Derivations/blob/898c31682e39660cc676e3b19a1d2a847b59b115/pkgs/drvgraph/package.nix#L35-L54) 中的使用方法：

```nix
{
  cabal2nix,
  curl,
  fetchurl,
  haskell,
  haskellPackages,
  hpack,
  jq,
  lib,
  updateUtils,
}:
let
  sources = builtins.fromJSON (builtins.readFile ./sources.json);

  drv = haskellPackages.callPackage ./generated.nix {
    src = fetchurl {
      inherit (sources) hash;
      url = "https://github.com/StarryReverie/DrvGraph/archive/${sources.rev}.tar.gz";
    };
  };
in
haskell.lib.justStaticExecutables (
  drv.overrideAttrs (old: {
    # ...

    passthru = (old.passthru or { }) // {
      updateScript =
        let
          baseUpdater = updateUtils.updateCustom {
            attrPath = [ "drvgraph" ];
            scriptFile = ./update.sh;
            extraRuntimeInputs = [
              cabal2nix
              hpack
              jq
              curl
            ];
          };
        in
        lib.pipe baseUpdater [
          updateUtils.withFormatter
          updateUtils.withGitCommit
        ];
    };
  })
)
```

导出 `passthru.updateScript` 后，所有的更新都可以通过 `nix run .#legacyPackages.<system>.<package>.updateScript` 来进行。

然后就是集成 GHA 来定时执行这些脚本，在有新 Git Commit 产生时创建 PR。这就是 [`update.yaml`](https://github.com/StarryReverie/StarryNix-Derivations/blob/898c31682e39660cc676e3b19a1d2a847b59b115/.github/workflows/update.yaml) Workflow。

这个 Workflow 中，第一个 `dispatch` Job 求值 `ciMetadata.x86_64-linux.updateScripts`，每个 Update Script 分配一个 Matrix Job 执行，实现和 `build.yaml` 类似。

接下来是 `update` Job：

```yaml
jobs:
  # ...

  update:
    needs: dispatch
    strategy:
      fail-fast: false
      matrix:
        include: ${{ fromJson(needs.dispatch.outputs.matrix) }}
    name: update (${{ matrix.attr }}, ${{ matrix.system }}, ${{ matrix.os }})
    runs-on: ${{ matrix.os }}

    steps:
      # ...

      - name: Run Update Script
        if: ${{ !matrix.skip }}
        id: update
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

          current_rev="$(git rev-parse HEAD)"
          nix --extra-experimental-features 'nix-command flakes' \
            run '.#legacyPackages.${{ matrix.system }}.${{ matrix.attr }}.updateScript'
          new_rev="$(git rev-parse HEAD)"

          if [[ "${current_rev}" != "${new_rev}" ]]; then
            echo 'changed=true' >> ${GITHUB_OUTPUT}
            echo "title=$(git log -1 --pretty=%s)" >> ${GITHUB_OUTPUT}
          else
            echo 'changed=false' >> ${GITHUB_OUTPUT}
          fi

      - name: Create Update PR
        if: ${{ !matrix.skip && steps.update.outputs.changed == 'true' }}
        uses: peter-evans/create-pull-request@5f6978faf089d4d20b00c7766989d076bb2fc7f1 # v8
        with:
          token: ${{ secrets.UPDATE_WORKFLOW_TOKEN }}
          base: main
          branch: update-${{ matrix.attr }}
          title: ${{ steps.update.outputs.title }}
```

创建 PR 这一个部分，最好使用 PAT 或 GitHub App。如果是默认的 `GITHUB_TOKEN`，创建的 PR 是不会自动触发后续的 Workflow 的。

## 总结

这就是我升级重构 NUR 的具体方案。我对于现在的自动化程度还是比较满意的，并行构建和自动更新等功能节省了很多时间，StarryNix-Derivations 再也不会像以前那样荒废了。
