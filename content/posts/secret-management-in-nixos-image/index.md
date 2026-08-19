---
title: NixOS 镜像中的 Secret 管理
date: 2026-08-19T19:59:45+08:00
draft: false
categories: Tech
tags:
  - Linux
  - NixOS
  - Systemd
math: false
---

给 NixOS 的 Installer Image 加入 Secret 管理支持。

<!-- more -->

## 背景

玩 NixOS 玩到一定程度，都将面对 Secret 管理这一经典问题，当然对于一般的 NixOS Setup 来说，这并不是非常复杂的问题，有非常多的工具可以解决，如 sops-nix、agenix、vaultix 等。

但是，我们的 NixOS 系统还包括 Installer，要是 Installer 中也需要使用一些 Secret 怎么办呢？最近我就想定制一个 Installer ISO 包括一个完整的透明代理服务，以方便安装过程中访问某些不存在的网站。透明代理的节点和订阅链接都是需要保密的。然而这些 Secret 管理方案都不能直接用在 ISO 上，这也是本文需要解决的问题。

## 方案设计

### Secret 管理基本机制

首先我们回顾一下在普通的 NixOS 系统中如何管理 Secret。

Secret 的内容需要保密，不可以直接内联在 NixOS 配置中，也不可以在 NixOS 构建阶段直接引用，否则会被复制到 `/nix/store` 中。这些内容需要首先被加密后再用于构建和部署，在系统真正开始运行时再动态地解密。

每个 Secret 都是以非对称加密的方式被保护的。Secret 需要可以被维护者修改，也需要可以被需要的机器解密。前者的加密解密使用用户所有的密钥对，一般称为 Identity，后者的加解密则使用机器所有的密钥对，一般就称为 Key，大多数情况下会使用 SSH key `/etc/ssh/ssh_host_{rsa,ed25519}_key{,.pub}`。用户使用 Identity 的 Public Key 加密明文，后续可以使用 Identity Private Key 查看已加密的内容。同时，对于需要使用这个 Secret 的机器，需要使用该机器的 Public Key 重加密内容，以便该机器可以用自己的 Private Key 在运行时解密内容。重加密过程需要用 Identity Private Key 解密获取原始内容。

所有的明文内容用 Identity 和 Key 加密后，一般都会跟随 NixOS 配置加入 VCS 统一管理，方便部署。

### ISO 管理 Secret 的难点

从基本机制可以看出，一个机器解密 Secret 需要使用自己的 Private Key，这个 Secret 需要用预先生成好的对应的 Public Key 加密才行。然而 ISO 的 SSH Key 都是每次启动时临时生成的，我们根本没办法提前为这个 ISO 直接加密 Secret。

现有 Secret 管理工具都要求在某个 NixOS 配置中的某个地方填写好目标机器的 Public Key，这样这些工具才可以提前加密所有明文。一般的 NixOS 系统中，这个 Public Key 都是安装完成后再填写最后重新加密的，但这里这种方式就不可以了。

### 固定 SSH Key

既然 Secret 加密需要不变的 Key，那么我们就固定一个 Key，我们的目标就是想办法在 `ssh-keygen.service` 之前把我们预先生成好的 Key 放到指定的位置。

如果我们不在使用 NixOS、可以接受一些不那么纯净的方案，或许就可以简单地把预先生成的 Key 打包进入 ISO 中，然而这是脱裤子放屁，不如直接内联所有明文。这种情况下，无论如何 ISO 文件都必须保持机密，有些不方便。

更可行的方法是对称加密 Private Key，ISO 中只保存对称加密过的 Private Key，ISO 启动时输入密码解密 Private Key，再用这个 Private Key 解密所有 Secret。对称加密方案具体来说还有多种选择，具体的加密方法可以选择文件级加密或把 Private Key 存进一个 LUKS2 保护的虚拟磁盘镜像文件，解密时机可以是启动过程中解密或登录后解密。

文件级加密是最轻量的方案，Overhead 最小，也是我最终选择的方案，使用 age 来完成加密。块设备加密理论上也是不错的选择，NixOS 对于全盘加密已经有很好的支持，如果我们把 Private Key 存放进加密的虚拟磁盘，那么就可以利用现有全盘加密支持在启动过程中解密。然而加密的虚拟磁盘占用空间太大，LUKS2 为全盘加密存放的元信息和文件系统最少也需要约 1 MiB 左右，对于整个硬盘来说不足挂齿，但是作为一个需要加入 Git 的文件来说就太大了。

