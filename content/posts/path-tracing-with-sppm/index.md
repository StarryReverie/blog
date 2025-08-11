---
title: 结合 SPPM 的 Path Tracing
date: 2025-08-10T19:55:17+08:00
draft: false
categories: Tech
tags:
  - Algorithm
  - Ray Tracing
math: true
---

随机渐进式光子映射（Stochastic Progressive Photon Mapping, SPPM）是光子映射系列算法的进阶算法，本文介绍如何实现 SPPM 以及如何将 SPPM 与路径追踪（Path Tracing, PT）结合。

## 光子映射系列算法

### 光子映射

光子映射（Photon Mapping, PM）是光子映射系列算法中的初代算法，是一个两阶段算法，包括光子追踪和光子映射。其思想就是首先从光源发射光子，光子在场景中不断反弹，模拟现实世界的过程，然后再使用 Path Tracing，过程中在合适的地方使用光子来估计 radiance，加速渲染。

#### 光子的发射

光子是光源的通量/功率的载体，光源实质上是通过发射光子来实现照明。PM 中的光子与物理中的光子不同，物理学中的光子是光能传递的最小单元，即量子化的性质，单个光子的能量是 $E = h\nu$，而 PM 中的光子实际上是一堆物理中的光子，是更符合应用的模型。所以，接下来所讨论的光子都是 PM 意义下的光子。

如何计算单个光子的通量呢？发射光子的过程实际上就类似于对光源的总通量进行 Monte Carlo 估计的过程，每个光子都是一个样本，每一份通量相加就得到了总通量。所以我们就对光源表面和出射方向进行采样，按照类似的过程计算每一个光子的通量。总通量按照以下积分计算

$$
\begin{aligned}
    \Phi & = \int_M \int_{\Omega^+} L_e(x, \omega) (n \cdot \omega) \mathrm d\omega \mathrm dA \\
    & \approx \dfrac{1}{N} \sum_{i = 1}^N \dfrac{L_e(x, \omega) (n \cdot \omega)}{p(x)p(\omega)}
\end{aligned}
$$

所以单个光子的通量就是 $\dfrac{1}{N} \dfrac{L_e(x, \omega) (n \cdot \omega)}{p(x)p(\omega)}$，$N$ 表示被发射光子的总数。严格意义上来说，通量的定义是不考虑立体角和照明面积的，所以所谓的单个光子的通量实际上是通量的二阶差分 $\Delta^2 \Phi$。在实际实现中，我们在计算通量时并不会除以 $N$，这是因为在 SPPM 中光子数量会随着迭代次数增加而增加，因此我们也将其 $\dfrac{L_e(x, \omega) (n \cdot \omega)}{p(x)p(\omega)}$ 视为一种没有放缩的通量，直到最后再除以 $N$ 得到真正的通量。

虽然光子可以携带任意的通量，但是为了后续算法的实际效果，应当尽可能平衡每个光子的通量。对于单个光源来说，假设 $L_e$ 处处相等，则要在表面上均匀采样发射点，在半球空间内按余弦权重采样方向。对于多个光源，首先以 $L_e A$ 为权重选择光源，再在被选光源内按照单个光源的方法来采样，还需要对通量进行缩放。

#### 光子追踪阶段

对于每个发射的光子，不断找其与场景的交点，在交点处继续反弹。在合适的交点处，将交点信息继续储存。

假设一个光子到达交点 $x$，方向为 $\omega_o$，则我们需要继续按照 BSDF 采样其下一个方向 $\omega_i$。假设当前的通量为 $\Phi$，则反弹后的通量为
$$
\Phi' = \dfrac{f_s^*(x, \omega_o \to \omega_i) (n_x \cdot \omega_i)}{p(\omega_i)} \Phi
$$
在这里，使用的是伴随 BSDF $f_s^*(x, \omega_o \to \omega_i)$，余弦项是法向量 $n_x$ 与下一个方向 $\omega_i$ 的夹角余弦。在 Path Tracing 中，$\omega_i$ 是真正的入射方向，而在 PM 中，$\omega_i$ 却是光线的出射方向，这在一开始看上去很奇怪，原因在于上式中的这个比例系数是重要性的吞吐量，与 Path Tracing 中的辐射亮度的吞吐量不同。重要性是与辐射亮度具有类似性质的量，传播方向上是相反的。关于重要性，相关内容在下文阐述。总之，对于这个式子，通俗的理解就是光子在撞击表面后发生散射就会发生能量上的变化，正如散射后的光线与散射前的光线之间的关系一样。

