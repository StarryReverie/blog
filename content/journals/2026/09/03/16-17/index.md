---
title: Thursday, September 3, 2026 - 16:17
date: 2026-09-03T16:17:00+08:00
draft: false
math: false
---

最近更新了 NVIDIA，结果 Niri 变得非常卡顿。原因是 NVIDIA 的 DRM 设备路径从 `/dev/dri/renderD129` 改变为了 `/dev/dri/renderD128`，Niri 因此使用了 Intel 显卡的 DRM 设备。因此建议在引用设备文件路径时，尽可能使用稳定的表示，比如这里 `/dev/dri/by-path/pci-0000:01:00.0-render` 就相对更加稳定；又比如在指定硬盘设备文件路径时使用 `/dev/disk/by-id`，这是按照硬盘型号来选择的。
