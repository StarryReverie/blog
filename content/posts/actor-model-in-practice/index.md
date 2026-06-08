---
title: Actor 模型的思考和深入实践
date: 2026-06-08T21:55:14+08:00
draft: true
categories: Tech
tags:
  - Concurrency
  - Actor Model
  - Domain Driven Design
  - Rust
math: false
---

我最近完成了一个项目 [`selector4nix`](https://github.com/StarryReverie/selector4nix)，这是一个高并发的 Nix 缓存代理服务器。在 `selector4nix` 的代码中，Actor 模型被广泛使用，但是将 Actor 模型运用到实际环境并不简单，我想要在本文中总结对 Actor 模型的思考、实现 Actor 模型的各种选择和相关问题。
