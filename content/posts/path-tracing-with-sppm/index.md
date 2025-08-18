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
    & \approx L_e(x, \omega_o) + \sum_{i = 1}^k f_s(x, \omega_i \to \omega_o) \dfrac{\Delta^2 \Phi(p, \omega_i)}{\Delta A} \\
    & = L_e(x, \omega_o) + \dfrac{1}{\pi r_m^2} \sum_{i = 1}^k f_s(x, \omega_i \to \omega_o) \Delta^2 \Phi(p, \omega_i)
\end{aligned}
$$

由此我们得到了辐射亮度估计的公式，完全可以利用储存的光子信息来计算。在这里，$k$ 和 $\Delta A = \pi r_m^2$ 都可以用于控制选择 $x$ 附近的哪些光子用于估计，两者只要确定其一，就可以推出另外一个，由此得到两种方案。

第一种是给定 $k$，即 $k$-NN 方法，选择 $x$ 附近的 $k$ 个位置最近的光子进行估计，$\Delta A$ 就是包围这 $k$ 个位置的最小圆，$r_m = \min\{\|x - x_p\|\}$。要实现 $k$-NN，只要用 KD-Tree 和大根堆就可以完成，时间复杂度为 $O(N^{2/3}\log_2 k)$。这一种方案的好处是 $\Delta A$ 的范围是自适应调节的，如果一个地方光子很密集，则无需使用太大的范围进行估计，反之则可以自动扩大估计范围。

第二种是给定 $\Delta A$，或者说是给定最大搜索半径 $r_m$，选择在 $x$ 为中心的球内进行估计，$k$ 就是在范围内的光子数。算法上的实现比 $k$-NN 更简单，时间复杂度为 $O(N^{2/3})$。这一种方案的好处是性能比 $k$-NN 更高，且因为搜索半径可调，更适合 PPM、SPPM。

#### Measurement Equation 与辐射亮度估计

从实现角度来说，以上内容以及完全足够，但从根本原理上来看，这些内容仅仅是一种较形象化的表述。PM 的本质，应该从 Measurement Equation 来介绍。Measurement Equation 描述了测量的方法，各种量都可以表示为 Measurement Equation 的一种具体形式

$$
I = \int_{S} \mathrm dA \int_{\Omega} W_e(p, \omega_i) L_i(p, \omega_i) (n_p \cdot \omega_i) \mathrm d\omega_i
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
    & = \int_{S} \mathrm dA \int_{\Omega} W_e(p, \omega_i) L_i(p, \omega_i) (n_p \cdot \omega_i) \mathrm d\omega_i \\
    & \text{where } W_e(p, \omega_i) = \delta(x - p) f_s(p, \omega_i \to \omega_o)
\end{aligned}
$$

散射项的 $W_e(p, \omega_i)$ 可以有更一般的形式 $h(x - p) f_s(p, \omega_i \to \omega_o)$，其中 $h(p)$ 是一个滤波器。因此，理论上所有的滤波器 $h(p)$ 都可以用在散射项的测量上，最理想的就是 $\delta(x)$，没有任何的偏差。如果换做其他的滤波器，则以上公式的计算结果就不再是准确的散射项。在上一节中，我们使用的是圆盘平均滤波器，距离圆心大于 $r_m$ 的结果都是 $0$。

从采样的角度来说，$h(p)$ 则有一个更具体的名称叫做重建滤波器（Reconstruction Filter），光子追踪就是一个采样的过程，储存的光子信息就是对连续的光线空间采样得到的离散样本，光子映射的计算就是重建的过程，把离散样本通过重建滤波器得到连续的量，就是辐射亮度的散射部分。

除了圆盘平均滤波器，还有其他两种比较常用的滤波器可以选择，分别是锥型滤波器（Cone Filter）

$$
h(r) = \dfrac{1}{\pi r_m^2}\left(1 - \dfrac{2}{3k}\right)\max\left\{1 - \dfrac{r}{k r_m}, 0\right\}
$$

