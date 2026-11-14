---
title: Saturday, November 13, 2026 - 22:08
date: 2026-11-13T22:08:00+08:00
draft: false
math: false
---

最近把 Helix 换成了 Zed，原本以为可以就此和 Helix 说拜拜了，然而还是吃回旋镖了，说 Zed 替代 Helix 还是说太早了。

在 Helix 中，`shift-r` 是替换操作，把选区内容替换为剪贴板中的文本。但是在 Zed 中，这个键位被绑定为 `editor::Paste`，其含义是直接粘贴系统剪贴板的内容，根本就没有替换！

在发现这个问题后，我打算解绑 `shift-r` 键位，但是无论怎么尝试，原来的 `editor::Paste` 动作还是阴魂不散。我查阅 Zed 的默认键位配置文件，搜索发现 `shift-r` 的配置压根儿就不存在，是直接硬编码的，甚至 `y`、`p` 这些也是。属于是非常灵车了，不明白为什么不能自定义这些键位。

目前看上去这个 [PR](https://github.com/zed-industries/zed/pull/61285) 能解决问题，不过等待合并又要好长一段时间了。
