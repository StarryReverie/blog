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

本文将基于 Rust 来描述，各种实践上的想法和建议也将基于 Rust 展开。

## Actor 模型的应用细节

Actor 的教学文章已经非常多了，多到烂大街的程度，所以我不会介绍 Actor 的基本原理和实现，主要关注更实际方面的细节和选择。

### Actor 的消息设计

Actor 保护了状态，那么就需要给外部提供一些修改和查询内部状态的接口，Actor 消息就是这样的一种接口。Actor 的消息决定了外界访问状态的方式。然而，Actor 能不能真正保护状态，也取决于消息的语义。

考虑一个简单计数器的例子，以下是第一种消息设计方式：

```rust
pub enum CounterMessage {
    Increment,
    Decrement,
    Get(Channel<i32>),
}
```

以下是第二种消息设计：

```rust
pub enum CounterMessage {
    Set(i32),
    Get(Channel<i32>)
}
```

如果需要使计数器加一，那么第一种方法需要发送 `CounterMessage::Incrementt`，第二种方法需要先 `CounterMessage::Get(reply_to)`，获取到计数器值后在 Actor 外部增加，然后发送一个 `CounterMessage::Set(counter)`。

第二种方法存在 TOCTOU 问题，`CounterMessage::Get` 获得到的计数值在并发的情况下很可能是过期的，`CounterMessage::Set` 又会覆盖掉其他请求产生的作用。尽管在这个计数器的例子里这种错误非常显然，但是对于更加复杂的状态管理场景，这种错误可能就比较难发现了。

因此，Actor 的消息需要有原子性，一个消息就负责了一个连贯的修改或查询。所有前后依赖的修改步骤都由一个消息触发时，Actor 的串行处理机制就保证了每个修改操作看到的是最真实的状态。这样的一个消息应当是独立的、self-contained 的，不依赖于其他消息的结果，就比如 `CounterMessage::Increment` 就是一个正面例子，`CounterMessage::Get` 再 `CounterMessage::Set` 就会有问题。一旦修改操作依赖的值不是最新的状态，那么就可能导致不一致性问题，而 Actor 的消息投递机制本身就决定了多个消息之间无法连续。因此，需要向一个 Actor 发送多次消息就是一个数据竞态的可能原因。

我自己就曾写出过这样的的一个反例。在使用 ratatui 开发一个 TUI 应用时，我需要渲染一个 `List` widget，并且需要可以支持通过方向键移动其中的高亮选择。在这个应用中，每一个 widget 都使用一个 Actor 管理自己的状态，这个 `List` widget 也有一个 `ListStateManager` Actor 管理 `ListState` 以及其他相关状态。`List` 中的项目数量很可能超过 widget 的高度，所以需要在渲染的同时根据高度调整显示的项目的区间，即 `ListState` 不仅包括当前的选中项目的索引 `selected`，还包括当前的显示项目偏移量 `offset`。但是 `ListStateManager` 被设计为与渲染无关，根本没有办法获取到当前的 widget 高度，无法合理地调整 `offset`。<!-- spellchecker:disable-line -->

最初的设计中，我给 `ListStateManager` 设计了这样的消息：

```rust
pub enum ListMessage {
    SelectPrevious,
    SelectNext,
    SetListState(ListState),
    // ...
}
```

意思是在接受到键盘事件后，向 `ListStateManager` 发送消息 `ListMessage::SelectNext` 或 `ListMessage::SelectPrevious` 以修改 `selected`，在渲染的过程中，获取 `ListStateManager` 包含的 `ListState` 给 `<&List as StatefulWidget>::render_widget_stateful(..)` 使用并更新 `offset`，最后发送新 `ListState` 给 `ListStateManager`。

问题就出在这里，渲染时的 `ListMessage::SetListState` 和 `ListMessage::SelectNext` 是分离的，渲染时使用的 `ListState` 的状态可能是过期的，虽然对于 UI 显示本身来说，短暂过期是可以接受的，但是这里的写回步骤却完全打破了原子性和一致性，过期的 `ListState` 中的 `selected` 覆盖了其他的 `ListMessage::SelectNext` 正确修改的 `selected`，导致最终高亮选择没有正常移动。