和（局部）高斯滤波器（Gaussian Filter，$\alpha = 0.918, \beta = 1.953$ 是较推荐的参数取值）
$$
h(r) = \alpha \left(1 - \dfrac{1 - \exp(-\beta \frac{r^2}{2 r_m^2})}{1 - \exp(-\beta)}\right)
$$

它们的效果相比圆盘平均滤波器更好，比较明显的一点是在渲染焦散效果时，焦散光斑会更加锐利。

从 Measurement Equation 形式继续推导，就可以得到类似上一节中的结果：

$$
\begin{aligned}
    L_s(x, \omega_o) & = \int_S h(x - p) \mathrm dA \int_{\Omega} f_s(p, \omega_i \to \omega_o) L_i(p, \omega_i) (n_p \cdot \omega_i) \mathrm d\omega_i \\
    & = \int_S h(x - p) \mathrm dA \int_{\Omega} f_s(p, \omega_i \to \omega_o) \dfrac{\mathrm d^2 \Phi(p, \omega_i)}{\mathrm d\omega_i \mathrm dA (n_p \cdot \omega_i)} (n_p \cdot \omega_i) \mathrm d\omega_i \\
    & = \int_S h(x - p) \int_{\Omega} f_s(p, \omega_i \to \omega_o) \mathrm d^2 \Phi(p, \omega_i)\\
\end{aligned}
$$

如果选择圆盘平均滤波器，则有

$$
\begin{aligned}
    L_s(x, \omega_o) & = \int_S h(x - p) \int_{\Omega} f_s(p, \omega_i \to \omega_o) \mathrm d^2 \Phi(p, \omega_i) \\
    & \approx \int_S \dfrac{1}{\pi r_m^2} I_{U(x, r_m)}(p) \int_{\Omega} f_s(p, \omega_i \to \omega_o) \mathrm d^2 \Phi(p, \omega_i) \\
    & = \dfrac{1}{\pi r_m^2} \int_{U(x, r_m)} \int_{\Omega} f_s(p, \omega_i \to \omega_o) \mathrm d^2 \Phi(p, \omega_i) \\
    & \approx \dfrac{1}{\pi r_m^2} \sum_{i = 1}^k f_s(p, \omega_i \to \omega_o) \Delta^2 \Phi(p, \omega_i) \\
    & \approx \dfrac{1}{\pi r_m^2} \sum_{i = 1}^k f_s(x, \omega_i \to \omega_o) \Delta^2 \Phi(p, \omega_i) \\
\end{aligned}
$$

这得到了上一节中完全一样的结果。在某种意义上，之前的结果只是一个巧合，因为只有确定了使用圆盘平均滤波器，才会有 $\Delta A = \pi r_m^2$。对于高斯滤波器来说，最终的结果完全没有 $\Delta A$：

$$
L_s(x, \omega_o) = \sum_{i = 1}^k h(\|x - p\|) f_s(x, \omega_i \to \omega_o) \Delta^2 \Phi(p, \omega_i)
$$

#### Measurement Equation 与重要性

从 Measurement Equation 中可以看出，对于一个量 $I$，不同传感器的不同方向的 $L_i$ 对于 $I$ 都有不同的贡献，权重用 $W_e$ 衡量，这里的 $W_e$ 是传感器发出的。那么 $W_e$ 可以传播吗？事实上是可以的。类比辐射亮度的传播，辐射亮度随着光线的发射和散射，覆盖整个场景，形成了照明。 $W$ 也是一样的，我们称之为重要性，可以想传感器发射了某种探测射线，重要性随着探测射线的发射和散射覆盖整个场景，于是整个场景的辐射亮度对 $I$ 的贡献都可以求解了。

