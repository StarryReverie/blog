---
title: 光线追踪中的 Multiple Importance Sampling
date: 2025-08-07T09:34:03+08:00
draft: false
categories: Tech
tags:
  - Algorithm
  - Ray Tracing
math: true
---

本文主要介绍多重重要性采样（Multiple Importance Sampling）及其在光线追踪中的典型应用。

## Multiple Importance Sampling

### Monte Carlo Path Tracing

在 Ray Tracing 中，最核心的技术就是 Monte Carlo Estimation。通过使用 Monte Carlo Estimation，我们可以求解 Rendering Equation。对于 Monte Carlo Estimation 来说，一个合适的采样方法可以极大提升收敛的速度，具体来说，对于以下积分及其 Estimator

$$
I = \int_D f(x) \mathrm dx \approx \dfrac{1}{N} \sum_{i = 1}^N \dfrac{f(X_i)}{p(X_i)}
$$

$X_i$ 的最佳的采样分布应该满足 $p(X_i) \propto f(X_i)$。

然而对于 Rendering Equation 来说，这个条件难以满足，因为其被积函数包含了 cosine-weighted BSDF 和 radiance 两部分因子，后者更是需要递归求解的未知项，显然没有办法进行完美的采样。

$$
L_o(x, \omega_o) = L_e(x, \omega_o) + \int_{\Omega^+} f_s(x, \omega_o, \omega_i) L_i(x, \omega_i) (n \cdot \omega_i) \mathrm d\omega_i
$$

一般情况下，我们只能选择让采样分布于其中一部分因子的形状近似，也就产生了两种采样——BSDF 采样（包括了余弦项）和光源采样（光源贡献的 radiance 应该比非直接的更大）。

### Multiple-Sample Model

当存在多种采样方法时，可以将它们结合在一起，每种方法采样若干个样本，最后在用一定的权重进行组合。这就是 MIS 中的 Multiple-Sample Model：

$$
I = \int_D f(x) \mathrm dx \approx \sum_{i = 1}^{m} \dfrac{1}{n_i} \sum_{j = 1}^{n_i} w_i(X_{ij}) \dfrac{f(X_{ij})}{p_i(X_{ij})}
$$

其中 $n_i$ 为使用第 $i$ 种方法采样的个数，$p_i$ 为第 $i$ 种采样方法的 PDF。第 $i$ 种方法得到的 $X_{i1}, X_{i2}, \dots$ 独立同分布（在实际实现中已经满足）。$w_i(X)$ 为权重，需要满足以下条件：

$$
\forall x(f(x) \ne 0), \sum_{i = 1}^m w_i(x) = 1 \\
\forall i, x(p_i(x) = 0), w_i(x) = 0
$$

这些条件可以推出 $\forall x(f(x) \ne 0)$，至少有一种采样方法可以采样到 $x$，也就是所有采样方法的并可以覆盖整个积分区域。

只要满足条件，那么 $I$ 就是无偏的

$$
\begin{aligned}
    \mathbb E(I) & = \mathbb E\left(\sum_{i = 1}^{m} \dfrac{1}{n_i} \sum_{j = 1}^{n_i} w_i(X_{ij}) \dfrac{f(X_{ij})}{p_i(X_{ij})}\right) \\
    & = \sum_{i = 1}^{m} \dfrac{1}{n_i} \sum_{j = 1}^{n_i} \mathbb E\left(w_i(X_{ij}) \dfrac{f(X_{ij})}{p_i(X_{ij})}\right) \\
    & = \sum_{i = 1}^{m} \mathbb E\left(w_i(X_i) \dfrac{f(X_i)}{p_i(X_i)}\right) \\
    & = \sum_{i = 1}^{m} \int_{D} p_i(x) w_i(x) \dfrac{f(x)}{p_i(x)} \mathrm dx \\
    & = \int_{D} \left(\sum_{i = 1}^{m} w_i(x)\right) f(x) \mathrm dx \\
    & = \int_{D} f(x) \mathrm dx
\end{aligned}
$$

实际运用中，$w_i(x)$ 的选择有几种方案：

