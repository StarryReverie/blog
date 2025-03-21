---
title: 无需宏为 Trait Objects 实现 Any
date: 2025-03-17T20:48:11+08:00
draft: false
categories: Tech
tags:
  - Rust
  - Generics
  - Polymorphism
math: false
---

`std::any::Any` 是 Rust 在运行时进行类型擦除和转换的工具，所有 `'static` 类型都实现了 `Any`，因此装箱为 `Box<dyn Any>` 后可以借助 `Any::type_id()` 获取 `TypeId`，还可以通过 `dyn Any` 的 `downcast_*()` 等方法再转换回具体类型。

然而问题也出在 `dyn Any` 的 `downcast_*()` 方法。这些方法是 `dyn Any` 的方法，而不是 `Any` trait 中的方法，所以其他任何 `dyn Trait` 都不会拥有这些方法，即使有 `Trait: Any`。另一方面，由于 trait upcasting 直到最近才成为稳定特性，且还没进入 stable 版本，所以依赖语言支持的 trait upcasting 来转换为 `dyn Any` 对于较早版本的项目并不合适。

因此，本文则通过纯 Rust 语法来扩展 trait object，以实现 `Any` 的所有功能。这些实现都可以在 [`better-as-any`](https://github.com/oosquare/better-as-any) 找到。

## 现有解决方案

### `downcast`

`downcast` crate 通过宏来生成代码，直接为指定的 `dyn Trait` 添加 `is()`、`downcast_*()` 方法。这种做法在最终效果上与 `dyn Any` 完全一样，但是需要使用 `impl_downcast!()` 宏来实现。我个人则偏好能使用语言特性实现就不使用宏。

### `as-any`

这个 crate 不使用宏实现了功能，其中的 `AsAny` 可以把任意类型的引用转换为对 `dyn Any` 的应用，即 trait upcasting。同时其有 `Downcast` trait 可以把引用向下转型为具体类型的引用。

`as-any` 的实现方法有着非常严重的缺陷，这个错误并不明显，而且考虑到 `Any` trait 的应用场景是为了实现动态类型，所以错误会更加难以被发现。

首先是 `AsAny` 的定义及其实现，任何实现了 `Any` 的类型都会实现 `AsAny`：

```rust
pub trait AsAny: Any {
    fn as_any(&self) -> &dyn Any;

    fn as_any_mut(&mut self) -> &mut dyn Any;

    fn type_name(&self) -> &'static str;
}

impl<T: Any> AsAny for T {
    #[inline(always)]
    fn as_any(&self) -> &dyn Any {
        self
    }

    #[inline(always)]
    fn as_any_mut(&mut self) -> &mut dyn Any {
        self
    }

    #[inline(always)]
    fn type_name(&self) -> &'static str {
        core::any::type_name::<T>()
    }
}
```

然后是 `Downcast` trait：

```rust
pub trait Downcast: AsAny {
    #[inline]
    fn is<T>(&self) -> bool
    where
        T: AsAny,
    {
        self.as_any().is::<T>()
    }

    #[inline]
    fn downcast_ref<T>(&self) -> Option<&T>
    where
        T: AsAny,
    {
        self.as_any().downcast_ref()
    }

    #[inline]
    fn downcast_mut<T>(&mut self) -> Option<&mut T>
    where
        T: AsAny,
    {
        self.as_any_mut().downcast_mut()
    }
}

impl<T: ?Sized + AsAny> Downcast for T {}
```

所有实现了 `AsAny` 的类型也会实现 `Downcast`。那么考虑以下代码：

```rust
trait Trait: AsAny {}

impl Trait for i32 {}

let val: Box<dyn Trait> = Box::new(i32);
assert!(val.is<i32>()); // Assertion fails here.
```

`Trait` 继承了 `AsAny`，所以 `dyn Trait` 会实现 `AsAny`，也会实现 `Downcast`，这没有问题。问题在于 `Box<dyn Trait>` 也实现了 `AsAny`，也就实现了 `Downcast`，这种情况下，调用 `val.is<i32>()` 就会选择 `<Box<dyn Trait> as Downcast>::is<i32>()`，而不是先解引用再调用 `<(dyn Trait) as Downcast>::is<i32>()`。

`<Box<dyn Trait> as Downcast>::is<i32>()` 中 `Box<dyn Trait>` 不是 trait object，此处的调用自然不会选择 dynamic dispatch，所以只有 `Box<dyn Trait>` 作为类型参数时才会返回 `true`。

## 更好的解决方案

### 向上转型

首先需要实现向上转型的功能。这里采用与 `as-any` crate 类似的方法，使用一个 `InheritAny` trait：

```rust
pub trait InheritAny: Any + AsAnyRef + AsAnyMut + IntoAnyBox + IntoAnyRc + IntoAnyArc {
    fn type_name(&self) -> &'static str;
}
```

这个 `InheritAny` 继承了 `AsAnyRef`、`AsAnyMut` 等 trait，它们分别定义了各种向上转型的方法，以 `AsAnyRef` 为例：

```rust
pub trait AsAnyRef: Any {
    fn as_any_ref(&self) -> &dyn Any;

    fn as_any_ref_send(&self) -> &(dyn Any + Send)
    where
        Self: Send;

    fn as_any_ref_send_sync(&self) -> &(dyn Any + Send + Sync)
    where
        Self: Send + Sync;
}
```

`AsAnyRef` 不仅支持转型为 `&dyn Any`，还支持 `&(dyn Any + Send)`、`(&dyn Any + Send + Sync)`。其他的 trait 也是类似的。

注意到 `InheritAny` 和其他 trait 都使用了类似以下的 blanket implementation，所以如果在智能指针上直接调用 `as_any_ref()`，返回的引用会指向智能指针，这点无法避免。

```rust
impl<T: Any> InheritAny for T {
    fn type_name(&self) -> &'static str {
        any::type_name::<T>()
    }
}
```

### 向下转型

#### 引用的转型

我们需要对所有的具有所有权的智能指针做特殊处理，通过重借用即先解引用再取引用，再向上转型为 `dyn Any` 的相应类型。所以 `Downcast*` 的实现对象不再是任意的 `T`，而应该是 `T: Deref`。这就导致无法再为任意的 `T` 提供 `Downcast*` 的实现，因为 Rust 目前还没有特化，同时实现会导致冲突，但通常情况下，我们都是通过引用或智能指针等 `impl Deref` 类型访问内部，所以内部是否实现 `Downcast*` 不是非常重要。

以下是 `DowncastRef` 的实现：

```rust
pub trait DowncastRef {
    fn is<T: Any>(&self) -> bool;

    fn downcast_ref<T: Any>(&self) -> Option<&T>;
}

impl<S: Deref<Target: AsAnyRef>> DowncastRef for S {
    #[inline]
    fn is<T: Any>(&self) -> bool {
        (**self).as_any_ref().is::<T>()
    }

    #[inline]
    fn downcast_ref<T: Any>(&self) -> Option<&T> {
        (**self).as_any_ref().downcast_ref::<T>()
    }
}
```

此外还有 `DowncastMut` 和 `Downcast`，分别将可变引用和智能指针向下转型。

#### GAT 的使用

以下是 `Downcast` 的定义：

```rust
pub trait Downcast: Owned + Sized {
    fn downcast<T>(self) -> Result<T::Output, Self>
    where
        T: Applicable<Self, Output = <Self::Family as OwnedFamily>::Owned<T>>;
}
```

`Downcast` 的实现者是各种的智能指针：`Box<T>`、`Rc<T>`、`Arc<T>`，而这些智能指针对转型的目标类型有各自的要求，如 `Arc<T>` 的转型要求 `T` 是 `Send + Sync` 的。（`Arc<T>` 的创建不一定需要 `T: Send + Sync`）。所以 `Downcast::downcast<T>()` 中 `T` 的 trait bound 还会与智能指针 `Self` 有关，这样的 double dispatch 问题就需要再引入一个 `Applicable<O>` trait 来实现。

为了方便表示各种智能指针，首先定义辅助 trait `Owned` 和 `OwnedFamily`，`Owned` 表示一个智能指针及其被包装类型的整体，如 `Box<i32>`，而 `OwnedFamily` 则表示一个智能指针的抽象类别，并利用 GAT 来实现类型函数的功能：

```rust
pub trait Owned {
    type Family: OwnedFamily;
}

pub trait OwnedFamily {
    type Owned<T: ?Sized>: Owned<Family = Self>;
}
```

实现 `Owned`：

```rust
impl<T: ?Sized> Owned for Box<T> {
    type Family = BoxFamily;
}

impl<T: ?Sized> Owned for Rc<T> {
    type Family = RcFamily;
}

impl<T: ?Sized> Owned for Arc<T> {
    type Family = ArcFamily;
}
```

实现 `OwnedFamily`：

```rust
pub struct BoxFamily;

impl OwnedFamily for BoxFamily {
    type Owned<T: ?Sized> = Box<T>;
}

pub struct RcFamily;

impl OwnedFamily for RcFamily {
    type Owned<T: ?Sized> = Rc<T>;
}

pub struct ArcFamily;

impl OwnedFamily for ArcFamily {
    type Owned<T: ?Sized> = Arc<T>;
}
```

通过 GAT，我们就可以利用 `OwnedFamily::Owned<T>` 来表示一个 `_<T>` 的语义，这里 `_` 可以是 `Box`，`Rc` 或 `Arc`。这可以理解为 `Box<_>`、`Rc<_>` 和 `Arc<_>` 是一系列表示智能指针的类型函数（也就是高阶类型，Rust 中并没有办法直接表达），而 `OwnedFamily` 是各种这些智能指针类型函数的统一的接口。只要通过变换 `<S as OwnedFamily>::Owned<T>` 中的 `S` 和 `T`，就可以组合出任意的 `S<T>`。

#### 完成实现

接下来就可以定义 `Applicable<O>` trait 了：

```rust
pub trait Applicable<O>: Any + Sized
where
    O: Owned,
    O::Family: OwnedFamily<Owned<Self> = Self::Output>,
{
    type Output;

    fn apply_downcasting(owned: O) -> Result<Self::Output, O>;
}
```

`Box` 可以这样定义：

```rust
impl<S, T> Applicable<Box<S>> for T
where
    S: IntoAnyBox + ?Sized,
    T: Any,
{
    type Output = Box<T>;

    fn apply_downcasting(owned: Box<S>) -> Result<Self::Output, Box<S>> {
        if owned.is::<T>() {
            let res = owned
                .into_any_box()
                .downcast::<T>()
                .unwrap_or_else(|_| std::unreachable!("`self` should be `Box<T>`"));
            Ok(res)
        } else {
            Err(owned)
        }
    }
}
```

而 `Arc` 可以这样定义，注意 trait bound 的区别：

```rust
impl<S, T> Applicable<Arc<S>> for T
where
    S: IntoAnyArc + Send + Sync + ?Sized,
    T: Any + Send + Sync,
{
    type Output = Arc<T>;

    fn apply_downcasting(owned: Arc<S>) -> Result<Self::Output, Arc<S>> {
        if owned.is::<T>() {
            let res = owned
                .into_any_arc_send_sync()
                .downcast::<T>()
                .unwrap_or_else(|_| std::unreachable!("`self` should be `Arc<T>`"));
            Ok(res)
        } else {
            Err(owned)
        }
    }
}
```

然后只要在 `Downcast` 的实现中调用 `Applicable` 的接口就可以了，至此我们完成了所有的功能。