光子撞击表面后，除了散射到其他方向，也有可能被表面吸收。使用 $\delta$ 表示吸收的概率，使用 Russia Roulette 来决定光子是被吸收还是继续散射，因此上面的公式要进一步修改为
$$
\Phi' = \dfrac{1}{1 - \delta} \dfrac{f_s^*(x, \omega_o \to \omega_i) (n_x \cdot \omega_i)}{p(\omega_i)} \Phi
$$
关于 $\delta$ 的选择，可以选择一个常数，也可以按照当前通量 $\Phi=(\Phi_r, \Phi_g, \Phi_b)$ 中的最大分量决定（不能大于 $1$），甚至可以结合 BSDF 等系数确定，以使散射后的通量尽量不变。前面提到过平衡的通量的效果更好，所以后两种方法是更好的选择，可以避免多次散射后的通量太小。

在光子追踪阶段，还需要记录下光子与表面的交互信息，为后续的光子映射阶段提供辐射亮度估计的基础。交互信息包括入射位置、方向以及当前的通量大小，相当于预先计算出来的 Path Tracing 过程中后半段光线路径的相关信息。

理论上，所有的表面都可以储存光子信息，但是由于不同材料的 BSDF 的形状不同，光子的可用率也会有很大的差异。对于漫反射表面，所有的入射光线都可以为出射光线的辐射亮度提供贡献，因此漫反射材料上的光子是全部可以利用的。而对于镜面表面，BSDF 为 $\delta$ 函数，所有的光子都不可用，在这种情况下，即使储存再多的光子，对于不相关的方向也是无用，反而会浪费性能。因此一般的选择都是仅在漫反射表面储存。

在发射完所有的光子后，储存的光子组成一个光子图，一般用 KD-Tree 维护，以实现快速的空间近邻查询。

#### 光子映射阶段

光子映射就是用储存的光子信息来估计辐射亮度，避免了递归求解。回顾 Rendering Equation
$$
L_o(x, \omega_o) = L_e(x, \omega_o) + \int_{\Omega} f_s(x, \omega_i \to \omega_o) L_i(x, \omega_i) (n_x \cdot \omega_i) \mathrm d\omega_i
$$
Path Tracing 通过递归追踪 $\omega_i$ 方向的光线来求解 $L_i(x, \omega_i)$。PM 则不一样，因为已经有储存的光子信息，由光子的通量和方向以及当前位置的信息，可以轻松算出辐射亮度 $L_i$，所以效率可以大幅提高。但当前位置 $x$ 不一定有光子曾经到达过，PM 选择使用 $x$ 附近的一部分光子来做近似。我们考虑 $x$ 所在的面积微元 $\mathrm dA$，用到达位置在 $\mathrm dA$ 内的光子 $(x_p, \omega_i, \Phi(x_p, \omega_i))$ 的辐射亮度来近似 $L_i(x, \omega_i)$：
$$
L_i(x, \omega_i) = \dfrac{\mathrm d^2 \Phi(x, \omega_i)}{\mathrm d\omega_i \mathrm dA (n_x \cdot \omega_i)} \approx \dfrac{\mathrm d^2 \Phi(x_p, \omega_i)}{\mathrm d\omega_i \mathrm dA (n_x \cdot \omega_i)}
$$
代入到 Rendering Equation 后，得到
$$
\begin{aligned}
    L_o(x, \omega_o) & = L_e(x, \omega_o) + \int_{\Omega} f_s(x, \omega_i \to \omega_o) L_i(x, \omega_i) (n_x \cdot \omega_i) \mathrm d\omega_i \\
    & = L_e(x, \omega_o) + \int_{\Omega} f_s(x, \omega_i \to \omega_o) \dfrac{\mathrm d^2 \Phi(x, \omega_i)}{\mathrm d\omega_i \mathrm dA (n_x \cdot \omega_i)} (n_x \cdot \omega_i) \mathrm d\omega_i \\
    & = L_e(x, \omega_o) + \int_{\Omega} f_s(x, \omega_i \to \omega_o) \dfrac{\mathrm d^2 \Phi(x, \omega_i)}{\mathrm dA} \\
    & \approx L_e(x, \omega_o) + \sum_{i = 1}^k f_s(x, \omega_i \to \omega_o) \dfrac{\Delta^2 \Phi(x_p, \omega_i)}{\Delta A}
\end{aligned}
$$
由此我们得到了辐射亮度估计的公式，完全可以利用储存的光子信息来计算。在这里，$k$ 和 $\Delta A$ 都可以用于控制选择 $x$ 附近的哪些光子用于估计，两者只要确定其一，就可以推出另外一个，由此得到两种方案。

第一种是给定 $k$，即 $k$-NN 方法，选择 $x$ 附近的 $k$ 个位置最近的光子进行估计，$\Delta A$ 就是包围这 $k$ 个位置的最小圆，即 $\Delta A = \pi r_m^2$，其中 $r_m = \min\{\|x - x_p\|\}$。要实现 $k$-NN，只要用 KD-Tree 和大根堆就可以完成，时间复杂度为 $O(N^{2/3}\log_2 k)$。这一种方案的好处是 $\Delta A$ 的范围是自适应调节的，如果一个地方光子很密集，则无需使用太大的范围进行估计，反之则可以自动扩大估计范围。