### 最终一致性

Actor 非常擅长在并发写的情况下保护状态修改，但是在读方面却有着很大的限制。由于使用消息来通信，读取状态的延迟明显提升，因为读取的请求消息及其回复也需要进入正常排队流程，等到状态回复消息被处理时，这个消息中的状态早已与最新状态不同。这使得横跨多个 Actor 的状态修改变得非常困难，Actor 模型天生无法满足强一致性，所以我们只能退而求其次，只保证最终一致性。

尽管如此，最终一致性没有想象中那么难以实现。首先，有的状态本身没有严格的时效性要求，短暂的延迟是可以接受的，典型的场景就是 UI widget 的渲染和应用的真实状态之间会有微小的同步滞后。一般情况下，会存在两个 Actor A 和 B，Actor A 更新状态后，Actor B 从 Actor A 的状态继续派生出自己的状态。只要有机制可以让 Actor B 知道 Actor A 的状态变化，就可以保证最终一致性。状态同步可以是 Push 风格的，即 Actor A 发送消息给 Actor B 显式通知自己的变化，也可以是 Pull 风格的，对标准 Actor 模式做一些改动，允许 Actor B 直接观察 Actor A 的状态变化，典型的方法就是利用 `tokio::sync::watch` 中的各种 Channel。后者在单向数据流、多观察者的情况下可能更加方便，并且避免了 Actor 之间循环依赖。这种方式的仅适用于单向数据流，一旦涉及到循环的数据流，就会引入上一节所说的 TOCTOU 问题。

需要注意使用 `watch::Receiver<T>` 的一些陷阱。`watch::Receiver<T>` 的 `borrow()` 方法会返回一个 guard，可以通过引用访问其中的值。但是当 guard 存在时，`watch::Sender<T>` 的写入会被阻塞，只有所有的 guard 被释放后才可以继续。`watch` Channel 本质上是一个带有 `changed()` 通知功能的读写锁，所以也需要注意最小化临界区。那么如果需要长时间使用这个值怎么办呢？我的方法是把这个状态装入 `Arc`，即使用 `watch::Receiver<Arc<T>>` 来获取状态，`borrow()` 后立刻 `Arc::clone(..)` 然后释放 guard。其他可选的方案还有 `borrow()` 后 `clone()`、每次使用时直接短暂 `borrow()`，前者在本质上和 `Arc` 方法类似，但是复制次数更多，临界区更大，后者虽避免了各种 `clone()`，但是多次 `borrow()` 使用的可能是不同的状态，不一致性风险更大。

如果不可避免需要同时修改两个状态，又要怎么办呢？既然我们已经在使用 Actor，那么 2PC 这样的方式肯定是不可行的。这个问题的关键在于我们需要一种更精细控制的事务，与其强行要求把所有的状态修改聚合在一起统一提交或回滚，不如先各自修改每个状态再根据每个状态修改的结果对其他的状态做补偿修改。这种方法一般被称为 SAGA 模式或流程管理器。可惜的是，这种方法不像普通事务那样通用，需要根据场景设计具体的流程和控制逻辑，但这也是 SAGA 模式的优势所在。普通事务管理因为通用，所以只能采用最保守的做法——记录原来的值、完成修改、最终提交或回滚，无法利用特定流程的特点来优化回滚逻辑，且临界区必须覆盖整个过程，导致了冲突严重。