从形式上，重要性与辐射亮度是非常相似的，同一套方程可以同时描述重要性与辐射亮度的传播：
$$
W_o(p, x, \omega_o) = W_e(p, x, \omega_o) + \int_\Omega f_s^*(x, \omega_i \to \omega_o) W_i(p, x, \omega_i) (n_x \cdot \omega_i) \mathrm d\omega_i
$$
$W$ 的下标的含义与 $L$ 的下标类似。注意到对于不同位置的传感器来说，场景中同一个 $(x, \omega_o)$ 的重要性是不一样的，所以我们用 $W$ 的第一个变量表示关联的传感器的位置。因为 $W$ 可以传播，我们除了可以在传感器的半球空间求值，还可以在场景内的所有光源的半球空间求值：
$$
\int_{\Omega} W_e(p, \omega_i) L_i(p, \omega_i) (n_p \cdot \omega_i) \mathrm d\omega_i = \int_M \mathrm dA \int_{\Omega} W_i(p, x, \omega_o) L_e(x, \omega_o) (n_x \cdot \omega_o) \mathrm d\omega_o
$$
后一种求解方式就是对于所有光源上的点，其接受来自各个方向的传感器的重要性，并按照重要性对测量的量产生一定贡献。

回到光子追踪，我们给每次散射后的通量乘上的比例系数实际上就是重要性传播时的比例系数。在 Path Tracing 中，我们通过乘上 BSDF 等系数来计算辐射亮度的吞吐量，而在光子追踪中，整个过程相反，我们通过乘上 BSDF 等系数来计算重要性的吞吐量。在辐射亮度估计中，需要估计点附近的 $\Delta^2 \Phi$，$\Delta^2 \Phi$ 实际上是用 $L_i$ 表示的，而 $L_i$ 的最终来源是光源处的 $L_e$，我们结合以上两个公式，将在估计点附近的对 $W_e L_i$ 的积分转换为所有光源附近的对 $W_i L_e$ 的积分，$W_i$ 按照传播方程，在追踪过程中累乘 BSDF、余弦项等系数完成计算。

### 渐进式光子映射

传统光子映射的效果取决于发射光子的总数，光子越多，密度估计半径就可以越小，模糊效果就越小，精度越高。然而光子的总数受限于机器的内存大小，如果内存不够，渲染时间再长，光子映射的效果也不会提升，模糊没有办法减少。因此渐进式光子映射（Progressive Photon Mapping, PPM）应运而生。

### 分批次渐进式渲染

如果不能够一次储存下所有的光子，那么就分批发射，然后累计最后的结果。因此 PPM 在总体流程上与 PM 不同，PPM 需要先进行 Path Tracing，这个过程采样得到的路径会被保存，具体来说，按照原来 PM 的 Path Tracing 阶段来采样，生成得到的路径会对场景中的不同地方进行辐射亮度估计，我们把这些地方称为观察点。对于每条路径，记录下直接光照的计算结果、观察点到相机的吞吐量，这样这一条路径就可以重复利用。在获得观察点后，开始多个批次的光子追踪和贡献过程，不同批次的光子都可以给附近一定范围内的观察点提供贡献（可以用 $k$-NN 或球搜索），观察点只需要不断累加通量，再除以累计发射光子数，就可以得到累计到当前批次的估计。

### 半径缩减

以上的方法基本解决了内存不够的问题，但是渲染结果依旧是模糊的，这是因为贯穿每个批次的估计半径都是不变的。如果光子给附近 $k$ 近邻的观察点提供贡献，显然观察点不会改变，因此观察点的范围还是没有办法减小。如果光子给附近一定距离的观察点提供贡献，这个距离不变，观察点的范围也不会减小。要减小模糊，必须有办法缩减贡献半径。

由于观察点不会增多，所以 $k$-NN 得到的观察点与光子的距离的上界无法减小， $k$-NN 必定不能作为我们的搜索方法。我们考虑使用球搜索，并按照一定的方法不断减小球搜索半径，这意味着观察点能够接受贡献的光子的范围也会越来越小。

接下来，我们只考虑一个观察点，用 $N_i(x)$ 表示到第 $i$ 批次为止观察点 $x$ 的估计范围内接受的所有光子，$R_i(x)$ 表示第 $i$ 批次使用后缩减的估计半径，同时也是第 $i + 1$ 批次使用的估计半径，所以可以定义光子数密度为

$$
d_i(x) = \dfrac{N_i(x)}{\pi R_i^2(x)}
$$

在以下推导中，都假设同一个观察点内光子的分布是均匀的。

