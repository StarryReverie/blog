---
title: 现代 Linux 桌面会话管理
date: 2026-02-18T20:47:53+08:00
draft: false
categories: Tech
tags:
  - Linux
  - Desktop Environment
  - NixOS
  - Systemd
math: false
---

最近尝试了使用 Wayfire 作为 Wayland 混成器，整体体验后，Wayfire 的功能是不错的，可惜其没有 systemd 支持，对于依赖 systemd 的我来说，这显然是不能够满足日常需求的。因此，我研究了如何为其添加基于 systemd 的会话管理机制，记录在此文中。

## 桌面会话的生命周期

### 传统方式

在 Linux 中，本没有什么非常精细的会话管理机制，无论是 Shell 登录还是图形界面登录，一切都可以是非常简洁的流程完成。 Shell 登录时，Login Manager 以登录用户身份启动 Login Interactive Shell 进程，Shell 则运行相应的 Profile 脚本，如 `bash(1)` 加载 `~/.bash_profile` 或 `~/.profile`，作为最简单的会话管理机制，运行一些后台任务。对于图形界面来说，可以直接 `startx`、加载 `~/.xinitrc` 、启动 X 服务器和 Window Manager 等进程，或者运行 Wayland 混成器，或者由 Display Manager 负责创建 X 服务器或 Wayland 混成器进程，而图形环境所需要的程序要么通过 `~/.xinitrc` 这样的脚本启动，要么在 Window Manager 的配置文件中指定。

无论是什么方法，都是原始的机制。尽管它们原理十分简单，却存在诸多弊端，比如配置服务启动的方式不统一，Shell 登录、X 环境登录和 Wayland 环境登录需要各种不同的配置文件、需要写脚本以命令式的方式完成；比如这种方式没有充分利用 systemd 的支持，集成差、体验割裂。在 Linux 桌面系统中 systemd 早已普及的今天，这种原始方式显然跟不上时代。

### 基于 systemd 的现代方式

systemd 早已为 Linux 的各种应用场景设计好了一套服务和会话管理的框架，其关键点在于各种预定义的 `target`。`target` 是系统的生命周期的各个阶段起始或终止的标志，只要为每个程序写好 `service` 文件，并设置好其与 `target` 的关系，systemd 即可完全自动地在特定时间节点做好规划的工作，运行各种服务。

使用 systemd 为会话管理服务显著改善了服务配置的统一性，配置和管理服务不再是一件难事。后台服务启动失败了，可以通过 `journalctl` 和 `systemctl` 监控和控制；程序修改配置了，可以通过 `systemctl` 方便地重启。所有需要做的，只是在 `$XDG_CONFIG_HOME/systemd/user` 里写好每个程序的 `service` 文件，“做什么”而不是“怎么做”的声明式风格配置在扩展性上避免了编写零碎的脚本。

#### Window Manager 的管理

以 systemd 管理图形会话，则首先需要由 systemd 管理 Window Manager 进程本身。因此，需要为 Window Manager 创建一个 `service` 文件，比如我的 Wayfire，其中看似内容很多，最必要的只有 `ExecStart=/path/to/wayfire`：

```ini
[Unit]
After=graphical-session-pre.target
Before=graphical-session.target wayfire-session.target
BindsTo=graphical-session.target wayfire-session.target
Description=A customizable, extendable and lightweight environment without sacrificing its appearance
Wants=graphical-session-pre.target

[Service]
Environment="LOCALE_ARCHIVE=/nix/store/98661jgb955g9r2ximb0dss7d325vkx0-glibc-locales-2.42-47/lib/locale/locale-archive"
Environment="TZDIR=/nix/store/r29gp232igs3m47s7lfcaalfashd82bf-tzdata-2025c/share/zoneinfo"
ExecStart=/nix/store/zjhbbk4z09lx0kwan7n766k22cp7dd69-wayfire-0.10.1/bin/wayfire
NotifyAccess=all
Slice=session.slice
Type=notify
```

但是 Display Manager 并不一定认识 systemd，其启动桌面环境并不直接调用 systemd，而是搜索 `/usr/share/{x,wayland-}sessions`、`$XDG_DATA_DIRS` 中的 `share/{x,wayland-}sessions` 中的 Desktop Entry。所以 Desktop Entry 中需要我们自己写好对 systemd 的调用。还是以 Wayfire 为例，这里的 `...-wayfire-session` 脚本包括了使用 `systemctl` 启动 `wayfire.service` 的命令：

```ini
[Desktop Entry]
Exec=/nix/store/mz28r925v7baj7dywmf19zn67qh7520q-wayfire-session
Name=Wayfire
Type=Application
Version=1.5
```

#### 关键 `target`

systemd 的用户会话预定义了的 `target` 中，有三个对我们最关键。

`default.target`：

> This is the main target of the user service manager, started by default when the service manager is invoked. Various services that compose the normal user session should be pulled into this target. In this regard, default.target is similar to multi-user.target in the system instance, but it is a real unit, not an alias.