以典型的选课场景为例，选课需要扣减课程余量和增加学生学分，两个状态需要一起被修改。普通事务只能做到保存原有的课程余量和学生学分，在提交时基于原有值和当前值检查是否有冲突，选择是否回滚。这个过程的临界区比较大，在大量并发请求时就会导致严重的冲突，大多数选课操作都会因为冲突导致失败。然而仔细思考，选课真的需要知道一个确切的课程余量吗？只需要避免余量被扣减到负数即可。其次，学分的增减虽然确实需要一起执行，但是其仍然与余量增减相对独立。所以更好的办法是把余量扣减和学分增加分开，两者完全可以并发执行且不放在同一个事务中，这样就缩减了两个操作的临界区并简化了操作为原子增减，减少了冲突可能性。当余量扣减失败后，可以重新发起补偿修改，把学分减回去。这也同样是我（可能）遇到过的真实案例，因为我曾体验过我大学的某使用 Classic ASP 实现的老旧选课系统，估算的每秒能够处理的选课请求甚至不到 10 个，即使 ASP 性能再差，正确实现的情况下也不应该是这种水平。（题外话：这个系统也终于死了）

### 多元素查询

如果我们用一堆 Actor 分别维护了一堆状态，现在又需要筛选出其中满足一定条件的状态，也就是做查询，有需要怎么做呢？这里的一系列状态不再集中存放在一个集合数据结构中，而是散落在各个 Actor 中，使得遍历更加复杂。解决查询问题的方法有多种。

首先是 Scatter-Gatter 模式，这种就是最简单粗暴的方式，查询需要知道哪些状态，就像持有这些状态的 Actor 发送消息获取，即 Scatter 过程，这些 Actor 再回复以告知状态，在查询处收集所有的回复，即 Gather 过程。这种方法非常直观，也非常符合 Actor 互相通信的样子，但是性能容易受到需要请求的 Actor 的数量限制。每次查询都需要发送巨量的消息，会给整个系统造成不小的压力，而这里面大多数都开销都不是必要的。

如果我们选择通过 `watch` Channel 这样的工具直接提供状态访问，另外一种可选的方式就是直接遍历所有 Actor 并获取状态。这种方法比起 Scatter-Gatter 模式更为直接，在代码量和性能上更加优秀。我个人更加偏好这种做法。

然而无论是 Scatter-Gatter 模式还是直接读取 `watch` Channel，都避免不了需要重复遍历整个集合，在频繁查询的情况下时间复杂度就是一个严重的问题。这时就需要采用 Denormalization 的思想，修改后提前准备好查询结果，查询时避免重复扫描。这种方法结合上 Actor 就是 Index Actor，使用 Index Actor 来维护查询结果，每次每个独立状态变化后，相对应的 Actor 就发送这个状态到 Index Actor，Index Actor 更新查询结果。这种方式的好处在于修改可以增量，Index Actor 不必完全重新查询所有状态，只需要修改一小部分查询结果即可。Index Actor 同样可以使用 `watch` Channel 来给外部提供查询结果。

如果不想写 Index Actor 怎么办？那么我们也完全可以借助 DB，反正应用一般也需要 DB 来持久化状态，利用上现成的查询语言也是非常方便的。至于一致性问题，既然我们已经接受了最终一致性，那么 DB 的状态不同步也不是那么严重的问题。这种情况下，DB 就变成了 Reporting DB，实际上是某种程度上的 CQRS。

### Actor 的管理

Actor 作为一个带有状态的持续执行流，管理上比普通的互斥锁或更大规模的 DB 要更加复杂。特别是使用 Actor 来管理实体时，每一个实体都会有一个对应的 Actor，那么就需要可以通过实体的标识来引用对应的 Actor。相较于 DB 模式的加载实体、修改、写回的过程，Actor 管理的实体会更长久地保留在内存中，生命周期状态会更多。其次，内存的容量可能不足以支撑所有的实体都有一个 Actor 运行，总会有动态启动和停止 Actor 的必要。

对于一个大量使用 Actor 的应用，在每个地方都手动初始化、获取、终止 Actor 是不可接受的，所以这时候就需要一个专用的 Actor Registry 来管理相关的 Actor。一个 Actor Registry 负责管理所有相同类型的 Actor 的完整生命周期，并且给外部提供了一个统一的引用 Actor 的方式。外部需要向某个 Actor 发出消息时，只需要从 Actor Registry 按照 ID 请求获取 Actor 的引用（有时也称为 Actor Address），然后 Actor Registry 就会直接提供引用或自动启动相应的 Actor，在适当时机，也会主动关闭掉闲置的 Actor。