首个批次我们不考虑半径缩减，只进行与 PM 类似的过程，使用 $k$-NN 统计观察点附近的光子进行估计，则 $N_1(x) = k$，半径 $R_1(x) = \max\{\|x - p\|\}$。从第 2 轮开始，就要持续地缩减半径。在第 $i$ 轮，使用 $R_{i - 1}(x)$ 进行搜索，搜索得到 $M_i(x)$ 个光子。因此光子数密度增加：
$$
d_i(x) = \dfrac{N_{i - 1}(x) + M_i(x)}{\pi R_{i - 1}^2(x)}
$$

接下来缩减半径，同时要保证光子数密度与缩减前相同。定义一个系数 $\alpha$，用于表示缩减的比例（一般取 $0.75$ 或 $2 / 3$），用光子数密度列等式：

$$
\dfrac{N_i(x)}{\pi R_i^2(x)} = \dfrac{N_{i - 1}(x) + \alpha M_i(x)}{\pi R_i^2(x)} = \dfrac{N_{i - 1}(x) + M_i(x)}{\pi R_{i - 1}^2(x)}
$$

解这个方程可以得到
$$
R_i(x) = \sqrt{\dfrac{N_{i - 1}(x) + \alpha M_i(x)}{N_{i - 1}(x) + M_i(x)}} R_{i - 1}(x)
$$
注意到 $\alpha$ 乘在当前批次新搜索得到的光子上，这意味这如果没有搜索到光子，半径是不会缩减的，这避免了不受控的无限缩减，导致半径提前缩小太多导致根本搜索不到光子。半径的缩减是按需的，只有在当前半径可以接受到足够的光子，才会收缩对应的程度。

### 通量缩减

由于 PPM 中发射光子数持续增加，我们修改光子的 $L_i$、$\Delta^2 \Phi$ 的定义为未缩放过的量，即没有除以发射光子数 $N_{e, i}$。

回顾 Measurement Equation 一节推导的 $L_s$ 的估计
$$
L_s(x, \omega_o) \approx \dfrac{1}{N_{e, i} \pi r_m^2} \sum_{i = 1}^k f_s(x, \omega_i \to \omega_o) \Delta^2 \Phi(p, \omega_i)
$$
$r_m$ 已经被分离出来了，可以直接用 $R_i(x)$ 代入。但是由于半径的缩减，一部分光子已经被我们排除在外了，所以它们的通量也要被排除。问题在于我们使用的分批次算法，以前所有批次的光子早已丢弃，一个个统计是不可行的。因此我们再次假设光子的通量分布也是均匀的，与估计面积成比例。

假设第 $i$ 批次的累积的所有通量为 $\phi_i(x, \omega_o)$，第 $i$ 批次新增 $\tau_i(x, \omega_o)$ 即
$$
\tau_i(x, \omega) = \sum_{k = 1}^{M_i(x)} f_s(x, \omega_i \to \omega_o) \Delta^2 \Phi(p, \omega_i)
$$
按照与面积同比例缩减，得到等式
$$
\phi_i(x, \omega_o) = \dfrac{N_{i - 1}(x) + \alpha M_i(x)}{N_{i - 1}(x) + M_i(x)} (\phi_{i - 1}(x, \omega_o) + \tau_i(x, \omega_o))
$$
最终的 $L_s$ 为
$$
L_s(x, \omega_o) = \dfrac{\phi_i(x, \omega_o)}{N_{e, i} \pi R_i^2(x)}
$$

### 随机渐进式光子映射

随机渐进式光子映射（Stochastic Progressive Photon Mapping, SPPM）是对 PPM 的修改。PPM 的第一个阶段发射多条光线来获得多个采样点，但固定的采样点则有着一些问题。采样点不变，则估计的范围也是固定在几个局部，而传统 Path Tracing 则可以采样不同越来越多的路径。所以 SPPM 不再使用固定的观察点，而是在每个批次重新使用 Path Tracing 来获得新的观察点。尽管观察点不同，但同一个像素对应的一系列观察点可以使用同一套 $N_i(x), R_i(x)$，相当于把观察点从场景中转移到了像素上。