解密时机选择上，如果选择启动过程中解密，则是最方便的。登录用户后解密有较多问题，首先是 SSH Key 其实已经生成，所有 Secret 解密及依赖的服务都会失败，登录后解密还需要再手动重启服务，即使是把这个过程自动化也感觉不够好。所以我还是选择实现一个启动过程中输入密码解密的方案。

## 实现

### 尝试从 TTY 读取密码

第一次知道 Systemd 还可以支持服务把 TTY 作为标准输入读取内容，可以通过

```ini
[Service]
StandardInput=tty
TTYPath=/dev/console
```

来设置。理论上来说 Systemd 会给这样的服务分配 `/dev/console`，但是我尝试编写脚本却没有成功，`age -d` 的提示符没有出现，Systemd 一路启动到了 `getty`，根本没有输入的机会。

现在已经不是 SysV Init 的脚本启动的时代里，直接获取输入不再是一件容易的事。我尝试阅读 NixOS 的 LUKS 的实现，发现 Systemd 版的实现使用的是 `systemd-cryptsetup`，完全避开了这个问题。遂放弃直接读入密码。

### 利用 systemd-ask-password

然后通过探索，我发现了 `systemd-ask-password(1)` 这个好东西。`systemd-ask-password` 完全解决了 Systemd 服务与输入交互的问题，调用 `systemd-ask-password` 是其不会直接读取标准输入，而是把密码输入处理委托给一些 Agent，不同的环境下由不同的 Agent 处理，启动过程中的输入会由 Systemd 统一协调，我们的解密脚本再也不用关心细节，只需要 `passphrase="$(systemd-ask-password "Type passphrase")"` 就可以了。

但是接下来就会遇到另外一个坑，`age` 故意不支持从管道传递密码，为了保证安全性，`age` 会检测标准输入是否连接一个 TTY，密码只能从 TTY 设备输入。求助于 AI 发现了 `script(1)`，`script` 原本是用于录制 Shell 交互过程，内部实现会用 `openpty()` 创建新的 PTY，在其中执行 `age` 解密即可在外通过管道传入密码、在内假装通过标准输入填写密码。

最终的实现如下：

```nix
{
  config,
  lib,
  pkgs,
  ...
}:
{
  config = lib.mkMerge [
    # Secrets
    {
      systemd.services.decrypt-ssh-host-private-key = {
        description = "Decrypt the pre-generated SSH host key";

        script = ''
          umask 077
          mkdir -p /nix/persistence/etc/ssh

          cp ${./keys/ed25519.pub} /nix/persistence/etc/ssh/ssh_host_ed25519_key.pub
          chmod 0644 /nix/persistence/etc/ssh/ssh_host_ed25519_key.pub

          for n in 3 2 1; do
            rm -f /nix/persistence/etc/ssh/ssh_host_ed25519_key
            passphrase="$(${config.systemd.package}/bin/systemd-ask-password \
              "Type passphrase to decrypt the SSH host private key ($n attempt(s) left)")"

            # `age` doesn't allow reading passphrase from anything but a real tty. Use `script` to
            # create a pty to trick `age` to read passphrase from the actually piped input.
            if printf '%s\n' "$passphrase" | ${pkgs.util-linux}/bin/script -qec \
              "${pkgs.age}/bin/age -d -o /nix/persistence/etc/ssh/ssh_host_ed25519_key ${./keys/ed25519.age}" /dev/null; then
              chmod 0600 /nix/persistence/etc/ssh/ssh_host_ed25519_key
              exit 0
            fi

            echo "Invalid passphrase"
          done

          echo "Decrypt SSH host private key failed"
          exit 1
        '';

        wantedBy = [ "sysinit.target" ];

        unitConfig = {
          Before = [
            "sysinit.target"
            "vaultix-activate.service"
            "sshd-keygen.service"
            "sshd.service"
          ];
          DefaultDependencies = "no";
        };

        serviceConfig = {
          Type = "oneshot";
          RemainAfterExit = true;
          TimeoutStartSec = "60s";
        };
      };
    }
  ];
}
```

我把 SSH Key 解密到了 `/nix/persistence/etc/ssh` 中，因为我有使用 `preservation`，`/etc/ssh/` 中会符号链接到 `/nix/persistence/etc/ssh`。

另外需要注意 `TimeoutStartSec`，这个服务作为 `oneshot` 服务，只有 `ExecStart` 执行结束才可以算作启动成功，而交互式输入所需要的时间基本都长于默认的超时时限，默认情况下会提前终止输入继续启动。