Actor 的管理还涉及到异常情况的处理。在大多数介绍 Actor 的文章中，都会提到所谓 Let it crash 的说法，Actor 如果出现了错误，就直接死掉即可，只需要重启恢复即可。然而，我认为这种方法有着严重的缺陷和破坏性，相当于 `panic!()`。在 Rust 中，处理错误的最佳方式是 `Result<T, E>`，`panic!()` 仅仅适用于在契约和假设破坏、遇到编写代码的 bug 时触发，程序的所有执行过程都应该被终止。Actor 崩溃时，Actor 的上下文会完全丢失，尽管错误的状态被清除了，但是正常的信息也被丢掉了，比如 Actor 信箱，这意味着所有还没有处理的消息也都丢失了。这就使得消息投递、回复接收需要考虑消息丢失的情况，进而要考虑至少一次投递、幂等处理等等各种复杂机制，对于一个单进程应用来说实在不必要。而使用 `Result<T, E>` 时，只需要通过 `reply_to` Channel 发送一个 `Err(E)` 的消息即可，而 Actor 的内部状态只要确保只在成功后的最后一刻修改，即可避免状态被损坏。

## 与 DDD 的结合

DDD 是我非常认可的方法，其中的基于 Aggregate 的设计思想实际上与 Actor 非常适配。我接下来就以 selector4nix 为例说明我是怎么结合 DDD 和 Actor 的。

selector4nix 是一个 Nix 缓存代理服务器，其对于 Nix 客户端的 NAR Info 查询请求，会将其并发地转发给多个上游缓存，并选取其中最快的一个返回。selector4nix 基于 DDD 设计，关键的 Aggregate 是上游缓存服务器 `Substituter`、NAR Info 文件 `NarInfo`、NAR 文件信息 `NarFile`。

### Aggregate 作为 Actor 的状态

在 DDD 中，一个 Aggregate 是一个内聚的实体和值的结构，对于这里面的实体和值的操作都必须通过 Aggregate 的根提供的 API 来完成，一个 Aggregate 就是一个完整的边界，保持其中的状态满足不变量。所以当我们把 Aggregate 作为一个 Actor 的状态时，对 Aggregate 进行操作的方法就自然地映射为了 Actor 的消息。根据上文提到的 Actor 的消息应该满足原子性的原则，对于 Aggregate 的操作也会具有高内聚性。当我们使用 Actor 消息来触发对 Aggregate 的修改时，Aggregate 自然地获得了并发读写的保护，每一个业务操作都从正确状态开始、以正确状态结束，数据竞态条件就这样轻松的解决了。

反观没有 Actor 的情况时，我们可能会选择在 Usecase 方法中直接从 Repository 加载 Aggregate，修改，然后写回。在没有事务控制的情况下，出现数据竞态是必然的结果。加上事务控制后，虽然可以保证正确性，但是性能有所影响。

在 selector4nix 中，代理需要监控各个 `Substituter` 的健康状态，`Substituter` 如果处于不正常的状态，则会被代理跳过，避免不必要的请求。`Substituter` 可以处于以下四种状态：

- `Normal`：正常工作中。
- `Offline`：离线，比如没有上游服务器没有开机。
- `ServiceError`：虽然主机可达，但是处于无法正常工作的状态。
- `MaybeReady`：经过 `Offline` 和 `ServiceError` 的冷却期后，可能已经恢复正常了，但是还需要请求来确认已经完全恢复。

以下是 `Substituter` 对应的 Actor 基本结构。`SubstituterRequest` 是外部可以发送的消息，`SubstituterInternal` 是自己发送给自己的消息。`SubstituterActor` 中 `init` 是初始状态，`context` 是 Actor 的上下文，包括信箱等内容。其他的则是一些组件。

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SubstituterRequest {
    ServiceSuccessful,
    ServiceOffline,
    ServiceError,
}

pub enum SubstituterInternal {
    NextRetryReady,
    ProbingFinished(Result<(), ProbeSubstituterError>),
}