按照这个方法，我们考虑像素 $j$，则可以得到修改的公式
$$
R_i(j) = \sqrt{\dfrac{N_{i - 1}(j) + \alpha M_i(x)}{N_{i - 1}(j) + M_i(x)}} R_{i - 1}(j)
$$
定义吞吐量为 $\beta(x, \omega_o)$，则我们可以把观察点的通量转换为对像素的通量贡献：
$$
\phi_i(j) = \dfrac{N_{i - 1}(j) + \alpha M_i(x)}{N_{i - 1}(j) + M_i(x)} (\phi_{i - 1}(j) + \beta(x, \omega_o) \tau_i(x, \omega_o))
$$
最终的 $L_s$ 为
$$
L_{s,i}(j) = \dfrac{\phi_i(j)}{N_{e, i} \pi R_i^2(j)}
$$
由于每个批次都同时进行 Photon Tracing 和 Path Tracing，所以两者的顺序不再重要，完全可以先进行 Photon Tracing 再 Path Tracing，这样就省去了储存观察点的过程。

## 双向方法的 Path Tracing

### Path Tracing 与 PM 结合

传统 Path Tracing 最难以处理的是焦散，焦散是指光从光源出发经过镜面反射或镜面折射最后到达漫反射表面形成的照明，其效果明显，但光路在 Path Tracing 中难以采样，从摄像机出发的单向方法因此非常低效。PM 从光源出发，则对于焦散的处理非常高效，与  Path Tracing 形成互补。

同时漫反射表面使用辐射亮度估计时，光子利用率高，效果好，所以也可以用 PM 来处理漫反射表面。

分别对 BSDF 和 光路进行分解，然后分情况讨论。BSDF 可以分解为 $f_s = f_{s, d} + f_{s, s}$，分别表示非镜面 BSDF 和镜面 BSDF。光路可以分解为 $LD$、$LS^+D$ 和剩下的，分别代表直接光照、焦散光照、间接光照，这三种光路的 $L_i$ 分别记作 $L_{i, d}$、$L_{i, c}$、$L_{i, i}$。将 BSDF 和光路两两组合，可以按照不同的策略进行处理。

- $f_{s, d} L_{i, d}$：非镜面材料接受直接光照，这种情况下使用 NEE + MIS 方法即可。
- $f_{s, d} L_{i, c}$：非镜面材料的焦散光照，把焦散光路的光子存进一个单独的焦散光子图，单独用焦散光子图估计焦散光路。
- $f_{s, d} L_{i, i}$：非镜面材料的其他间接光照，我们一般从当前点再散射一次光线，从下一个非镜面点使用一个全局的光子图进行估计，如果散射的光线到达了镜面点，则继续递归，直到非镜面点。
- $f_{s, s} L_i$：镜面材料的 BSDF 是奇异的，使用 Path Tracing 明显好于 PM。

尽管本文最终实现的是 SPPM，但还是有必要从 PM 开始介绍结合的思路，后续的 SPPM 也基于此进行实现。

### Path Tracing 与 SPPM 结合

首先是如何做光子追踪，以下是在漫反射材料的散射代码：

```rust
impl Diffuse {
    fn receive(
        &self,
        context: &mut PmContext<'_>,
        state: PmState,
        photon: PhotonRay,
        intersection: RayIntersection,
    ) {
        match state.policy() {
            StoragePolicy::Global => {
                self.store_photon(context, &photon, &intersection);
                self.maybe_bounce_next_photon(context, state, photon, intersection);
            }
            StoragePolicy::Caustic => {
                if state.has_specular() {
                    self.store_photon(context, &photon, &intersection);
                }
            }
        }
    }
    
    // ...
}

pub trait BsdfMaterialExt: BsdfMaterial {
    fn maybe_bounce_next_photon(
        &self,
        context: &mut PmContext<'_>,
        state_next: PmState,
        photon: PhotonRay,
        intersection: RayIntersection,
    ) {
        let renderer = context.renderer();
        let mut throughput = photon.throughput();

        let continue_prob = (throughput.red())
            .max(throughput.green())
            .max(throughput.blue())
            .clamp(Val(0.0), Val(1.0));
        if Val(context.rng().random()) < continue_prob {
            throughput /= continue_prob;
        } else {
            return;
        }

        let sample = self.sample_bsdf(photon.ray(), &intersection, *context.rng());
        let throughput_next = sample.coefficient() * throughput;
        let photon_next = PhotonRay::new(sample.into_ray_next(), throughput_next);
        renderer.emit(context, state_next, photon_next, DisRange::positive());
    }
    
    // ...
}
```

