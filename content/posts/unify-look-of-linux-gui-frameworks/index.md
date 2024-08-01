+++
title = '统一 Linux GUI 框架主题和外观'
date = 2024-07-31T23:21:07+08:00
draft = false
+++

在 Linux 下，GUI 外观配置一直是一个复杂的话题。本文试图梳理 Qt 和 GTK 两种 GUI 框架的相关概念，并给出不同情况下的配置方案，实现外观的统一。

本文讨论的 Qt 包括 Qt 5 和 Qt 6，GTK 包括 GTK 2、GTK 3、GTK 4，并且将以 Qt 6 和 GTK 4 为重点。测试的 DE 和 WM 包括 GNOME 4.46、KDE Plamsa 6.1、Hyprland 0.41。

## 配置组成

### 基本概念

外观配置一般包括以下几个方面：

- 主题/Theme：这是一个比较广泛的概念，一般包括了样式、图标和鼠标指针等各配置项在内。
- 样式/Style：一般指程序窗口、面板、组件的外观。
- 图标/Icon
- 指针/Cursor
- 字体/Font
- 配色方案/Color Scheme：较细粒度的配置项，诸如主要颜色、强调颜色的配置都属于配置方案。
- 声音/Sound
- ……

这是一个比较广泛的定义，具体到各框架，又会产生一定的变化。

### GTK

GTK 中可直接配置的部分相对较少，主要是：

- 主题/Theme：主要与一般定义中的样式/Style 对应。
- 图标/Icon Theme：与一般定义中的图标/Icon 相同。
- 指针/Cursor Theme：与一般定义中的指针/Cursor 相同。
- 字体/Font：与一般定义中的字体/Font 相同。

包括 GNOME 在内的基于 GTK 开发的 DE 基本上直接使用上述概念，利用这些 DE 的工具配置外观，基本上就是对 GTK 的配置直接修改。

### Qt

对于独立的 Qt，配置项包括：

- 样式/Style：与一般定义中的样式/Style 对应。
- 图标/Icon：与一般定义中的图标/Icon 相同。
- 字体/Font：与一般定义中的字体/Font 相同。
- 颜色方案/Color Scheme: 与一般定义中的配色方案/Color Scheme 相同。

这里并没有指针的配置，但这并不说明 Qt 程序不能配置指针，方法会在下面介绍。

这里的样式并不一定是一个样式包，也可以是一个负责渲染界面元素的程序，称为主题引擎，比较典型的例子就是 Kvantum。

如果是 KDE，配置的情况则有很大的变化，因为 KDE 在 Qt 的基础上又做了一层抽象，Qt 程序的配置项变为：

- 全局主题/Global Theme：这是所有可配置的选项的集合，即包括了其他所有部分的一个套装，但是部分可以被单独覆盖。
- 应用程序外观样式/Application Style：普通程序的样式/Style。
- Plasma 外观样式/Plasma Style：Plasma Shell 和 Plasma 组件的样式/Style。
- 窗口装饰元素/Window Decoration：普通程序的标题栏以及之上各种按钮。
- 图标/Icons
- 指针/Cursors
- 颜色/Colors
- 系统声音/System Sounds
- 欢迎屏幕/Splash Screen：KDE Plasma 启动时的加载界面。

由于存在这一层抽象，KDE Plasma 上的配置并不可以完全脱离 DE 本身，只有部分可以独立为 Qt 的配置。

## 配置方法

### GTK

以下是 GTK 各配置所需组件的存储目录（仅考虑用户安装）：

- 主题/Theme：`$XDG_DATA_HOME/themes`
- 图标/Icon Theme：`$XDG_DATA_HOME/icons`
- 指针/Cursor Theme：`$XDG_DATA_HOME/icons`
- 字体/Font：`$XDG_DATA_HOME/fonts`

GTK 2 程序通过配置文件 `$HOME/.gtkrc-2.0` 进行配置，而 GTK 3、GTK 4 则更加复杂。