因此 `default.target` 会在用户首次登录后被“运行”，无论是 Shell 登录还是图形界面登录。这适合于在任何情况下都应该被运行的服务。但是，这个 `target` 是跨会话存活的，其生命周期与用户服务管理器一致。

`graphical-session-pre.target`：

> This target contains services which set up the environment or global configuration of a graphical session, such as SSH/GPG agents (which need to export an environment variable into all desktop processes) or migration of obsolete d-conf keys after an OS upgrade (which needs to happen before starting any process that might use them). This target must be started before starting a graphical session like gnome-session.target.

在 X 服务器或 Wayland 混成器启动前，由 `graphical-session-pre.target` 做必要的准备。只有此 `target` 完成了，才可以启动显示服务器。所以一般把显示前需要准备好的服务配置为被此 `target` 启动、先于此 `target` 启动。

`graphical-session.target`：

> This target is active whenever any graphical session is running. It is used to stop user services which only apply to a graphical (X, Wayland, etc.) session when the session is terminated. Such services should have "PartOf=graphical-session.target" in their \[Unit\] section. A target for a particular session (e. g. gnome-session.target) starts and stops "graphical-session.target" with "BindsTo=graphical-session.target".
>
> Which services are started by a session target is determined by the "Wants=" and "Requires=" dependencies. For services that can be enabled independently, symlinks in ".wants/" and ".requires/" should be used, see systemd.unit(5). Those symlinks should either be shipped in packages, or should be added dynamically after installation, for example using "systemctl add-wants", see systemctl(1).

在 X 服务器或 Wayland 混成器启动后，可以启动依赖图形界面环境的程序，如各种 Bar、壁纸软件等，这些程序则可以由 `graphical-session.target` 触发，一般配置服务为为被此 `target` 启动、晚于此 `target` 启动。

以上 systemd 预定义的 `target` 在所有的会话启动时都会运行，而有时我们可能需要对某些环境做定制，如对于 Wayfire、Niri 这样的独立 Wayland 混成器需要启动 `waybar`，而对于 GNOME 则只需要使用其自带的。这种情况下，可以自定义一些特殊的 `wayfire-session.target`、`niri-session.target` 并指定好依赖关系，就可以避免在所有情况下都启动不需要服务。

#### 环境变量的导出

X 环境下的图形程序需要 `$DISPLAY`，Wayland 环境下的图形程序需要 `$WAYLAND_DISPLAY`，启动显示服务器后都需要设置一些必要的环境变量。对于传统的会话管理来说，图形程序的进程都由显示服务器本身创建，只要显示服务器本身设置好这些环境变量，子进程自然会继承它们。

但是如果我们使用 systemd 进行服务管理，这些环境变量则不可以在显示服务器进程树外被感知到。自带 systemd 支持的 Window Manager 则会自动导出这些环境变量到全局范围，供 systemd 和 DBus，而如果缺乏 systemd 支持，则需要使用以下命令导出（对于 Wayland）：

```bash
dbus-update-activation-environment --systemd WAYLAND_DISPLAY DISPLAY XAUTHORITY XDG_CURRENT_DESKTOP XDG_SESSION_TYPE
```

此命令挑选命令进程所在的环境变量表（从 Window Manager 父进程中继承而来）中指定的环境变量，导出到 DBus 中，`--systemd` 选项则额外导出到用户服务管理器中，这使得后续通过 DBus 和 systemd 启动的进程都可以感知到这些环境变量。

`$XDG_CURRENT_DESKTOP`、`$XDG_SESSION_TYPE` 也是必要的环境变量，DBus 需要它们选择合适的桌面环境支持。

#### 精确的 Window Manager 初始化时序控制

systemd 中 `service` 的默认类型是 `simple`，这种服务的主进程一旦被创建且没有出错退出，服务则被认为启动成功。但是显示服务器总需要时间初始化，进程启动后的一小段时间内还不可以正常服务。如果不在这段时间后才被判定完成启动，`graphical-session.target` 极可能提早启动，依赖图形环境的程序则大概率会失败。

解决的方案是把服务修改为 `notify` 类型，只有服务进程通知 systemd 后，systemd 才会把它标记为启动成功，确保依赖关系实际正确。自带 systemd 支持的 Window Manager 可以用 C 函数 `sd_notify()` 完成通知。其他的则需要使用 `systemd-notify --ready` 通知。

## NixOS 下的实践

在上文中，我已经以 Wayfire 为例子介绍了一部分基本内容。接下来的内容则是基于 NixOS 的更详细的讲解。

### Unit 配置

首先创建一个用户服务 `wayfire.service`，用于启动 Wayfire 主进程：