我们继续考虑如何实现通量估计，可以参考以下代码：

```rust
#[derive(Debug, Clone, PartialEq, Eq, CopyGetters)]
pub struct FluxEstimation {
    #[getset(get_copy = "pub")]
    flux: Spectrum,
    #[getset(get_copy = "pub")]
    num: Val,
    #[getset(get_copy = "pub")]
    radius: Val,
}

pub trait BsdfMaterialExt: BsdfMateril {
    fn estimate_flux(
        &self,
        ray: &Ray,
        intersection: &RayIntersection,
        photon_info: &PhotonInfo,
    ) -> FluxEstimation {
        let (pm, policy) = (photon_info.photons(), photon_info.policy());
        let center = intersection.position();
        let photons = pm.search(center, policy);

        let mut flux = Spectrum::zero();
        for photon in &photons {
            let bsdf = self.bsdf(-ray.direction(), intersection, photon.direction());
            flux += bsdf * photon.throughput();
        }

        let radius = if let SearchPolicy::Radius(radius) = policy {
            radius
        } else {
            (photons.iter())
                .map(|photon| (center - photon.position()).norm_squared())
                .max()
                .map_or(Val::INFINITY, |r2| r2.sqrt())
        };

        FluxEstimation::new(flux, photons.len().into(), radius)
    }

    // ...
}
```

由于我们需要在像素储存累积的通量，Path Tracing 不再直接计算所有的光照，而必须按照上文的方法进行分类，把各个类别的光照分开储存分开返回，比如下面这样：

```rust
#[derive(Debug, Clone, PartialEq)]
pub enum Contribution {
    Light(Spectrum),
    All(Box<ContributionInner>),
}

#[derive(Debug, Clone, PartialEq)]
pub struct ContributionInner {
    light: Spectrum,
    global: FluxEstimation,
    caustic: FluxEstimation,
}
```

接下来就可以实现每个材料的计算光照的代码，以漫反射材料为例，其他材料按情况处理：

```rust
impl Diffuse {
	fn shade(
        &self,
        context: &mut RtContext<'_>,
        state: RtState,
        ray: Ray,
        intersection: RayIntersection,
    ) -> Contribution {
        if state.visible() {
            let light = self.shade_light(context, &ray, &intersection);
            let caustic = self.estimate_flux(&ray, &intersection, context.photon_casutic());
            let mut res = self.shade_scattering(
                context,
                state.mark_invisible().with_skip_emissive(true),
                &ray,
                &intersection,
            );
            res.add_light(light.light());
            res.set_caustic(caustic);
            res
        } else {
            let global = self.estimate_flux(&ray, &intersection, context.photon_global());
            let mut res = Contribution::new();
            res.set_global(global);
            res
        }
    }
}
```

最后可以用以下代码来计算其中一种光路的累积通量，以及计算最终的辐射亮度：

```rust
#[derive(Debug, Clone, PartialEq)]
struct Observation {
    flux: Spectrum,
    num: usize,
    radius: Val,
}

impl Observation {
    const NUM_ATTENUATION: Val = Val(0.75);

    fn accumulate(&mut self, flux: &FluxEstimation) {
        let total = self.num + usize::from(flux.num() * Self::NUM_ATTENUATION);
        let fraction = Val::from(total) / (Val::from(self.num) + flux.num());
        self.flux = (self.flux + flux.flux()) * fraction;
        self.num = total;
        self.radius *= fraction.sqrt();
    }

    fn radiance(&self, num_emitted: usize) -> Spectrum {
        let area = Val::PI * self.radius.powi(2);
        self.flux / (area * Val::from(num_emitted))
    }
    
    // ...
}
```