当 GTK 程序运行于 X11 时，其通过与 Xsettingsd 通信，间接地从 GSettings 获取配置，GSettings 是 GTK 程序的配置前端，与 dconf 这个后端数据库配合。当 dconf 中的配置不存在或 dconf 本身不可用时，GTK 则会转而通过 `$XDG_CONFIG_HOME/gtk-3.0/settings.ini` 和 `$XDG_CONFIG_HOME/gtk-4.0/settings.ini` 获取配置。

当 GTK 程序运行与 Wayland 时，其不再使用 Xsettingsd，而是直接从 GSettings 获取配置，并不再读取配置文件。即在 Wayland 下，GTK 只会使用 Gsettings 和 dconf。

当前，Wayland 已经广泛使用，大有取代 X11 之势，所以我们的配置也应当把 Wayland 下的可用性放到首位。GTK 程序的配置方案就是使用 dconf，而 dconf 的设置有多种途径，包括 Gsettings 和 dconf-editor 等 dconf 的前端。保险起见，也可同时修改配置文件。

除此之外，GTK 的主题也可以通过 `GTK_THEME` 这一环境变量强制指定，可以作为调试的工具或者某些玄学问题的解决方案。

通过运行以下命令，则可以调用 GSettings 修改配置：

```bash
gsettings set org.gnome.desktop.interface gtk-theme "<YOUR-THEME>"
gsettings set org.gnome.desktop.interface icon-theme "<YOUR-ICON-THEME>"
gsettings set org.gnome.desktop.interface cursor-theme "<YOUR-CURSOR-THEME>"
gsettings set org.gnome.desktop.interface font-name "<YOUR-FONT>" # Not recommended, see below
```

如果不习惯 CLI，也可以使用带 GUI 的 dconf-editor。

对于字体的配置，我个人不推荐在 dconf 层面配置，这是因为 fontconfig 可以在更广泛的层面完成配置，并且其已经是 Linux 字体配置的事实上的标准。

同时修改配置文件 `$XDG_CONFIG_HOME/gtk-3.0/settings.ini` 和 `$XDG_CONFIG_HOME/gtk-4.0/settings.ini`：

```ini
# $XDG_CONFIG_HOME/gtk-{3,4}.0/settings.ini
[Settings]
gtk-theme-name = <YOUR-THEME>
gtk-icon-theme-name = <YOUR-ICON-THEME>
gtk-cursor-theme-name = <YOUR-CURSOR-THEME>
gtk-font-name = <YOUR-FONT>
```

GTK 2 的配置：

```ini
# $HOME/gtkrc-2.0
gtk-theme-name = "<YOUR-THEME>"
gtk-icon-theme-name = "<YOUR-ICON-THEME>"
gtk-cursor-theme-name = "<YOUR-CURSOR-THEME>"
gtk-font-name = "<YOUR-FONT>"
```

### Qt

Qt 程序本身不会读取配置，而是使用 Qt Platform Abstraction 即 QPA 这一接口与外部程序交互获取配置。对于 Qt 5 和 Qt 6 来说，qt5ct 和 qt6ct 提供 QPA 的交互。本文以 qt6ct 为主，qt5ct 方法一样。

运行 qt6ct 后，会有一系列标签页，“外观”标签包含了样式和配色方案的配置，“界面”标签则是一些界面的细节设置，其他的标签页则比较易懂。

默认情况下，qt6ct 会有 Breeze、Fusion、Windows 三种风格。在这里，如果我们安装了 Kvantum，则又会多出 Kvantum 和 Kvantum-dark 两项。虽然 Qt 程序的风格选择很少，但是通过 Kvantum，则可以完成非常多样的配置。KDE 主题一般都有对应的 Kvantum 主题，许多 GTK 主题都有相应的 Kvantum 主题移植。在 qt6ct 中设置为 Kvantum 或 Kvantum-dark 后，就可以在 Kvantum Manager 中安装和设置。