- 加权平均：$w_i(x)$ 为常数，实际效果不好，以简单平均为例 $w_i(x) = \dfrac{1}{n}, n_i = 1$，最终只能使方差 $\mathbb{D}(I') = \dfrac{1}{n} \mathbb{D}(I)$。
- 划分积分区域：假设积分区域可以划分为不相交的 $\Omega_1, \Omega_2, \dots, \Omega_n$，然后分别采样，最终再把每个区域上的积分相加起来，实际上就是定义权重 $w_i(x) = \mathcal{I}\{x \in \Omega_i\}$。典型的应用就是 Next Event Estimation，其他情况很少见，因为大多数情况没有办法进行这样的划分。
- Balanced Heuristic：$w_i(x) = \dfrac{p_i(x)}{\sum_{k = 1}^n p_k(x)}$，非常优秀的权重分配方式，最优秀的权重分配方式也不会在方差上显著小于 Balanced Heuristic。
- Power Heuristic：$w_i(x) = \dfrac{(p_i(x))^\beta}{\sum_{k = 1}^n (p_k(x))^\beta}$，如果每种采样方式在自己对应理想情况下已经可以达到很低的方差，那么 Power Heuristic 相比 Balanced Heuristic 会强化每种采样方法在理想情况的效果。一般情况下 $\beta = 2$。

MIS 可以应用到几乎各个地方，只要原本的采样空间可以用多个采样分布来覆盖，每个分布在特定空间表现更优，就可以使用 MIS 进行组合。

具体到 Path Tracing 中，对于每一条光线，其到达某表面某点 $x$ 时，就可以使用 cosine-weighted BSDF 采样 $p_1(\omega)$ 和光源采样 $p_2(\omega)$ 分别得到样本 $\omega_{i1}, \omega_{i2}$，然后使用 Balanced Heuristic 分配权重

$$
w_1(\omega_{i1}) = \dfrac{p_1(\omega_{i1})}{p_1(\omega_{i1}) + p_2(\omega_{i1})}
$$

$$
w_2(\omega_{i2}) = \dfrac{p_2(\omega_{i2})}{p_1(\omega_{i2}) + p_2(\omega_{i2})}
$$

然后计算 exitant radiance

$$
\begin{aligned}
    L_o(x, \omega_o) & \approx \dfrac{w_1(\omega_{i1}) f_s(x, \omega_o, \omega_{i1}) L_i(x, \omega_{i1}) (n \cdot \omega_{i1})}{p_1(\omega_{i1})} \\
    & + \dfrac{w_2(\omega_{i2}) f_s(x, \omega_o, \omega_{i2}) L_i(x, \omega_{i2}) (n \cdot \omega_{i2})}{p_2(\omega_{i2})}
\end{aligned}
$$

从理论上来说，这样计算的结果是正确的，但是每一次递归产生的分支数就会倍增，复杂度是指数级的，解决方法可以使用接下来的 Single-Sample Model 或者 Next Event Estimation。

需要注意这里对光源采样的 PDF 形式是 $p_2(\omega)$，也就是说这个 PDF 只有在立体角下才有意义。而光源采样是在光源的表面上进行的，采样的是点 $x'$，其 PDF 是 $p(x')$。

对于顶点在 $x$、指向 $x'$ 的立体角 $\omega$，有

