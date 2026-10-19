---
title: Thursday, October 8, 2026 - 20:15
date: 2026-10-08T20:15:00+08:00
draft: false
math: false
---

现在发现 flake 的 follows 如果填写的是空，指向的是自己，而不是的空 flake 🤯

在 REPL 中，我的 NixOS 配置中的 `inputs.microvm.inputs.spectrum.output` 和当前 flake 的输出是一样的（

PS：之前尝试写一个递归 pin flake inputs 的东西，结果出现 infinite recursion，应该就是这个问题了。

某种程度上好像也有道理，找一下规律，`self.inputs.microvm.inputs.spectrum` 应该是 `"microvm/spectrum"`，`self.inputs.microvm` 应该是 `"microvm"`，那么 `self` 就是 `""` 了（