pub struct SubstituterActor {
    init: Option<Substituter>,
    context: Context<SubstituterRequest, SubstituterInternal>,
    substituter_service: Arc<SubstituterService>,
    substituter_probing_provider: Arc<dyn SubstituterProbingProvider>,
    substituter_repository: Arc<dyn SubstituterRepository>,
}
```

以下是 `SubstituterActor` 处理消息的方式。接收到的消息都会被转换为对 `Substituter` 的方法调用。这些方法还会返回一些事件，用于触发后续的操作，具体的细节可以看后面的内容。

```rust
impl Actor for SubstituterActor {
    type Request = SubstituterRequest;
    type Internal = SubstituterInternal;
    type State = Substituter;

    // ...

    async fn on_request(
        &mut self,
        substituter: Self::State,
        request: Self::Request,
    ) -> Option<Self::State> {
        match request {
            SubstituterRequest::ServiceSuccessful => {
                let (substituter, events) = substituter.update_on_service_successful();
                self.exec_all_events(&substituter, events).await;
                Some(substituter)
            }
            SubstituterRequest::ServiceOffline => {
                let now = Instant::now();
                let (substituter, events) = substituter.update_on_service_offline(now);
                self.exec_all_events(&substituter, events).await;
                Some(substituter)
            }
            SubstituterRequest::ServiceError => {
                let now = Instant::now();
                let (substituter, events) = substituter.update_on_service_error(now);
                self.exec_all_events(&substituter, events).await;
                Some(substituter)
            }
        }
    }

    async fn on_internal(
        &mut self,
        substituter: Self::State,
        internal: Self::Internal,
    ) -> Option<Self::State> {
        match internal {
            SubstituterInternal::NextRetryReady => {
                let (substituter, events) = substituter.update_on_next_retry_ready();
                self.exec_all_events(&substituter, events).await;
                Some(substituter)
            }
            SubstituterInternal::ProbingFinished(res) => {
                let now = Instant::now();
                let (substituter, events) =
                    self.substituter_service
                        .update_on_probing_finished(substituter, res, now);
                self.exec_all_events(&substituter, events).await;
                Some(substituter)
            }
        }
    }
}
```

### Actor 与 Repository 集成

Actor 控制了 Aggregate 的并发访问，对于 Aggregate 的修改只有 Actor 来完成，那么 Repository 的状态同步也可以交给 Actor 负责。在每个消息处理完成后，Actor 把修改后的 Aggregate 写回 Repository，由于同一个 Aggregate 必定只有一个 Actor 拥有，每个 Actor 只会写自己持有的那个唯一的 Aggregate，Repository 的写入也就不存在竞争了。

在 selector4nix 中，持久化 Aggregate 到 Repository 是手动完成的，但是理论上，也可以用一个实现了 `Actor` trait 的 Actor Decorator，处理请求时转发请求给内部，在每次处理请求后自动保存状态，实际上就是实现了一个类似 akka-persistence 的东西。在这里可以做一些优化，比如避免每次请求都持久化，而是定时或等待若干请求后写入。

以下代码就是 `on_request()` 和 `on_internal()` 调用的 `exec_all_events()` 的实现。

```rust
impl SubstituterActor {
    // ...

    async fn exec_all_events(
        &mut self,
        substituter: &Substituter,
        events: Vec<UpdateSubstituterEvent>,
    ) {
        for event in events {
            self.exec_event(substituter, event).await;
        }
    }

    async fn exec_event(&mut self, substituter: &Substituter, event: UpdateSubstituterEvent) {
        match event {
            UpdateSubstituterEvent::NotifyUnavailable => {
                let url = substituter.url().clone();
                let prev_failures = substituter.prev_failures();
                tracing::warn!(%url, %prev_failures, "substituter became unavailable");
                self.substituter_repository.save(substituter.clone()).await;
            }
            UpdateSubstituterEvent::NotifyAvailable => {
                tracing::debug!(url = %substituter.target().url(), "substituter became or stayed available after probing");
                self.substituter_repository.save(substituter.clone()).await;
            }
            // ...
        }
    }
}
```