```nix
{
  config,
  lib,
  pkgs,
}:
let
  customCfg = config.custom.system.desktop.wayfire-environment;
in
{
  config = lib.mkIf customCfg.enable {
    systemd.user.services."wayfire" = {
      description = "A customizable, extendable and lightweight environment without sacrificing its appearance";
      serviceConfig.ExecStart = "${pkgs.wayfire}/bin/wayfire";
      serviceConfig.Type = "notify";
      serviceConfig.NotifyAccess = "all";
      serviceConfig.Slice = "session.slice";
      environment = lib.mkForce { };
      bindsTo = [
        "graphical-session.target"
        "wayfire-session.target"
      ];
      wants = [
        "graphical-session-pre.target"
      ];
      after = [
        "graphical-session-pre.target"
      ];
      before = [
        "graphical-session.target"
        "wayfire-session.target"
      ];
    };
  };
};
```

`wayfire.service` 需要 `wants` `graphical-session-pre.target`，进行准备工作。同时其 `bindsTo` `graphical-session.target` 和 `wayfire-session.target`，这比 `wants` 由更高的要求，如果这两个 `target`s 任意一个失败，则此 `service` 也算失败，同时也把这两个 `target`s 的生命周期绑定到 `wayfire.service` 上。

`wayfire-session.target` 是一个给只属于 Wayfire 的服务使用的 `target`，定义如下：

```nix
{
  config,
  lib,
  pkgs,
}:
let
  customCfg = config.custom.system.desktop.wayfire-environment;
in
{
  config = lib.mkIf customCfg.enable {
    systemd.user.targets."wayfire-session" = {
      description = "Current Wayfire graphical user session";
      requires = [ "basic.target" ];
      unitConfig.RefuseManualStart = true;
      unitConfig.StopWhenUnneeded = true;
    };
  };
}
```

同时还有一个 `wayfire-shutdown.target`：

```nix
{
  config,
  lib,
  pkgs,
}:
let
  customCfg = config.custom.system.desktop.wayfire-environment;
in
{
  config = lib.mkIf customCfg.enable {
    systemd.user.targets."wayfire-shutdown" = {
      description = "Shutdown running Wayfire session";
      after = [
        "graphical-session-pre.target"
        "graphical-session.target"
        "wayfire-session.target"
      ];
      conflicts = [
        "graphical-session-pre.target"
        "graphical-session.target"
        "wayfire-session.target"
      ];
      unitConfig.DefaultDependencies = false;
      unitConfig.StopWhenUnneeded = true;
    };
  };
}
```

### 启动脚本

启动脚本命名为 `wayfire-session`，由此脚本负责调用 systemd 启动 Wayfire 服务。

首先检查是否已经在一个用户服务中：

```bash
# If this script is run as a systemd user service, then start Wayfire directly
if [ -n "${MANAGERPID:-}" ] && [ "${SYSTEMD_EXEC_PID:-}" = "$$" ]; then
  case "$(ps -p "$MANAGERPID" -o cmd=)" in
  *systemd*--user*)
    exec wayfire
    ;;
  esac
fi
```

做一些启动前的检查，包括防止重复启动、状态重置、把当前脚本中的环境变量导出到 systemd 和 DBus。Wayfire 默认的配置文件路径在 `~/.config/wayfire.ini`，我把它改动到了 `~/.config/wayfire/wayfire.ini`。

```bash
# Start Wayfire as a systemd user service
if systemctl --user -q is-active wayfire.service; then
  echo 'A Wayfire session is already running.'
  exit 1
fi
systemctl --user reset-failed

systemctl --user import-environment
if hash dbus-update-activation-environment 2>/dev/null; then
  dbus-update-activation-environment --all
fi
systemctl --user set-environment WAYFIRE_CONFIG_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/wayfire/wayfire.ini"
```

接下来正在启动服务，启动后需要阻塞在这里等待其退出。退出后则做一些清理工作，包括触发 `wayfire-shutdown.target`、清除图形会话相关环境变量。

```bash
systemctl --user --wait start wayfire.service

systemctl --user start --job-mode=replace-irreversibly wayfire-shutdown.target
systemctl --user unset-environment WAYLAND_DISPLAY DISPLAY XAUTHORITY XDG_SESSION_TYPE XDG_CURRENT_DESKTOP WAYFIRE_CONFIG_FILE
```

把这个启动脚本写到 Desktop Item 的 `Exec` 中，即可被 Display Manager 识别。

### Wayfire 内配置

在 Wayfire 内部，需要我们使用 `autostart` 插件手动进行一些操作：

```ini
[autostart]
00_environment = "dbus-update-activation-environment --systemd WAYLAND_DISPLAY DISPLAY XAUTHORITY XDG_CURRENT_DESKTOP XDG_SESSION_TYPE"
01_systemd_notify = "sleep 0.5 && systemd-notify --ready"
```

因为 Wayfire 不会自己导出环境变量，需要手动导出。在上面我们配置了 `wayfire.service` 的类型为 `notify`，所以需要在内部使用 `systemd-notify --ready` 进行反馈。`autostart` 脚本应该是在 Wayfire 初始化后运行的。关于 `sleep`，理论上是不需要，但是我尝试过如果不 `sleep`，有可能出现反馈过早的问题。

通过这些配置，我们得到了一个完全基于 systemd 的 Wayfire 桌面会话配置——一个真正现代的 Linux 桌面系统应有的模样。