第二种是给定 $\Delta A$，或者说是给定最大搜索半径 $r_m$，选择在 $x$ 为中心的球内进行估计，$k$ 就是在范围内的光子数。算法上的实现比 $k$-NN 更简单，时间复杂度为 $O(N^{2/3})$。这一种方案的好处是性能比 $k$-NN 更高，且因为搜索半径可调，更适合 PPM、SPPM。

#### Measurement Equation 与辐射亮度估计

从实现角度来说，以上内容以及完全足够，但从根本原理上来看，这些内容仅仅是一种较形象化的表述。PM 的本质，应该从 Measurement Equation 来介绍。Measurement Equation 描述了测量的方法，各种量都可以表示为 Measurement Equation 的一种具体形式
$$
I = \int_{S} \mathrm dA \int_{\Omega} W(p, \omega_i) L_i(p, \omega_i) (n_p \cdot \omega_i) \mathrm d\omega_i
$$
$I$ 可以是任意的一种量，比如通量、辐射亮度、像素的值等，具体是什么则由 $W$ 确定。$S$ 是一个带有（假想或真实的）传感器的表面，$I$ 就是由这些传感器测量得到。$W(p, \omega_i)$ 则表示 $p$ 位置的传感器对 $\omega_i$ 方向的入射辐射亮度的响应程度，决定了 $L_i(p, \omega_i)$ 对 $I$ 的贡献。

以通量为例，假设有一个表面区域 $D$，我们要求其一侧的接受的通量 $\Phi$
$$
\begin{aligned}
    \Phi & = \int_D \mathrm dA \int_{\Omega^+} L_i(p, \omega_i) (n_p \cdot \omega_i) \mathrm d\omega_i \\
    & = \int_S \mathrm dA \int_{\Omega^+} I_{D}(p) L_i(p, \omega_i) (n_p \cdot \omega_i) \mathrm d\omega_i \\
\end{aligned}
$$
在这里，示性函数 $I_D(p)$ 在 $p \in D$ 时取 $1$，其他情况取 $0$。比较可以得出 $W(p, \omega_i) = I_D(p)$。这里我们考虑 $S$ 为所有表面，也就是所有表面都放置了传感器。

在辐射亮度估计这个背景下，我们考虑把 Rendering Equation 中的散射项写成 Measurement Equation 的形式，此时散射项就是被测量的量：
$$
\begin{aligned}
	L_s(x, \omega_o) & = \int_{\Omega} f_s(x, \omega_i \to \omega_o) L_i(x, \omega_i) (n_x \cdot \omega_i) \mathrm d\omega_i \\
	& = \int_S \delta(x - p) \mathrm dA \int_{\Omega} f_s(p, \omega_i \to \omega_o) L_i(p, \omega_i) (n_p \cdot \omega_i) \mathrm d\omega_i \\
	& = \int_{S} \mathrm dA \int_{\Omega} W(p, \omega_i) L_i(p, \omega_i) (n_p \cdot \omega_i) \mathrm d\omega_i \\
	& \text{where } W(p, \omega_i) = \delta(x - p) f_s(p, \omega_i \to \omega_o)
\end{aligned}
$$
散射项的 $W(p, \omega_i)$ 可以有更一般的形式 $h(x - p) f_s(p, \omega_i \to \omega_o)$，其中 $h(p)$ 是一个滤波器。因此，理论上所有的滤波器 $h(p)$ 都可以用在散射项的测量上，最理想的就是 $\delta(x)$，没有任何的偏差。如果换做其他的滤波器，则以上公式的计算结果就不再是准确的散射项，正如我们使用的是一个圆形的滤波器，距离圆心大于 $r_m$ 的结果都是 $0$。

从采样的角度来说，$h(p)$ 则有一个更具体的名称叫做重建滤波器（Reconstruction Filter），光子追踪就是一个采样的过程，储存的光子信息就是对连续的光线空间采样得到的离散样本，光子映射的计算就是重建的过程，把离散样本通过重建滤波器得到连续的量，就是辐射亮度的散射部分。

除了圆形滤波器，还有其他两种比较常用的滤波器可以选择，分别是锥型滤波器（Cone Filter）
$$
h(r) = \dfrac{3}{\pi R^2}\max\left\{1 - \dfrac{r}{R}, 0\right\}
$$
和高斯滤波器（Gaussian Filter）
$$
h(r) = \dfrac{1}{2 \pi \sigma} \exp\left(-\dfrac{r^2}{2 \sigma^2}\right)
$$
它们的效果相比圆形滤波器更好，比较明显的一点是在渲染焦散效果时，焦散光斑会更加锐利。

#### Measurement Equation 与重要性

### 渐进式光子映射

### 随机渐进式光子映射

## 双向方法的 Path Tracing

### Path Tracing 与 PM 结合

### Path Tracing 与 SPPM 结合