$$
\mathrm d\omega = \dfrac{|n_{x'} \cdot \omega|}{\|x - x'\|^2} \mathrm dA
$$

两者之间需要进行转换：

$$
p_2(\omega) = \dfrac{p(x') \mathrm dA}{\mathrm d\omega} = \dfrac{\|x - x'\|^2}{|n_{x'} \cdot \omega|}p(x')
$$

### Single-Sample Model

对于 Path Tracing 这样需要递归计算的问题，为了防止指数爆炸，Single-Sample Model 可以用于替代 Multiple-Sample Model，每次估计仅随机选择一种采样方法并且仅采样一次。首先固定 $n_1 = n_2 = \cdots = n_m = 1$。记第 $i$ 种估计 $F_i(x) = \dfrac{w_i(x) f(x)}{p_i(x)}$，$F$ 为最终估计，$c_1, c_2, \dots, c_m$ 为选择各种采样方法的概率，则有

$$
\mathbb{P}\left(F(X) = \dfrac{F_i(X)}{c_i}\right) = c_i
$$

定义随机变量 $I$， $\mathbb{P}(I = i) = c_i$，则联合分布 $(I, X)$ 有 PDF

$$
p(i, x) = \mathbb{P}(I = i) p(x \mid I = i) = c_i p_i(x)
$$

前面的 $F(X)$ 就可以更准确地表示为 $F(I, X) = \dfrac{F_I(X)}{c_I}$，计算其期望

$$
\begin{aligned}
    \mathbb{E}(F(I, X)) & = \sum_{i = 1}^m \int_D p(i, x) \dfrac{F_i(x)}{c_i} \mathrm dx \\
    & = \sum_{i = 1}^m \int_D c_i p_i(x) \dfrac{F_i(x)}{c_i} \mathrm dx \\
    & = \sum_{i = 1}^m \int_D w_i(x) f(x) \mathrm dx \\
    & = \int_D \left(\sum_{i = 1}^m w_i(x) \right) f(x) \mathrm dx \\
    & = \int_D f(x) \mathrm dx
\end{aligned}
$$

Single-Sample Model 的 $w_i(x)$ 选择上，Balanced Heuristic 是方差最小的。

在 Multiple-Sample Model 中的 $L_o(x, \omega_o)$ 计算可以修改为随机选择前一项或后一项计算，再除以选择这一项的概率，这样就避免了指数爆炸。

尽管 Single-Sample Model 一次只采样一次，但这并不代表我们对于每个像素只采样一次。每个像素同样有多个光线样本，每个光线计算光照时只采样一个方向，随着 SPP 增多，每个像素的结果也会正确收敛。

## MIS 的应用

其实在上文介绍 MIS 的原理时，已经涉及到了一些基本的应用，下文的应用则是更进一步的结合。

### Next Event Estimation

再次回顾 Rendering Equation，并进行拆分，可以发现 $L_o(x, \omega_o)$ 由三部分组成：自身直接发光、其他点的自身直接发光、光线在其他点的散射

$$
\begin{aligned}
    L_o(x, \omega_o) & = L_e(x, \omega_o) + L_s(x, \omega_o) \\
    & = L_e(x, \omega_o) + \int_{\Omega^+} f_s(x, \omega_o, \omega_i) L_i(x, \omega_i) (n \cdot \omega_i) \mathrm d\omega_i \\
    & = L_e(x, \omega_o) \\
    & + \int_{\Omega^+} f_s(x, \omega_o, \omega_i) L_e(x'_{\omega_i}, -\omega_i) V(x'_{\omega_i}, x) (n \cdot \omega_i) \mathrm d\omega_i \\
    & + \int_{\Omega^+} f_s(x, \omega_o, \omega_i) L_s(x'_{\omega_i}, -\omega_i) (n \cdot \omega_i) \mathrm d\omega_i \\
\end{aligned}
$$

“其他点的自身直接发光”就是直接光照，用第二项表示，“其他点的散射”就是间接光照，用第三项表示。$V(x'_{\omega_i}, x)$ 表示 $x'_{\omega_i}$ 和 $x$ 是否直接可见。此时第二项和第三项可以分开计算。

Next Event Estimation 的思想就是在计算 $L_o(x, \omega_o)$ 时就提前计算其他点 $x'$ 对 $x$ 产生的直接光照 $ L_e(x'_{\omega_i}, -\omega_i)$，而不是在递归计算 $L_i(x, \omega_i) = L_o(x'_{\omega_i}, -\omega_i)$ 才把直接光照加上去。在没有使用 NEE 时，所有的 radiance 的贡献归根结底都只能在光线与发光材料（$L_e > 0$）相交时才能计算，在大多数场景下，光源只是场景中的一小部分，采样不太可能选取光源方向。使用 NEE 后，直接光照计算被独立出来，也就可以仅对光源方向进行采样。而对于间接光照，影响更显著的是 $x$ 处的 BSDF，使用 BSDF 采样计算间接光照则比计算所有光照更加合适。

使用 NEE 的 Path Tracing 则变为：

- 对于每一条光线，其到达表面 $x$ 点时，分别根据 BSDF 和光源采样方向 $\omega_{i1}, \omega_{i2}$。
- $\omega_{i1}$ 方向的光线按照 Path Tracing 的步骤继续递归计算，但是要注意，递归计算的是间接光照，因此下一个交点的 $L_e$ 不能再计入结果。
- $\omega_{i2}$ 方向的光线只需要判断是否与光源上采样的点直接相交，如果相交则加上采样点的 $L_e$。无论是否相交，这个光线都无需递归计算，这样的光线也因此被称为 Shadow Ray。
- 光线的第一个交点处的 $L_e$ 并没有在前一个交点被提前计算（因为并没有前一个交点），需要特殊判断，加入到最终结果中。第一层递归计算的是对像素的所有光照，而不是间接光照。

这个方法与上文描述的 Multiple-Sample Model 的 MIS 非常相似，不同之处在于上文的方法没有划分出直接光照和间接光照，无论是哪一种方法采样得到的方向，都使用相同的 Path Tracing 步骤继续递归计算 $L_o$。而 NEE 因为明确划分了光照的类型，递归计算的是 $L_s$，使用 Shadow Ray 计算的是 $L_e$，两种类型的光线有很大的差别。

那么为什么上文提到 Next Event Estimation 是 MIS 的权重分配的一种方法呢？在实际的场景中，光源是少数。尽管每一种材料都有 $L_e$ 项，但非发光材料的 $L_e$ 项都是 $0$。而在许多实现中，光源是追踪的终点，光源只贡献 $L_e$ 而不贡献 $L_s$，这与非发光材料相反。因此所有的点要么贡献 $L_e$，要么贡献 $L_s$，这本质上就划分了区域，所以把 NEE 视为划分区域的权重分配方法。

### NEE + Balanced Heuristic

朴素的 NEE 能够取得较好的效果有一个前提条件，那就是 BSDF 的形状较为均匀、没有显著的方向性。否则在计算直接光照时，光源采样分布与 BSDF 严重不匹配，NEE 的效果就会大打折扣，最极端的情况就是镜面反射，其 BSDF 是 $\delta$ 函数，光源采样完全失效。一种临时解决方法是对于这一类镜面反射/折射材料，不再使用 NEE，而是使用普通 Path Tracing 计算所有光照。但对于 Microfacet Surface 材料，无论是朴素 NEE 还是 朴素的 Path Tracing 都不是好的方案。

解决的方法在于对直接光照计算使用 MIS，即采样 Shadow Ray 方向时使用 Single-Sample Model + Balanced Heuristic 同时考虑光源采样和 BSDF 采样，这样就可以实现对 BSDF 自适应，降低直接光照的方差。对于镜面反射/折射材料，不使用 MIS，因为对光源采样的权重永远是 $0$。对于间接光照，仍然使用 BSDF 采样。

有的 Shadow Ray 实现中，从一个点发射多条 Shadow Ray，再取每条 Shadow Ray 的平均。根据对 MIS 权重分配的介绍，这种方法实际上是加权平均，较好的情况下，这种方法对于提升效果没有很大作用，方差没有从数量级上减少，运行时间却大幅增加。

以下则介绍 NEE + Balanced Heuristic 在我的 Fractured-Ray Raytracer 中的实现（使用 Rust 编写）。首先是一些基本的 trait 定义，`shade()` 方法用于计算 `intersection` 处向 `ray` 方向的 radiance。

```rust
// src/domain/material/def/material.rs
pub trait Material: Any + Debug + Send + Sync + 'static {
    fn shade(
        &self,
        context: &mut RtContext<'_>,
        state: RtState,
        ray: Ray,
        intersection: RayIntersection,
    ) -> Contribution;
    
    // ...
}

pub trait BsdfMaterial: Material + BsdfSampling {
    fn bsdf(
        &self,
        dir_out: UnitVector,
        intersection: &RayIntersection,
        dir_in: UnitVector,
    ) -> Vector;
}
```

```rust
// src/domain/sampling/coefficient/bsdf.rs
pub trait BsdfSampling: Debug + Send + Sync {
    fn sample_bsdf(
        &self,
        ray: &Ray,
        intersection: &RayIntersection,
        rng: &mut dyn RngCore,
    ) -> BsdfSample;

    fn pdf_bsdf(&self, ray: &Ray, intersection: &RayIntersection, ray_next: &Ray) -> Val;
}
```

对于各种 BSDF 材料，可以定义共同的实现，`shade_light()` 和 `shade_scattering()` 分别用于计算直接光照和间接光照：

```rust
// src/domain/material/def/ext.rs
pub trait BsdfMaterialExt: BsdfMaterial {
    fn shade_light(
        &self,
        context: &mut RtContext<'_>,
        ray: &Ray,
        intersection: &RayIntersection,
    ) -> Contribution {
        const SAMPLE_LIGHT_PROB: Val = Val(0.5);
        // Single-Sample Model MIS
        if Val(context.rng().random()) <= SAMPLE_LIGHT_PROB {
            let radiance = self.shade_light_using_light_sampling(context, ray, intersection);
            radiance * SAMPLE_LIGHT_PROB.recip()
        } else {
            let radiance = self.shade_light_using_bsdf_sampling(context, ray, intersection);
            radiance * (Val(1.0) - SAMPLE_LIGHT_PROB).recip()
        }
    }

    fn shade_scattering(
        &self,
        context: &mut RtContext<'_>,
        state_next: RtState,
        ray: &Ray,
        intersection: &RayIntersection,
    ) -> Contribution {
        let renderer = context.renderer();

        // Sample from BSDF
        let sample = self.sample_bsdf(ray, intersection, *context.rng());
        if sample.pdf() == Val(0.0) {
            return Contribution::new();
        }

        // coefficient = bsdf * cos / pdf
        let coefficient = sample.coefficient();
        let ray_next = sample.into_ray_next();
        let radiance = renderer.trace(context, state_next, ray_next, DisRange::positive());
        coefficient * radiance
    }

    // ...
}
```

如果是从光源采样来计算直接光照，则需要测试与光源的可见性，如果可见，则计算光照和权重：

```rust
// src/domain/material/def/ext.rs
pub trait BsdfMaterialExt: BsdfMaterial {
    fn shade_light_using_light_sampling(
        &self,
        context: &mut RtContext<'_>,
        ray: &Ray,
        intersection: &RayIntersection,
    ) -> Contribution {
        let scene = context.scene();
        let lights = scene.get_lights();

        // Sample from a light source
        let res = lights.sample_light(intersection, *context.rng());
        let Some(sample) = res else {
            return Contribution::new();
        };
        if sample.pdf() == Val(0.0) {
            return Contribution::new();
        }

        // Test light source visibility
        let (ray_next, distance) = (sample.ray_next(), sample.distance());
        let range = (Bound::Excluded(Val(0.0)), Bound::Included(distance));
        let res = scene.test_intersection(ray_next, range.into(), sample.shape_id());
        let (intersection_next, light) = if let Some((intersection_next, id)) = res {
            let id = id.material_id();
            let material = scene.get_entities().get_material(id).unwrap();
            if material.kind() == MaterialKind::Emissive {
                (intersection_next, material)
            } else {
                return Contribution::new();
            }
        } else {
            return Contribution::new();
        };

        // Balanced Heuristic
        let pdf_light = sample.pdf();
        let pdf_bsdf = self.pdf_bsdf(ray, intersection, ray_next);
        let weight = pdf_light / (pdf_light + pdf_bsdf);

        let bsdf = self.bsdf(-ray.direction(), intersection, ray_next.direction());
        let cos = intersection.normal().dot(ray_next.direction());
        let coefficient = bsdf * cos / pdf_light;

        let ray_next = sample.into_ray_next();
        // No more recursion here
        let radiance = light.shade(context, RtState::new(), ray_next, intersection_next);
        weight * coefficient * radiance
    }

    // ...
}
```

如果是从 BSDF 采样直接光照方向，则在确定方向后寻找最近交点，并判断是否是光源：

```rust
// src/domain/material/def/ext.rs
pub trait BsdfMaterialExt: BsdfMaterial {
    fn shade_light_using_bsdf_sampling(
        &self,
        context: &mut RtContext<'_>,
        ray: &Ray,
        intersection: &RayIntersection,
    ) -> Contribution {
        let scene = context.scene();
        let lights = scene.get_lights();

        // Sample direction from BSDF
        let sample = self.sample_bsdf(ray, intersection, *context.rng());
        if sample.pdf() == Val(0.0) {
            return Contribution::new();
        }

        // Find intersection and check if it is a light source
        let ray_next = sample.ray_next();
        let res = scene.find_intersection(ray_next, DisRange::positive());
        let (intersection_next, light) = if let Some((intersection_next, id)) = res {
            let id = id.material_id();
            let material = scene.get_entities().get_material(id).unwrap();
            if material.kind() == MaterialKind::Emissive {
                (intersection_next, material)
            } else {
                return Contribution::new();
            }
        } else {
            return Contribution::new();
        };

        // Balanced Heuristic
        let pdf_bsdf = sample.pdf();
        let pdf_light = lights.pdf_light(intersection, ray_next);
        let weight = pdf_bsdf / (pdf_light + pdf_bsdf);

        let coefficient = sample.coefficient();
        let ray_next = sample.into_ray_next();
        // No more recursion here
        let radiance = light.shade(context, RtState::new(), ray_next, intersection_next);
        weight * coefficient * radiance
    }

    // ...
}
```

最后对于各种材料，添加实现（以 `Glossy` 为例）：

```rust
impl Material for Glossy {
    fn shade(
        &self,
        context: &mut RtContext<'_>,
        state: RtState,
        ray: Ray,
        intersection: RayIntersection,
    ) -> Contribution {
        let light = self.shade_light(context, &ray, &intersection);
        // With `skip_emissive == true`, no radiance would be added if the
        // next ray intersects a light source (`Emissive` material)
        let state_next = state.with_skip_emissive(true);
        let mut res = self.shade_scattering(context, state_next, &ray, &intersection);
        res.add_light(light.light());
        res
    }

    // ...
}
```

## 参考文献

- <https://graphics.stanford.edu/courses/cs348b-03/papers/veach-chapter9.pdf>
- <https://www.cg.tuwien.ac.at/sites/default/files/course/4411/attachments/08_next%20event%20estimation.pdf>
