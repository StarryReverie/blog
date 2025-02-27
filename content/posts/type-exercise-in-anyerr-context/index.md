---
title: anyerr 上下文中的类型体操
date: 2025-02-27T10:27:45+08:00
draft: false
categories: Tech
tags:
  - Rust
  - Generics
  - Project
math: false
---

在[对 Rust 错误处理的思考和 anyerr](/posts/thoughts-on-error-handling-in-rust-and-anyerr/)一文中，我介绍了 [`anyerr`](https://github.com/oosquare/anyerr) 这一个错误处理库，其可以携带上下文信息，且储存上下文的数据结构是可定制的。本文则聚焦 `anyerr` 是如何实现这样的特性的。

## 上下文的核心特性

### 基本结构和表示

在设计之前，首先我们要明确需求。什么样的上下文数据结构是我们所需要的？携带上下文是为了能够记录某些变量所保存的值，我们需要记录变量的名称和其中的值。上下文可以有很多种类，但所有的上下文都可以表示为一个键值映射表。

所以以下是我们对一个上下文储存的基本特性的定义：

```rust
pub trait AbstractContext: Default + Debug + Send + Sync + 'static {
    type Key;

    type Value;

    type Entry: Entry<Key = Self::Key, Value = Self::Value>;

    type Iter<'a>: Iter<'a, Entry = Self::Entry>
    where
        Self: 'a;

    fn iter(&self) -> Self::Iter<'_>;
}
```

这样的一个 trait 定义仅仅规定了一个上下文的键值对类型和迭代其中元素的方法，却没有插入或者其他查询的方法。这是因为一个上下文不一定需要真的携带有信息，如果不需要上下文，那么一个不带有任何信息的上下文就可以非常好地适用于这种场景，这也是为什么这个 trait 叫做 `AbstractContext`。`anyerr` 针对这样的情况有特殊的优化，这些后面再说。

### 上下文的元素

`AbstractContext::Entry` 规定了上下文中每一个元素的类型，其应当实现 `Entry` trait。以下则是 `Entry` 的定义：

```rust
pub trait Entry: Debug + Send + Sync + 'static {
    type Key: Borrow<Self::KeyBorrowed> + Debug + Send + Sync + 'static;

    type KeyBorrowed: Debug + Display + Eq + Hash + ?Sized + Send + Sync + 'static;

    type Value: Borrow<Self::ValueBorrowed> + Debug + Send + Sync + 'static;

    type ValueBorrowed: Debug + ?Sized + Send + Sync + 'static;

    fn new<Q, R>(key: Q, value: R) -> Self
    where
        Q: Into<Self::Key>,
        R: Into<Self::Value>;

    fn key(&self) -> &Self::KeyBorrowed;

    fn value(&self) -> &Self::ValueBorrowed;
}
```

`Entry` trait 具体规定了键和值的类型以及创建和访问的方法。在 `AbstractContext` 中，还要将 `AbstractContext::Key`、`AbstractContext::Value` 和 `Entry::Key`、`Entry::Value` 匹配。

`AbstractContext` 定义了 `Entry`，而不是直接使用 `(K, V)` 这样的二元组作为元素。这样的决定还是出于封装和扩展性的考虑。不同的上下文可以有自己的实现和优化，比如对于 `(String, String)` 的情况，完全可以将两个 `String` 拼接在一起，并记录分界点（尽管由于需要特化的原因，实现起来有困难，实际上并没有使用），访问时则用 `&str`。前者需要 6 word，后者只需要 4 word。

一个 `Entry` 以 `Entry::Key` 和 `Entry::Value` 作为内部储存的值，对外则以 `Entry::KeyBorrowed` 和 `Entry::ValueBorrowed` 的方式提供访问。这样的设计同样增加了灵活性。首先来看标准库提供的 `Borrow` trait：

```rust
pub trait Borrow<Borrowed: ?Sized> {
    fn borrow(&self) -> &Borrowed;
}
```

如果 `T: Borrowed<TB>`，那么 `T` 就可以被借用为 `TB`，如果某些地方接受 `&TB`，而我们拥有 `&T`，就可以用 `Borrow` trait 进行转换。

在 Rust 中存在有 DST，如 `str`、`[T]`，同时这些 DST 有一些对应的所有权类型，如 `String`、`Vec<T>` 等。许多情况下，我们持有一个所有权类型，但我们却不一定需要所有权类型的功能，而是需要其中包装的类型的功能。比如判断一个 `s: String` 的值是不是 `"hello world"`，我们不需要把 `s` 与 `String::from("hello world")` 进行比较，而是从 `s` 中直接取出内部的 `str` 与 `"hello world"` 比较。标准库中的典型例子就是 `HashMap<K, V>` 的 `get()` 方法：

```rust
impl<K, V> HashMap<K, V> {
    pub fn get<Q>(&self, k: &Q) -> Option<&V>
    where
        K: Borrow<Q>,
        Q: Hash + Eq + ?Sized
    {
        // ...
    }
}
```

如果 `K` 是 `String`，那么 `Q` 可以是 `String`，也可以是 `str`，因为 `String: Borrow<String> + Borrow<str>`，`String` 都可以通过 `borrow()` 转换为对应类型，然后按照 `Q` 上的 `Eq` 进行比较。

所以在 `Entry` trait 中，`Key` 和 `Value` 的 trait bounds 分别有 `Borrow<Self::KeyBorrowed>` 和 `Borrow<Self::ValueBorrowed>`，对应的 getter `key()` 和 `value()` 都返回被借用类型的引用。

### 上下文的迭代

迭代器是访问上下文的通用方法，上下文的迭代器实现 `Iter` trait：

```rust
pub trait Iter<'a>: Default + Iterator<Item = &'a Self::Entry> {
    type Entry: 'a;

    fn compose(self, other: Self) -> Self;
}
```

上下文被设计为元素插入后不可变，所以迭代器也只提供对元素的引用的访问，所以加上 `Iterator<Item = &'a Self::Entry>` 的 trait bound。

此外 `Iter::compose()` 方法用于组合两个迭代器。在 `anyerr` 中，错误可以多层包装嵌套，因此就会有多个上下文，这个方法则可以提供对所有上下文中的元素的访问。虽然 `Iterator::chain()` 也提供了类似的功能，但其返回一个完全不同的迭代器，这会给我们的实现带来麻烦，所以 `Iter::compose()` 要求返回与自身相同的类型。

在 `AbstractContext` 中，对应的关联类型需要是一个 GAT，这样才可以表达 `Iter` trait 中的生命周期参数。

```rust
pub trait AbstractContext: Default + Debug + Send + Sync + 'static {
    type Iter<'a>: Iter<'a, Entry = Self::Entry>
    where
        Self: 'a;
    
    // ...
}
```

## 不同类别上下文的设计

### 无上下文

这是最简单的一种上下文，其中没有储存任何元素。定义 `NoContext` trait：

```rust
pub trait NoContext: AbstractContext {}
```

其实这样的一个 trait 只是一个 marker，甚至在实际的应用中，这样的 marker 也是不必要的，设计它只是为了整个类型体系的完整性考虑。

重点在于 `NoContext` 的实现 `UnitContext`：

```rust
#[derive(Debug)]
pub struct UnitContext;
```

`UnitContext` 等价于一个 `()` 类型，同时也是一个 ZST，占用空间为 0，因此在不需要上下文时，选用 `UnitContext` 就无需消耗额外的空间，符合零开销抽象原则。

`UnitContext::Key` 和 `UnitContext::Value` 都是 `Dummy`，`UnitContext::Entry` 是 `DummyEntry`，而这些类型都是等价于 `!` 类型，即 never 类型。`Dummy` 和 `DummyEntry` 都是没有枚举项的枚举，根据代数数据类型的理论，枚举作为和类型，没有枚举项意味着值的个数为 0，所以 `Dummy` 和 `DummyEntry` 都是无法构造的。所以有：

```rust
#[derive(Debug, PartialEq, Eq, Hash)]
pub enum Dummy {}

impl Display for Dummy {
    fn fmt(&self, f: &mut Formatter<'_>) -> FmtResult {
        write!(f, "{self:?}")
    }
}

#[derive(Debug)]
pub enum DummyEntry {}

impl Entry for DummyEntry {
    type Key = Dummy;

    type KeyBorrowed = Dummy;

    type Value = Dummy;

    type ValueBorrowed = Dummy;

    fn new<Q, V>(_key: Q, _value: V) -> Self
    where
        Q: Into<Self::Key>,
        V: Into<Self::Value>,
    {
        unreachable!("`_key` and `_value` are instances of the `Dummy` type, which is uninhabited")
    }

    fn key(&self) -> &Self::KeyBorrowed {
        unreachable!("`_key` and `_value` are instances of the `Dummy` type, which is uninhabited")
    }

    fn value(&self) -> &Self::ValueBorrowed {
        unreachable!("`_key` and `_value` are instances of the `Dummy` type, which is uninhabited")
    }
}
```

`UnitContext` 的迭代器是 `UnitIter`。因为 `UnitContext` 不可能有元素，`UnitIter::next()` 只需要永远返回 `None` 即可。

### 可插入上下文

与 `NoContext` 相反，`Context` trait 表示了可插入元素的上下文，这是一般情况下常用的上下文类型。

```rust
pub trait Context: AbstractContext {
    type Converter: Converter;

    fn insert<Q, R>(&mut self, key: Q, value: R)
    where
        Q: Into<Self::Key>,
        R: Into<Self::Value>;

    fn insert_with<C, Q, R>(&mut self, key: Q, value: R)
    where
        Q: Into<Self::Key>,
        C: Converter,
        R: Convertable<C, Self::Value>,
    {
        self.insert(key, value.to());
    }

    fn get<Q>(&self, key: &Q) -> Option<&<Self::Entry as Entry>::ValueBorrowed>
    where
        <Self::Entry as Entry>::KeyBorrowed: Borrow<Q>,
        Q: Debug + Eq + Hash + ?Sized;
}
```

相比 `AbstractContext`，`Context` 增加了插入方法 `insert()`、`insert_with()` 和查询方法 `get()`。`insert()` 的签名十分显然，`get()` 也是仿照 `HashMap` 的设计。`Context` 的特色之处在于 `Converter` 关联类型和 `insert_with()` 方法。

事实上，`Context` 只是一个基本的设计，许多实际的上下文有不同的功能，所以可能会接受不同种类的参数并将这些参数以某种方式进行转换。每个 `Context` 所需要的转换方式不同，有的可能是格式化为字符串、有的可能是擦除类型转换为 trait object。标准库虽然提供了 `From<T>` 和 `Into<T>` trait 来完成类型转换，但是 `Into<T>` 只能定义一种转换方式，从 `S` 转换为 `T` 却可能需要多种实现。

所以我们首先定义 `Converter` trait，表示某种转换的方式。`anyerr` 中，目前有三种具体 `Converter`。

```rust
pub trait Converter: Debug + Send + Sync + 'static {}

#[derive(Debug)]
pub struct DebugConverter;

impl Converter for DebugConverter {}

#[derive(Debug)]
pub struct IntoConverter;

impl Converter for IntoConverter {}

#[derive(Debug)]
pub struct BoxConverter;

impl Converter for BoxConverter {}
```

随后再定义 `Convertible` trait，其真正地实现了类型的转换：

```rust
pub trait Convertable<C: Converter, T>: Sized {
    fn to(self) -> T;
}

impl<S: Debug, T: From<String>> Convertable<DebugConverter, T> for S {
    fn to(self) -> T {
        format!("{self:?}").into()
    }
}

impl<S: Into<T>, T> Convertable<IntoConverter, T> for S {
    fn to(self) -> T {
        self.into()
    }
}

impl<S, T> Convertable<BoxConverter, T> for S
where
    S: AnyValue,
    T: From<Box<dyn AnyValue + Send + Sync + 'static>>,
{
    fn to(self) -> T {
        let res: Box<dyn AnyValue + Send + Sync + 'static> = Box::new(self);
        res.into()
    }
}
```

`C: Converter` 作为一个 tag，区分从 `Self` 到 `T` 的转换方式，`Convertable::to()` 则实现转换。

这样就实现了以下的多种转换：

```rust
assert_eq!(<_ as Convertable<DebugConverter, String>>::to("str"), "\"str\"");
assert_eq!(<_ as Convertable<IntoConverter, String>>::to("str"), String::from("str"));
```

通过 `Convertiable`，就可以把 `Context::insert_with()` 中 `value` 的类型选择推迟到其实现阶段，由实现提供的 `Converter` 和 `AbstractContext::Value` 决定。

`Context` trait 中还有 `Converter` 关联类型，要求实现 `Converter` trait，其指定了 `Context` 的默认转换方式。

### 单元素上下文

如果上下文最多只需要一个元素，那么就可以使用 `SingletonContext`：

```rust
pub trait SingletonContext: Context {
    fn value(&self) -> Option<&<Self::Entry as Entry>::ValueBorrowed>;
}
```

`SingletonContext::value()` 支持访问储存的唯一的元素，而不必指定键。

`SingletonContext` 的实现为 `OptionContext<E: Entry>`，同时有类型别名 `StringSingletonContext`、`AnySingletonContext`、`FixedSingletonContext<T>`，分别表示元素类型为 `String`、`Box<DynAnyValue>`、`T` 的 `SingletonContext`。

### 字符串上下文

字符串上下文的值都是字符串。以下是 `StringContext` 的定义：

```rust
pub trait StringContext
where
    Self: Context<Value = String, Entry: Entry<ValueBorrowed = str>>,
{
}
```

可以发现 `StringContext` 其实只是规定了实现类型的 `Value` 和 `ValueBorrowed`。

`StringContext` 的实现类型基于 `MapContext<E: Entry, C: Converter>` 进行定制。首先定义出别名 `StringMapContext<K, KB>` 为 `MapContext<MapEntry<K, KB, String, str>, DebugConverter>`，并为其实现 `StringContext` trait，再进一步定义别名 `StringKeyStringMapContext`、`LiteralKeyStringMapContext`，分别表示 `K` 为 `String` 和 `&'static str` 的 `StringMapContext<K, KB>`。

因为 `StringMapContext<K, KB>` 中使用了 `DebugConverter`，所以任何实现了 `Debug` trait 的类型都可以作为值插入其中，实质是插入前先转换为 `String`。

### 类型擦除上下文

类型擦除上下文的值都被擦除了具体的类型，用 `Box<DynAnyValue>` 即 `Box<dyn AnyValue + Send + Sync + 'static` 表示。`AnyValue` trait 是增强的 `Any` trait，其定义如下：

```rust
pub trait AnyValue: Any + Debug + Send + Sync + 'static {
  fn as_any(&self) -> &dyn Any;
}

pub type DynAnyValue = dyn AnyValue + Send + Sync + 'static;

impl<T> AnyValue for T
where
    T: Any + Debug + Send + Sync,
{
  fn as_any(&self) -> &dyn Any {
    self
    }
}

impl dyn AnyValue + Send + Sync + 'static {
  pub fn is<T: Any>(&self) -> bool {
    self.as_any().is::<T>()
    }

    pub fn downcast_ref<T: Any>(&self) -> Option<&T> {
        self.as_any().downcast_ref::<T>()
    }
}
```

有了 `AnyValue`，我们就可以真正储存任意类型，同时有办法打印其中元素。由此就可以得到 `AnyContext` 的定义：

```rust
pub trait AnyContext
where
    Self: Context<Value = Box<DynAnyValue>, Entry: Entry<ValueBorrowed = DynAnyValue>>,
{
    fn value_as<T, Q>(&self, key: &Q) -> Option<&T>
    where
        <Self::Entry as Entry>::KeyBorrowed: Borrow<Q>,
        Q: Debug + Eq + Hash + ?Sized,
        T: Any,
    {
        self.get(key).and_then(|value| value.downcast_ref::<T>())
    }
}
```

`AnyContext` 规定了 `Value` 的值，同时提供了一个访问元素并转换类型的方法 `value_as()`。

与 `StringContext` 类似，`AnyContext` 的实现类型有 `AnyMapContext<K, KB>`、`StringKeyAnyMapContext`、`LiteralKeyAnyMapContext`。它们都使用 `BoxConverter`，所以插入时可以直接传入具体类型，然后就会被自动装箱并擦除类型。

## 一些细节

`anyerr` 的核心类型 `AnyError<C, K>` 也根据 `C` 实现的 trait 而做了具体的处理，将各上下文 trait 的方法进行了包装，所以可以直接通过 `AnyError<C, K>` 访问其携带的上下文的信息。
