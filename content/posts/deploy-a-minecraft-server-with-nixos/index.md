---
title: 用 NixOS 部署 Minecraft 服务器
date: 2024-07-05T15:42:09+08:00
draft: false
categories: Tech
tags:
  - NixOS
  - Minecraft
---

紧张的考试周过后，终于有时间和朋友玩 Minecraft 了。为了方便进行多人游戏，我和 [@whitepaperdog](https://github.com/whitepaperdog) 决定购买一台云主机作为服务器。鉴于 NixOS 强大的 reproducibility 以及我这半年使用 NixOS 的优秀体验，我决定将服务器的系统更换为 NixOS，并在其之上部署 Minecraft 服务。

## 准备工作

### NixOS 安装

这台服务器并不是用我的账号买的，所以我没有办法直接在控制台上传 NixOS 的镜像进行安装。等我拿到 root 密码后，系统就已经是 Ubuntu 了。在此情况下，我选择了使用 [NixOS-infect](https://github.com/elitak/nixos-infect)。NixOS-infect 是一个 shell 脚本，其在服务器上安装 Nix，再用 Nix 构建出 NixOS，最后修改 bootloader 配置，添加 NixOS 的启动项并删除其他东西。

使用 NixOS-infect 前需要配置好访问 root 的 SSH 公钥，这是因为 NixOS-infect 并没有提供设置 root 密码的步骤，并且 NixOS 默认情况下将禁用 SSH 通过密码登录 root。NixOS-infect 脚本会将原有的 root 的公钥重新导入到新的 NixOS 里。

由于服务器在国内，所以访问 nixpkgs 的 cache 将会非常慢，在安装 NixOS 之前需要配置好 cache 镜像。编辑脚本，在完成 Nix 的安装后，配置镜像源：

```bash
infect() {
  # ...
  NIX_INSTALL_URL="${NIX_INSTALL_URL:-https://nixos.org/nix/install}"
  curl -L "${NIX_INSTALL_URL}" | sh -s -- --no-channel-add

  # 添加以下 3 行
  cat << EOF > /etc/nix/nix.conf
substituters = https://mirror.sjtu.edu.cn/nix-channels/store https://mirrors.ustc.edu.cn/nix-channels/store https://cache.nixos.org/
  EOF

  # shellcheck disable=SC1090
  source ~/.nix-profile/etc/profile.d/nix.sh
  # ...
}
```

随后就是运行脚本，等待 SSH 断开，安装完成。

### 基本可用的 NixOS 配置

安装完成后，用 `scp` 从服务器上复制出其配置，其中的对于文件系统的配置是有用的。

在本地，新建目录，创建以下文件：

```nix
# ./flake.nix
{
  description = "CLYZ Minecraft Server Flake";

  nixConfig = {
    substituters = [
      "https://mirrors.ustc.edu.cn/nix-channels/store"
      "https://mirror.sjtu.edu.cn/nix-channels/store"
      "https://cache.nixos.org"
      "https://nix-community.cachix.org"      
    ];

    trusted-public-keys = [
      "cache.nixos.org-1:6NCHdD59X431o0gWypbMrAURkbJ16ZPMQFGspcDShjY="
      "nix-community.cachix.org-1:mB9FSh9qf2dCimDSUo8Zy7bkq5CX+/rkCWyvRCYg3Fs="
    ];
  };

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs, ... }@inputs: let
    pkgs = import nixpkgs { system = "x86_64-linux"; };
  in {
    nixosConfigurations.clyz-minecraft = nixpkgs.lib.nixosSystem {
      system = "x86_64-linux";
      specialArgs = { inherit inputs; };

      modules = [
        ./system
      ];
    };

    devShells.x86_64-linux.default = let
      mkShell = pkgs.mkShell.override { stdenv = pkgs.stdenvNoCC; };
    in
      mkShell {
        packages = with pkgs; [
          nil
        ];
      };
  };
}
```

```nix
# ./system/default.nix
{ config, lib, pkgs, ... }:

{
  imports = [
    ./hardware.nix
  ];

  networking.hostName = "clyz-minecraft";

  time.timeZone = "Asia/Shanghai";

  users.users = {
    oo-infty = {
      # ...
    };
  };

  users.users.root.openssh.authorizedKeys.keys = [
    "ssh-ed25519 ..."
  ];

  services.openssh.enable = true;
  programs.zsh.enable = true;

  environment.systemPackages = with pkgs; [
    bat
    fd
    git
    helix
    htop
    neofetch
    ripgrep
  ];

  system.stateVersion = "24.11";
}
```

```nix
# ./system/hardward.nix
{ modulesPath, ... }:

{
  imports = [ (modulesPath + "/profiles/qemu-guest.nix") ];

  boot.loader.grub.device = "/dev/vda";

  boot.initrd.availableKernelModules = [ "ata_piix" "uhci_hcd" "xen_blkfront" "vmw_pvscsi" ];
  boot.initrd.kernelModules = [ "nvme" ];

  boot.tmp.cleanOnBoot = true;
  fileSystems."/" = { device = "/dev/vda1"; fsType = "ext4"; };
  zramSwap.enable = true;
}
```

随后可用在本地运行以下命令，测试能否构建出一个可用的 NixOS（当然会是可用的）：

```bash
nixos-rebuild build-vm --flake .#clyz-minecraft
./result/bin/run-clyz-minecraft-vm
```

然后再用 `scp` 复制到服务器上，在服务器上运行：

```bash
nixos-rebuild switch --flake .#clyz-minecraft
reboot # 重启是必要的，需要修改 hostname
```

接下来就可以登录上去运行一下 `neofetch`，展示一下传统艺能。

## 改善运维体验

虽然说是运维，其实更像是开发，大部分时间都是在写 Nix，然后做各种的测试。可以说 Nix 和 NixOS 就是 DevOps 的理想解决方案。

### 版本控制

不必多说，`git init`，并在 GitHub 上创建[远程仓库](https://github.com/clyz-oi/clyz-minecraft)。

### 开发体验

首先是要方便写 Nix 代码，所以 Nix 开发体验需要首先改善。

在 `flake.nix` 中添加以下部分：

```nix
# ./flake.nix
{
  outputs = { self, nixpkgs, ... }@inputs: let
    pkgs = import nixpkgs { system = "x86_64-linux"; };
  in {
    devShells.x86_64-linux.default = let
      mkShell = pkgs.mkShell.override { stdenv = pkgs.stdenvNoCC; };
    in
      mkShell {
        packages = with pkgs; [
          nil
        ];
      };
  };
}
```

`nil` 是一个 Nix Language Server，对于 Nix 语言的补全还是比较方便的。

这里添加了一个 `devShell`，此时只能通过 `nix develop` 进入这个 `devShell`，而且默认是 `bash`，对我这个 `zsh` 用户实在不友好。所以利用好 `direnv`：

```env
# ./.envrc
echo "direnv: loading .envrc"
use flake
```

接下来只要进入目录就会自动加载环境变量，也就进入了一个有相关工具的 zsh 环境了。

我使用 [Helix](https://github.com/helix-editor/helix) 编辑器，所以在当前目录下添加 Nix 语言配置：

```toml
# ./.helix/languages.toml
[language-server.nil]
command = "nil"
config = { nil = { diagnostics = { ignored = ["unused_binding", "unused_with"], excludedFiles = [] }, nix = { binary = "nix", maxMemoryMB = 2560, flake = { autoArchive = false, autoEvalInputs = false, nixpkgsInputName = "nixpkgs" } } } }

[[languages]]
name = "nix"
indent = { tab-width = 2, unit = "  " }
```

### 部署工具

每次改好配置后还要 `scp` 再登录上去手动 `nixos-rebuild` 的流程实在是难以接受。这个时候就需要借助 `colmena` 了。`clomena` 就是一个 NixOS 部署工具，只要在本地运行一行命令，就可以在本地完成 evaluation 和 instantiation，随后将构建结果通过 SSH 传输到服务器上，最后触发服务器上切换配置。

对 `flake.nix` 做出如下修改：

```nix
# ./flake.nix
{
  outputs = { self, nixpkgs, ... }@inputs: let
    pkgs = import nixpkgs { system = "x86_64-linux"; };
  in {
    # ...
    colmena = {
      meta = {
        nixpkgs = pkgs;
        specialArgs = { inherit inputs; };
      };

      clyz-minecraft = { name, nodes, pkgs, ... }: {
        deployment = {
          targetHost = "...";
          tags = [ "production" ];
        };

        imports = [
          ./system
        ];
      };
    };

    devShells.x86_64-linux.default = let
      mkShell = pkgs.mkShell.override { stdenv = pkgs.stdenvNoCC; };
    in
      mkShell {
        packages = with pkgs; [
          nil
          colmena
        ];
      };
  };
}
```

这就相当于再写一遍 `nixosConfigurations` 的定义，基本上没什么工作量，但是马上获得远程部署功能，大大加快开发进程。

需要注意 `colmena` 与远程主机的交互需要通过 SSH 访问 root，所以不可以取消远程访问 root 的功能。

接下来运行 `colmena apply`，更新所有配置。

## Minecraft 服务部署

### Minecraft Server Derivation

考虑到需要安装 mod，所以需要一个 Fabric 服务器核心。搜索了 nixpkgs，之找到了原版核心和 Paper 核心，所以这次需要自己动手写一个 derivation。

```nix
# ./pkgs/minecraft-server/default.nix
{ lib
, stdenvNoCC
, fetchurl
, jdk21_headless
, makeBinaryWrapper
}:

let
  mcVersion = "1.20.1";
  loaderVersion = "0.15.11";
  launcherVersion = "1.0.1";
in
stdenvNoCC.mkDerivation {
  pname = "minecraft-server";
  version = "mc.${mcVersion}-loader.${loaderVersion}-launcher.${launcherVersion}";

  src = fetchurl {
    url = "https://meta.fabricmc.net/v2/versions/loader/${mcVersion}/${loaderVersion}/${launcherVersion}/server/jar";
    hash = "sha256-/j9wIzYSoP+ZEfeRJSsRwWhhTNkTMr+vN40UX9s+ViM=";
  };

  dontUnpack = true;
  preferLocalBuild = true;
  allowSubstitutes = false;

  nativeBuildInputs = [
    makeBinaryWrapper
  ];

  installPhase = ''
    runHook preInstall

    install -D $src $out/share/minecraft-server/minecraft-server.jar 
    makeWrapper ${jdk21_headless}/bin/java $out/bin/minecraft-server \
        --append-flags "-jar $out/share/minecraft-server/minecraft-server.jar --nogui"

    runHook postInstall
  '';
}
```

一个 derivation 就这样完成了，接下来就把它加入到 `flake.nix` 中导出，方便后续引用。

```nix
# ./flake.nix
{
  outputs = { self, nixpkgs, ... }@inputs: let
    pkgs = import nixpkgs { system = "x86_64-linux"; };
  in {
    packages.x86_64-linux.minecraft-server = pkgs.callPackage ./pkgs/minecraft-server {};

    # ...
  };
}
```

### 部署 Systemd 服务

搜索 [NixOS Options](https://search.nixos.org/options?)，刚好已经有了相关的配置解决方案 `services.minecraft-server`，于是我们可以直接使用现成的：

```nix
# ./system/service.nix
{ config, lib, pkgs, inputs, ... }:

{
  services.minecraft-server = {
    enable = true;
    package = inputs.self.packages.${pkgs.system}.minecraft-server;
    eula = true;
    openFirewall = true;
    declarative = true;

    serverProperties = {
      level-seed = -6614766569353866106;
      server-port = 25600;
      difficulty = "hard";
      white-list = false;
      enforce-secure-profile = false;
      allow-flight = true;
    };

    jvmOpts = "-Xmx3896M -Xms2048M";
  };
}
```

注意到 `services.minecraft-server.package`，这个 option 可以指定为之前写的 derivation，只要程序名称和相关接口不变即可。我们所编写的 derivation 正是按照 nixpkgs 中原有的方式完成的，所以可以直接无缝替换。

接下来需要 `import` 这个文件，修改 `./system/default.nix`：

```nix
# ./system/default.nix
{
  imports = [
    ./hardware.nix
    ./service.nix
  ];
}
```

运行 `colmena apply`，不出意料 Minecraft 服务器就会以 Systemd 服务的方式运行了。在服务器上运行 `systemctl status minecraft-server.service`, 应该可以看到其在正常运行。服务的所有数据都在 `/var/lib/minecraft` 中，可以通过 `services.minecraft-server.dataDir` 修改。

### 声明式配置管理员

nixpkgs 中的相关 NixOS Modules 只实现了配置 `server.properties` 和白名单，我们可以试试自己编写 NixOS Modules 来扩展其功能。

首先创建以下文件：

```nix
# ./modules/minecraft-server/default.nix
{ config, lib, pkgs, ... }:

{
  # NixOS modules that add extra options for services.minecraft-server.
  imports = [
  ];
}
```

首先是 op 的配置。op 的信息保存在 `ops.json` 中，由 `uuid`、`name`、`level`、`bypassesPlayerLimit` 组成的一个字典描述一位 op 的信息，所有 op 的信息组成一个列表。据此，声明对应的 options：

```nix
# ./modules/minecraft-server/operator.nix
{ config, lib, pkgs, ... }:

let
  cfg = config.services.minecraft-server;

  operatorType = lib.types.submodule {
    options = {
      uuid = lib.mkOption {
        type = lib.types.strMatching
          "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
        example = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx";
        description = "UUID of an operator.";
      };

      level = lib.mkOption {
        type = lib.types.enum [ 1 2 3 4 ];
        default = 1;
        description = "Permission level of an operator.";
      };

      bypassesPlayerLimit = lib.mkOption {
        type = lib.types.bool;
        default = false;
        description = ''
          Whether to allow an operator enter the server even if current number
          of players has reached the limit.
        '';
      };
    };
  };
in {
  options.services.minecraft-server = {
    operator = lib.mkOption {
      type = lib.types.attrsOf operatorType;
      default = {};
      example = {
        op = {
          uuid = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx";
          level = 4;
          bypassesPlayerLimit = false;
        };
      };
      description = "Operator configurations of this server";
    };
  };
}
```

接下来就要在一个适当的时机应用配置：

```nix
# ./modules/minecraft-server/operator.nix
{
  # ...

  config = lib.mkIf cfg.enable {
    systemd.services.minecraft-server.preStart = let
      operatorList = lib.mapAttrsToList
        (name: attrs: attrs // { inherit name; })
        cfg.operator;
      operatorFile = pkgs.writeText "ops.json" (builtins.toJSON operatorList);
    in
      if cfg.declarative then ''
        if [[ -e .declarative-op ]]; then
          ln -sf ${operatorFile} ops.json
        else
          ln -sb --suffix=.stateful ${operatorFile} ops.json
          touch .declarative-op
        fi
      '' else ''
        rm .declarative-op || true
      '';
  };
}
```

以上代码利用 Nix 内建的 attrset 转换 JSON 的功能，由配置生成 JSON 文件，储存在 Nix Store 中。接下来在 Systemd 服务启动前，创建一个符号链接，指向我们刚刚生成的 JSON。为了配合原有的 `services.minecraft-server.declarative` 选项，还添加了备份原有 `ops.json` 的功能。

在 `./system/service.nix` 中添加配置：

```nix
# ./system/service.nix
{
  services.minecraft-server = {
    operator = {
      oo_infty = {
        uuid = "6b93f3cf-2dd8-4640-8852-011e91931684";
        level = 4;
      };

      whitepaperdog = {
        uuid = "9a319d7f-425a-4768-ae00-add32a945d2c";
        level = 4;
      };
    };

    # ...
  };
}
```

让 NixOS 配置引入 NixOS Modules：

```nix
# ./modules/minecraft-server/default.nix
{ config, lib, pkgs, ... }:

{
  # NixOS modules that add extra options for services.minecraft-server.
  imports = [
    ./addons.nix
  ];
}
```

```nix
# ./flake.nix
{
  outputs = { self, nixpkgs, ... }@inputs: let
    pkgs = import nixpkgs { system = "x86_64-linux"; };
  in {
    nixosModules.minecraft-server = import ./modules/minecraft-server;

    nixosConfigurations.clyz-minecraft = nixpkgs.lib.nixosSystem {
      modules = [
        ./system
        self.nixosModules.minecraft-server
      ];
    };

    colmena = {
      clyz-minecraft = { name, nodes, pkgs, ... }: {
        imports = [
          ./system
          self.nixosModules.minecraft-server
        ];
      };
    };
}
```

### 声明式配置 mod 与 plugin

通过 Nix 下载 mod 和 plugin 到 Nix Store 中，在将它们链接到对应目录中，NixOS Modules 编写方法也是类似的。

```nix
# ./modules/minecraft-server/addons.nix
{ config, lib, pkgs, ... }:

let
  cfg = config.services.minecraft-server;

  addonType = lib.types.submodule ({ config, ... }: {
    options = {
      mcVersion = lib.mkOption {
        type = lib.types.str;
        default = "any";
        example = "1.20.1";
        description = "The version of Minecraft that load this mod or plugin";
      };

      addonVersion = lib.mkOption {
        type = lib.types.str;
        example = "0.1.0";
        description = "The version of this mod or plugin";
      };

      version = lib.mkOption {
        type = lib.types.str;
        default = "addon.${config.addonVersion}-mc.${config.mcVersion}";
        defaultText = "addon.<addonVersion>-mc.<mcVersion>";
        description = "Combination of Minecraft version and addon version";
      };

      url = lib.mkOption {
        type = lib.types.str;
        description = "The URL used to fetch this mod or plugin";
      };

      hash = lib.mkOption {
        type = lib.types.str;
        description = "The hash of this mod or plugin";
      };
    };
  });

  cleanupAddonsScript = dir: ''
    # Only change jar files.
    addons=${dir}/*.jar

    for file in $addons ; do
      if [[ ! -L "$file" ]]; then
        # Change files that aren't symlinks.
        mv "$file" "$file.stateful"
      else
        # Remove symlinks in case of already abandoned mods or plugins.
        rm "$file"
      fi
    done
  '';

  # A workaround which fixes URLs that contain '+'.
  santinizeUrl = url: builtins.replaceStrings [ "%2B" ] [ "+" ] url;

  installAddonScript = dir: addon: attr: let
    src = pkgs.fetchurl {
      inherit (attr) hash;
      url = santinizeUrl attr.url;
    };
    name = "${addon}-${attr.version}.jar";
  in ''
    ln -s "${src}" "${dir}/${name}"
  '';

  installAllAddonScript = dir: addons: let
    installScriptList = lib.mapAttrsToList
      (addon: attr: installAddonScript dir addon attr)
      addons;
  in
    builtins.concatStringsSep "\n" installScriptList;
in {
  options.services.minecraft-server = {
    mods = lib.mkOption {
      type = lib.types.attrsOf addonType;
      default = {};
      example = {
        fabric-api = {
          mcVersion = "1.20.1";
          addonVersion = "0.92.2";
          url = "https://cdn.modrinth.com/data/P7dR8mSH/versions/P7uGFii0/fabric-api-0.92.2%2B1.20.1.jar";
          hash = "sha256-RQD4RMRVc9A51o05Y8mIWqnedxJnAhbgrT5d8WxncPw=";
        };
      };
      description = "All needed mods";
    };

    plugins = lib.mkOption {
      type = lib.types.attrsOf addonType;
      default = {};
      example = {
        world-edit = {
          mcVersion = "1.20.1";
          addonVersion = "7.3.1";
          url = "https://cdn.modrinth.com/data/1u6JkXh5/versions/j8KJp1Ch/worldedit-bukkit-7.3.1.jar";
          hash = "sha256-EWg4q0pIuwbn471t0PT4jTaTSCc4O+WzhXXaBZtQUZk=";
        };
      };
      description = "All needed plugins";
    };
  };

  config = lib.mkIf cfg.enable {
    systemd.services.minecraft-server.preStart = ''
      ${cleanupAddonsScript "${cfg.dataDir}/mods"}
      ${installAllAddonScript "${cfg.dataDir}/mods" cfg.mods}

      ${cleanupAddonsScript "${cfg.dataDir}/plugins"}
      ${installAllAddonScript "${cfg.dataDir}/plugins" cfg.plugins}
    '';
  };
}
```

```nix
# ./system/service.nix
{
  services.minecraft-server = {
    mods = {
      fabric-api = {
        mcVersion = "1.20.1";
        addonVersion = "0.92.2";
        url = "https://cdn.modrinth.com/data/P7dR8mSH/versions/P7uGFii0/fabric-api-0.92.2%2B1.20.1.jar";
        hash = "sha256-RQD4RMRVc9A51o05Y8mIWqnedxJnAhbgrT5d8WxncPw=";
      };

      banner = {
        mcVersion = "1.20.1";
        addonVersion = "664";
        url = "https://cdn.modrinth.com/data/7ntInrAy/versions/aTkeI3Og/banner-1.20.1-664.jar";
        hash = "sha256-rLqOBbu+uaAZxtYtM2Tt2Fb6ewDYiG4I7+10JEmQMR8=";
      };

      carpet = {
        mcVersion = "1.20.1";
        addonVersion = "1.4.112";
        url = "https://cdn.modrinth.com/data/TQTTVgYE/versions/K0Wj117C/fabric-carpet-1.20-1.4.112%2Bv230608.jar";
        hash = "sha256-AK0O0VxFf97A5u7+hNeeG7e4+R9fOhM8+Jyytg/7PRE=";
      };

      immersive-aircraft = {
        mcVersion = "1.20.1";
        addonVersion = "1.0.1";
        url = "https://cdn.modrinth.com/data/x3HZvrj6/versions/3hpofkRO/immersive_aircraft-1.0.1%2B1.20.1-fabric.jar";
        hash = "sha256-oDP3NRESX7wMO+v1SNlbPBaRQn2/E1tBsj8kZJU+WRw=";
      };
    };

    plugins = {
      multi-login = {
        addonVersion = "0.6.10";
        url = "https://github.com/CaaMoe/MultiLogin/releases/download/v0.6.10/MultiLogin-Bukkit-0.6.10.jar";
        hash = "sha256-izUPvUiN08WU7Od/SCmI0SLLVAGax9UM6RdeFm1xVLw=";
      };

      world-edit = {
        mcVersion = "1.20.1";
        addonVersion = "7.3.1";
        url = "https://cdn.modrinth.com/data/1u6JkXh5/versions/j8KJp1Ch/worldedit-bukkit-7.3.1.jar";
        hash = "sha256-EWg4q0pIuwbn471t0PT4jTaTSCc4O+WzhXXaBZtQUZk=";
      };
    };
  };
}
```