以 [Orchis](https://github.com/vinceliuice/Orchis-kde) 主题为例，该 KDE 主题提供的各种 Kvantum 主题变体都位于一个叫 [Kvantum](https://github.com/vinceliuice/Orchis-kde/tree/main/Kvantum) 的目录下，这些子目录就是 Kvantum 的主题目录，包含一个 `<THEME>.kvconfig` 文件。在 Kvantum Manager 中，安装主题只需要在“安装/更新主题”标签页选择对应的主题目录安装即可，应用主题则在“变更/删除主题”选择即可，“配置当前主题”则可以做 UI 的细化配置，包括十分流行的“毛玻璃”模糊特效！如果需要手动安装 Kvantum 主题，则将包含主题的目录复制到 `$XDG_CONFIG_HOME/Kvantum` 中。

所以，Qt 的各配置项的配置方式如下：

- 样式/Style：qt6ct 中选择自带的样式或 Kvantum，可以结合 Kvantum 配置。
- 图标/Icon：qt6ct 中配置，储存位置与 GTK 相同。
- 字体/Font：qt6ct 中配置，储存位置与 GTK 相同。
- 颜色方案/Color Scheme: qt6ct 中配置，位于 `$XDG_DATA_HOME/color-schemes`。

现在，已经通过 qt6ct 完成了外观的选项设置，但是没有让 Qt 程序从 qt6ct 读取配置。这就需要 `QT_QPA_PLATFORMTHEME=qt6ct` 完成。如果需要单独设置样式（如 Kvantum），则可以使用 `QT_STYLE_OVERRIDE=Kvantum` 完成。

至于指针的配置，Qt 选择从当前 DE 的配置或 X11 的指针配置中读取。如果使用 X11 的配置，则要修改 `$HOME/.Xresources`：

```plain
Xcursor.theme: <YOUR-CURSOR-THEME>
```

在 `$HOME/.xinitrc` 或 `$HOME/.xprofile` 中添加：

```bash
xrdb ~/.Xresources
```

也可以使用环境变量 `XCURSOR_THEME=<YOUR-CURSOR-THEME>` 来设置。

### KDE

KDE 下的配置就直接使用 KDE 的系统设置完成。

各配置项的储存位置：

- 全局主题/Global Theme：位于 `$XDG_DATA_HOME/plasma/look-and-feel`。
- 应用程序外观样式/Application Style：同 Qt。
- Plasma 外观样式/Plasma Style：位于 `$XDG_DATA_HOME/plasma/desktoptheme`。
- 窗口装饰元素/Window Decoration：`$XDG_DATA_HOME/aurorae`，Aurorae 是 KDE 使用的主题引擎，专用于窗口装饰元素。
- 图标/Icons：同 Qt。
- 指针/Cursors：同 Qt。
- 颜色/Colors：同 Qt。

注意全局主题的安装并不是要把全局主题的所有部分都置于 `$XDG_DATA_HOME/plasma/look-and-feel`，因为全局主题实际上只是一个清单，只需要把包中同为 `look-and-feel` 的目录中的文件复制到此处就可以了，其他的部分通过配置文件声明，可以被 KDE 自动找到。

值得一提的是，可以通过 `QT_QPA_PLATFORMTHEME=kde` 设置使用 KDE 的配置，不过一般并不必要。


## 配置方案

根据上文的介绍，给出各种情况下的配置方案。

- GNOME 或 KDE Plasma：直接使用 DE 的方式配置，这是最简单且直接的方式。
- GNOME + KDE Plasma：为 GNOME 和 KDE 挑选相同的主题，并用 Kvantum 设置 Qt 程序的应用程序样式，在外观上能够做到基本统一。
- GNOME + WM：GTK 使用 GNOME 配置，Qt 使用 qt6ct 配置。
- KDE Plasma + WM：GTK 使用 GSettings 和可选的配置文件，Qt 用 KDE 的配置。
- GNOME + KDE Plasma + WM：与 GNOME + KDE Plasma 的情况相同。
- WM：GTK 使用 GSettings 和可选的配置文件，Qt 用 qt6ct。

我用的 WM 是 Hyprland，但这些配置一般与 WM 的选择无关。

WM 的配置难度是最大的，但是也相对灵活，因为这种方法与 DE 的关联很小，安装 DE 后也大概率可以继续使用，如果是 KDE Plasma，则可以直接将 `QT_QPA_PLATFORMTHEME` 修改为 `kde`，更好利用 KDE Plasma 的配置。
