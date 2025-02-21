---
title: 对 Rust 错误处理的思考和 anyerr
date: 2025-02-20T11:08:21+08:00
draft: false
categories: Tech
tags:
  - Rust
  - Project
math: false
---

错误处理是 Rust 中核心的一部分，从标准库中的 `Result<T, E>` 和 `Error` 到社区的 `anyhow`、`thiserror`、`color-eyre`、`snafu` 等 crates，可见其重要地位。但是在我看来，这些仅仅是错误处理机制的基础，而不是一个十分完备的框架，同时某些 crate 的设计，要么不能符合实际需要，要么使用起来很麻烦。本文将阐述我对 Rust 错误处理的理解和自己的实践 [`anyerr`](https://github.com/oosquare/anyerr)。

## `std` 中的基础设施

在讨论我对错误处理的理解之前，有必要先回顾标准库中与错误处理相关的基础设施。

截至本文写作时间，Rust 的最新版本为 1.84.1，接下来将以此版本为基础进行讨论。

### 错误与结果

标准库中最广为人知的一个类型就是 `Result<T, E>`，用来表示一个可能成功或失败的结果。这是一个非常精妙的设计，主要体现其可以编码成功或失败中的一者，而不是将失败结果糅合进成功结果的值中。C 广泛采用后一种处理方式，导致 API 的混乱，当然这很大一部分是历史原因。在 Java 等以异常为主要错误处理机制的语言中，这一问题有了很大改善，但这又引入了隐式控制流的问题，`Result<T, E>` 则又避开了这个问题。所以，`Result<T, E>` 应该是一个很不错的机制。

尽管 `Result<T, E>` 中的 `E` 代表错误，但标准库对其具体应是什么类型没有什么限制。一般情况下，`E` 是一个实现了 `Error` trait 的类型，或者是其他可以间接地访问到内部的错误的类型，如 `Box<dyn Error>`。

### 错误类型的统一契约

若某类型实现了 `Error`，那么其就可以以一种标准的形式来被集成的错误处理的框架中。`Error` 规定了如何显示错误信息（通过 `Display` trait）和如何溯源错误（通过 `<Self as Error>::source()`）。

在 Rust 早期，并没有 `Error`，错误处理是处于一种野蛮生长的状态。直到 `Error` 的引入，Rust 才可以算是有了一套标准的错误处理机制。

### 错误的传播

`Result<T, E>` 虽好，但在深层函数调用中，一次次手动向上传播错误却很麻烦。`?` 运算符则有效解决了这个问题，实现了把错误方便的提前返回，传播给调用方。

`?` 的使用不要求被传播错误类型和接受的错误类型完全相同，只需要有 `From` 的联系，即如果 `E1: From<E2>`，那么对 `Result<U, E2>` 使用 `?` 就可以把错误传播为 `Result<T, E1>`。

### 错误时的调用堆栈

`Backtrace` 提供可控的调用堆栈捕获。只要在错误类型中添加此字段，则可以获得相应功能。

### 其他未稳定的功能

`Report` 是错误报告的工具，可以方便地展示错误信息。

`Request` 和 `request_ref<T>()`、`request_value<T>()` 则可以基于类型从错误中获取指定的值，是一种获取上下文信息的方式。

## 对错误处理的思考

### 现有规则

对于错误的选择，有以下两条被广泛认同的 guidelines：

- 规则 1：若程序遇到错误时可恢复，则应使用 `Result<T, E>`，尽可能不 `panic!()`。
- 规则 2：对于 library，应使用具体的错误类型，对于 application，可以使用模糊的数据类型，如指 `Box<dyn Error>`。

第 1 条规则毋庸置疑是几乎符合所有情况的。第 2 条规则在实际的开发中，逐渐有了更加具体的版本：对于库，应使用 `thiserror`，对于应用程序，可以使用 `anyhow`。

第 2 条规则或者其衍生版本在大体方向上并没有问题，但是其却没有说明对于库和应用程序，错误分别应具体和模糊到什么程度。

### 应用程序需要使用什么错误

对于应用程序来说，大多数的错误产生于与用户的交互、与底层基础设施的交互中。与用户交互时，对用户输入的数据进行校验可能产生错误，随后执行相应的用例也可能因为不能满足前置条件或者不变性约束而产生错误。与基础设施交互时，产生错误的可能原因则更为多样：网络延迟或错误、数据库访问错误、受到网络攻击等等。

应用程序（特别是 Web 应用后端）的执行路径大体相同，我称其为“唯一 happy path 模式”。顾名思义，程序的执行在宏观上没有分支，程序最终都会执行到同一个终点。同时，程序的执行需要满足一些约束条件，如果其中一个约束条件不能满足，就终止程序的执行。绝大多数情况下，程序虽然可以预见错误的发生，但是没有办法决定做出其他的反应，只能将错误不断向上层传播，最后报告用户、写入日志。典型的例子就是新建用户时用户名重复，即使错误发生后提供多么丰富的上下文信息，程序也不知道应该怎么做才能继续，只能报告用户错误，要求用户更换一个用户名。因此，应用程序中发生的错误不需要携带太多的上下文信息，只需要能够清楚地报告错误发生的原因，用多个字符串就能达到目的。

当然，应用程序的执行还有一些特殊情况。诸如网络请求超时的时候，程序往往选择重试几次而不是直接中断；配置文件缺失时，会转而使用默认配置。这些选择看似不属于唯一 happy path 模式，但从宏观上分析，错误的产生不会使程序进入一个截然不同的路径，判断这些错误也只需要少部分的上下文（如是否应超时、未找到文件而发生错误）就可以做出编程性的选择。

此外，即使是报告错误也会有所不同，比如不同种类的错误写入日志的等级不同、监控系统对不同错误的反应不同等，类似于错误种类这样的信息就比较有用。

所以综合来看，应用程序的错误推荐使用模糊的、基于字符串的错误类型，包装底层错误为抽象的错误，同时在也需要附加一些必要的上下文，以方便进行精细处理。

### 库需要使用什么错误

一般来说，外部库都是处于整个架构的外围层次，被系统的核心部分调用，错误如何处理不能够被确定。所以从层次结构的角度来说，库应当给予调用者尽可能多的自由来决定如何处理错误。

此外，大多数 Rust 库是“小而美”的，它们提供的 API 一般专注于特定功能，彼此正交，也就是基本没有重叠的部分。由此，每个 API 仅可能产生较少种类的错误，相较于应用程序中可能来自于各个源头的大杂烩错误，库的错误能够很好地被处理，不仅限于打印一下错误信息。所以使用一个具体的错误是更好的选择。

但是错误太过具体并不是一件好事。错误也需要封装，将全部细节暴露在外不但对于错误的处理和调试没有帮助，还可能让外部依赖这些细节，为公共 API 的维护带来麻烦。更加推荐的方式是：在公共 API 的边界，将库内部错误进行一层包装，隐藏细节，同时支持访问错误类型或者一些几乎不会变化的数据。

### 错误的分类

众所周知，Rust 中的错误可以分为：

- 可恢复错误：使用 `Result<T, E>` 等类型处理。
- 不可恢复错误：使用 `panic!()` 等方式触发，基本不处理，程序最后终止。

这种分类方式仍然不够健全，我觉得应该进一步分为：

- 可恢复错误：使用 `Result<T, E>` 等类型处理。
  - 报告性错误：能够以友好方式报告错误信息，方便分析和调试。
  - 控制性错误：代码可以结构化处理错误，根据错误携带的信息决定程序执行的路径。
- 不可恢复错误：使用 `panic!()` 等方式触发，基本不处理，程序最后终止。

报告性错误和控制性错误不是互斥的，错误可以同时具有两种性质。应用程序大多返回报告性错误，但也可以借助错误类别等信息达成控制的目的。库应该返回控制性错误，这些错误在大多数情况下也应能够报告错误。

## 对现有方案的分析

### `Box<dyn Error>`

标准库的设施 `Box<dyn Error>` 擦除了具体错误的类型，只剩下一个 trait object，这使得 `Box<dyn Error>` 的用途几乎只剩下显示错误消息。而在实际应用中，这一点功能对于报告和调试没有任何大的帮助，考虑一下面对 `No such file or directory (os error 2)` 错误消息的无力。

### `anyhow`

`anyhow` 通过自己的 `anyhow::Error` 实现了带上下文信息的错误包装功能。一个 `anyhow::Error` 或者其他错误加上一条上下文数据，就可以包装为一个新的 `anyhow::Error`。假如附加的上下文数据是一个更具有描述性的字符串或者其他有用的数据，那么就可以使问题溯源的过程轻松不少。这一定程度上解决了 `Box<dyn Error>` 的问题，使得 `anyhow::Error`足以胜任报告性错误的职责。

但是正如上文所叙述，应用程序有时不仅仅报告错误，更需要进行一些结构化、编程性的处理，`anyhow::Error` 只能接受一条上下文数据，但实际需要的可能是错误消息、错误码、甚至是其他的结构化数据的组合，`anyhow::Error` 就显得捉襟见肘。也就是说，其对于上下文的支持还不够灵活，上下文的使用大多数局限于补充额外的错误消息。

### `thiserror`

`thiserror` 广泛用于各个 Rust crate，其使用过程宏便捷地实现了具体错误类型的定义，包括错误消息的定义、错误的包装，同时也支持在错误中带上额外的字段表示上下文。`thiserror` 的在功能上已经比较完备，同时达到了报告性错误和控制性错误的要求，但是其并没有提供比较方便的 API 来包装已有错误。

考虑以下两个错误：

```rust
#[derive(Error, Debug)]
#[error("inner error")]
pub struct InnerError;

#[derive(Error, Debug)]
pub enum OuterError {
    #[error("{source} with {var1} and {var2}")]
    Inner {
        source: InnerError,
        var1: u32,
        var2: u32,
    }
}
```

从 `InnerError` 构造一个 `OuterError` 就比较麻烦，比如以下代码：

```rust
fn inner_func() -> Result<(), InnerError> {
    Err(InnerError)
}

fn outer_func() -> Result<(), OuterError> {
    let var1 = 1;
    let var2 = 2;
    // Too verbose
    inner_func().map_err(|source| OuterError::Inner { source, var1, var2 })?;
    Ok(())
}
```

可以看到这样一个 `map_err()` 并不够简洁。

### `snafu`

`snafu` 在功能上可以算是 `anyhow` 和 `thiserror` 的结合，既提供了类似 `anyhow::Error` 的 `snafu::Whatever`，又提供了 `Snafu` 过程宏，同时还有一些额外的特性。

对于库中的应用，其在 API 的使用体验上相比 `thiserror` 有所进步，比如上面那个例子可以改写为：

```rust
#[derive(Debug, Snafu)]
#[snafu(display("inner error"))]
pub struct InnerError;

#[derive(Debug, Snafu)]
pub enum OuterError {
    #[snafu(display("{source} with {var1} and {var2}"))]
    Inner {
        source: InnerError,
        var1: u32,
        var2: u32,
    }
}

fn inner_func() -> Result<(), InnerError> {
    Err(InnerError)
}

fn outer_func() -> Result<(), OuterError> {
    let var1 = 1;
    let var2 = 2;
    inner_func().context(InnerSnafu { var1, var2 })?;
    Ok(())
}
```

其显著的优化在于 `InnerSnafu` 这样的 context selector 的使用。

另外，其支持构造模糊错误，考虑以下例子：

```rust
#[derive(Debug, Snafu)]
pub struct Error(ErrorImpl);

// Variants are no longer accessible from outside.
#[derive(Debug, Snafu)]
enum ErrorImpl {
    Cause1,
    Cause2,
    // ...
}
```

对于错误的 newtype，可以直接生成内部方法的代理，并隐藏细节。

在库的错误处理这一方面，可以说 `snafu` 是目前我见过的最优雅的一个。

`snafu` 的一些问题在于 `snafu::Whatever`。其与 `anyhow::Error` 有着相同的问题，除此之外，`snafu::Whatever` 并非 `Send + Sync`，而且在栈上的空间占用太大，如果频繁移动也会有性能影响：

```rust
pub struct Whatever {
    source: Option<Box<dyn std::error::Error>>,
    message: String,
    backtrace: Backtrace,
}
```

## `anyerr` 的尝试

### `anyerr` 的基本介绍

[`anyerr`](https://github.com/oosquare/anyerr) 是我对应用程序中的错误处理的思考的实践成果。`anyerr` 中的核心 `AnyError<C, K>` 是对 `anyhow::Error` 的拓展，除了基本的错误包装、调用堆栈、错误信息报告等功能，还有原生的错误类别、上下文存储支持，并且这些功能都可以定制。

`AnyError<C, K>` 中的 `C` 和 `K` 分别代表上下文的数据结构和错误类别，只要实现了相关的 trait，那么就可以随意替换进去，定义自己的错误类型。

与 `anyhow` 中的不同，`C` 是一个类似于 `HashMap<K, V>` 的数据结构，其中可以足够的上下文信息。当然，如果不想使用这样一个类 `HashMap<K, V>` 的数据结构，还可以选择类 `Option<T>` 的数据结构，或者干脆选择 `NoContext`，不带任何其他上下文信息，也不会占用任何的空间。

`K` 作为错误类别同样可以定制，只要实现了 `ErrorKind` trait。如果不需要错误类别，那么可以选择 `NoErrorKind`，同样不消耗额外的内存空间。

如果只是想要一个与 `anyhow::Error` 功能一样的错误类型，那么就选择 `AnyError<NoContext, NoErrorKind>`。但如果你想要更强大的错误类型，`AnyError` 都可以胜任。

### Echo Server 示例

```rust
// Customize your own error type.
mod err {
    use anyerr::context::LiteralKeyStringMapContext;
    use anyerr::AnyError as AnyErrorTemplate;

    pub use anyerr::kind::NoErrorKind as ErrKind;
    pub use anyerr::Report;
    pub use anyerr::{Intermediate, Overlay};

    pub type AnyError = AnyErrorTemplate<LiteralKeyStringMapContext, ErrKind>;
    pub type AnyResult<T> = Result<T, AnyError>;
}

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::process::Termination;
use std::thread;
use std::time::Duration;

use err::*;

const SERVER_IP: &str = "127.0.0.1";
const SERVER_PORT: &str = "8080";

fn main() -> impl Termination {
    // Captures the result and prints the error if failed.
    Report::capture(|| {
        let listener = TcpListener::bind(format!("{SERVER_IP}:{SERVER_PORT}"))
            .map_err(AnyError::wrap) // Wraps an existing error.
            .overlay("could not bind the listener to the endpoint") // Adds an error message.
            .context("ip", SERVER_IP) // Attaches a key-value pair as context information
            .context("port", SERVER_PORT)?;

        eprintln!("Started listening on {SERVER_IP}:{SERVER_PORT}");

        for connection in listener.incoming() {
            let Ok(stream) = connection else {
                continue;
            };

            thread::spawn(move || {
                handle_connection(stream).unwrap_or_else(|err| {
                    let report = Report::wrap(err).kind(false);
                    eprintln!("{report}"); // Formats the error with a backtrace and contextual data.
                });
            });
        }

        Ok(())
    })
    .kind(false)
}

fn handle_connection(mut stream: TcpStream) -> AnyResult<()> {
    let client_addr = stream
        .peer_addr()
        .map_or("<UNKNOWN>".into(), |addr| addr.to_string());
    let mut buffer = [0u8; 256];
    let mut total_read = 0;

    eprintln!("{client_addr} started the connection");
    thread::sleep(Duration::from_secs(3));

    loop {
        let size_read = stream
            .read(&mut buffer)
            .map_err(AnyError::wrap)
            .overlay("could not read bytes from the client")
            .context("client_addr", &client_addr)
            .context("total_read", total_read)?;
        total_read += size_read;

        if size_read == 0 {
            eprintln!("{client_addr} closed the connection");
            return Ok(());
        }

        thread::sleep(Duration::from_secs(3));

        let mut cursor = 0;
        while cursor < size_read {
            let size_written = stream
                .write(&buffer[cursor..size_read])
                .map_err(AnyError::wrap)
                .overlay("could not write bytes to the client")
                .context("client_addr", &client_addr)
                .context("total_read", total_read)
                .context("cursor", cursor)?;
            cursor += size_written;
        }
    }
}
```

### 案例分析：附加错误码和超时标志

上文提到过应用程序中的错误也要能够携带一定的结构化上下文数据，来支持特定情况下的错误处理。这里我展示如何使用 `anyerr` 来支持在错误中添加错误码和超时标志。

在 echo server 示例中，我们使用的完全是字符串键值对作为上下文的项。现在我们需要方便地直接获取错误码和超时标志，所以我们需要定制上下文数据结构。

首先定义出自己的键，接下来我们会用它来索引上下文数据结构中的值：

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ContextKey {
    ErrorCode,
    Timeout,
    Other(&'static str),
}

impl Display for ContextKey {
    fn fmt(&self, f: &mut Formatter<'_>) -> FmtResult {
        match self {
            Self::ErrorCode => write!(f, "error-code"),
            Self::Timeout => write!(f, "timeout"),
            Self::Other(key) => write!(f, "{key}"),
        }
    }
}
```

由于后续需要使用到错误码和是否超时的标志变量，我们尽可能保留原来的类型，所以上下文数据结构的值应当是 `Box<dyn Any>`（事实上是 `Box<dyn AnyValue + Send + Sync + 'static>`，其中 `AnyValue: Any + Debug`），我们使用 `AnyMapContext<K, KB>` 进行定制：

```rust
mod err {
    use std::fmt::{Display, Formatter, Result as FmtResult};

    use anyerr::context::map::AnyMapContext;
    use anyerr::AnyError as AnyErrorTemplate;

    pub use anyerr::kind::NoErrorKind as ErrKind;

    // ...

    // Our custom context storage.
    type CustomKeyAnyMapContext = AnyMapContext<ContextKey, ContextKey>;

    pub type AnyError = AnyErrorTemplate<CustomKeyAnyMapContext, ErrKind>;
    pub type AnyResult<T> = Result<T, AnyError>;
}
```

接下来展示如何使用：

```rust
use err::*;

fn fails() -> AnyResult<()> {
    let err = AnyError::builder()
        .message("an unknown error occurred")
        .context(ContextKey::ErrorCode, 42u32)
        .context(ContextKey::Timeout, false)
        .context(ContextKey::Other("function"), "fails()")
        .build();
    Err(err)
}

fn main() {
    let err = fails().unwrap_err();

    let error_code: &u32 = err.value_as(&ContextKey::ErrorCode).unwrap();
    let is_timeout: &bool = err.value_as(&ContextKey::Timeout).unwrap();
    let function_name: &&str = err.value_as(&ContextKey::Other("function")).unwrap();

    eprintln!("The error code is {error_code}");
    eprintln!("Whether the function failed due to timeout: {is_timeout}");
    eprintln!("The name of the failed function: {function_name}");
}
```

虽然最后只是简单的打印这些信息，但是上面的这段代码有能力获取到上下文的具体类型，支持更丰富的逻辑。
