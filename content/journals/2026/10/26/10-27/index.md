---
title: Monday, October 26, 2026 - 10:27
date: 2026-10-26T10:27:17+08:00
draft: false
math: false
---

最近又想重构 NixOS 配置了，传统 enable option 模式已经不再符合我的品味了。

我觉得 `nixpkgs/nixos` 里的模块可以算作底层的 primitive，同时也是副作用，就像 Haskell 中的 `IO` 一样。在朴素的 NixOS 配置架构中就是直接设置各种值，相当于 Haskell 中直接使用 IO。更相似的一点是，NixOS 配置和 `IO` 都不是自己就能产生副作用的，它们是对什么副作用的描述，真正产生副作用的分别是 `nixos-rebuild` 和 Haskell 的 runtime。Anyway，我这里只是想表达 NixOS 配置的 primitive 比较底层，我的理想配置架构不应该直接在这个层面上表达。

正如 Haskell 中经常用各种 Monad 来表达某种产生副作用的能力，进而构建 `IO` 之上的抽象，我觉得配置也可以这么做。首先高层次配置是按照 feature 划分的，每个 feature 高内聚，feature 之间则是松耦合，意味着和一个 feature 的含义的相关配置在一个地方实现且同时被启用，不同的 feature 的配置之间的联系尽可能少，相对独立，不容易出现开启一个而关闭另外一个会导致 eval 错误。

那么和 Monad 或者说一个 context 有什么关系呢？假设给 feature context 一个类型 `Feature a`，那么它在被运行（run）时可以产生底层的副作用（使用 NixOS 配置 primitive 进行设置），同时可以获得某种结果 a。这个结果可以作为其他 feature 的输入，即 feature 之间的数据依赖关系。run 一个 feature 并拿到结果，然后提供给其他 feature，其实就是 `>>=`。所以我们可以把所有的 feature 都定义为 monadic function，`b -> Feature a`，表示接受其他 feature 产生的计算结果，然后推导出自己的结果和相应的副作用。

举个实际例子，比如有 3 个 features：`helix`、`environment`、`shell`，`helix` 需要设置 `EDITOR=hx`、`alias vim=hx`、在 `.config/helix` `创建配置文件。environment` 接收其他 features 所有的环境变量配置、在 `.config/environment.d` 创建环境变量配置文件。shell 需要接受所有 features 的 alias 配置，并且需要在 profile 脚本中使用 systemd generator 从 environment.d 生成环境变量配置脚本并执行以导出环境变量。

helix 的副作用是在 `.config/helix` 创建配置文件，其 run 结果是 `environment` 配置 `EDITOR=hx` 和 `alias vim=hx`，helix 不接收输入，所以可以表达为 `Feature (EnvConfig, AliasConfig)``。environment` 就可以接收输入，也就是来自任意其他 features 的环境变量配置，所以可以表达为 `EnvConfig -> Feature EnvFilePath``。shell` 则表达为 `(AliasConfig, EnvFilePath) -> Feature ()`，因为在这个例子里 `shell` 不需要给其他 feature 提供什么计算结果，所以就返回 `()`，但是它仍然会产生写入 rc 和 profile 的副作用。

获得实际的底层配置的方法就是按照函数参数表达的 DAG 依赖关系，按拓扑序依次 run，所有的 features 都 run 后就会得到每个 feature 的副作用描述。其实在 NixOS 配置层面来看，这些副作用描述都是自己这一层的 API，换个说法就是获得了原始 NixOS module。

我们有了每个 feature 各自产生的原始 NixOS 配置后，其实是一个列表。其实 NixOS 模块是 Monoid，所谓的 `<>` 或者 `mappend` 就是 `lib.mkMerge`，我们就这样合并一下就可以获得最终的一份可以被 `nixos-rebuild` 应用的 NixOS 配置了。
