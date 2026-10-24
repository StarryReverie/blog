---
title: 重构博客的总结
date: 2026-10-23T09:54:35+08:00
draft: false
categories:
  - Thought
tags:
  - CSS
  - Design
  - Frontend
  - HTML
  - UI
  - Web
math: false
---

在 NixOS CN 群群友的怂恿下，我也重构了博客。大约一周后，我终于完成了这项工程，在此记录重构博客中的思考和做出的各种选择。

<!--more-->

## 背景

某天我在 NixOS CN Off Topic 群中看到群友分享了自己重构完成的博客网站。访问了这个新站点后，我很是心动，原来的使用 PaperMod 的 Hugo 博客瞬间不香了。可是在那时，我还忙于编写其他项目，并没有多少时间可以投入到这一项颇具意义的工程中。但是重构博客的想法并没有在我心中熄灭。

终于到了前三周，我得以考虑重构博客的相关事宜。这一次，我不打算直接使用现成的主题，而是从零自己设计一套 UI，因为博客应当是我的个人风格的体现。我开始做调研各种 Static Site Generator (SSG)，考虑是否需要迁移到一个更合适的生态当中。同时，我也开始学习前端 UI 设计相关知识，尽可能做出一个既美观又易用的站点。

在这一周多的实践里，我亲手完成了设计决策，也逐渐理解了设计的各种思想。所以我想把这些思考记录在本文中。

## SSG 生态选择

截止 2026 年，SSG 已经烂大街了。在我看来，造一个能用的 SSG 已经不是什么技术难题，因为 SSG 本质上就是 MVC 模式，SSG 作为 Controller 把文章内容和站点配置作为 Model，使用作为 View 的模板引擎进行渲染。简而言之，做一个基本的 SSG 甚至可以在一天时间内完成。

我更看重 SSG 的生态丰富程度、工具的可用性、以及设计的哲学这三个方面考虑。所以我主要关注以下几个 SSG。

### Astro

Astro 是近年来的一个新兴 SSG，基于 Node.js 生态。Astro 也是我认识的大多数群友的选择。

Astro 可以使用 JSX 作为模板语法，当然在这里可能称为组件更符合 JS/TS 前端的语言。Astro 可以轻松集成各种前端生态，包括但不限于在 Astro 中使用 React、Vue 这样的前端框架，而最终的渲染结果仍然是静态的。除此之外，Astro 还提倡岛架构，即在整个页面的独立的区域使用 JS，区域之间互相隔离，组件做到 self-contained，还是很不错的理念的。

在相关工具的集成上也是非常方便的，普通的前端项目怎么使用在 Astro 也是这么用。

尽管这个框架很不错，我最终没有选择 Astro。这主要还是因为我对于现代前端和 Node 生态不是很了解，我还没有计划继续深入了解。某种程度上这种想法是一种 bias，当我最终完成重构后也意识到，如果使用 Astro，在某些方面可能会更方便，Astro 也是一个很值得尝试的 SSG。

### Zine

这或许是最极简主义的方案了。Zine 及相关工具是使用 Zig 完全从零编写的 SSG 生态。有多么完全呢？其模板引擎 SuperHTML 从零编写，内容源文件 SuperMD 从零编写，Front Matter 语法 Ziggy 从零编写。作者还同时编写了相关的辅助工具，如语言服务器等。这些工具的性能都非常好，可惜在使用前需要很多的编译准备。

Zine 的独特之处在于 SuperHTML 的语法是严格版的 HTML，语法的严格程度相当于 XML。同时其中也没有任何的模板引擎专用语法，所有的功能都是通过 HTML 属性实现的，比如以下的 `layouts/post.shtml`：

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <title :text="$site.title"></title>
  </head>
  <body>
    <h1>Blog</h1>
    <h2 :text="$page.title"></h2>
    <h3 :if="$page.authors.first?()">
      by <span :text="$if"></span>
    </h3>
    <h4>
      Posted on: 
      <span 
        :text="$page.date.format('January 02, 2006')"
      ></span>
    </h4>
    <div :html="$page.content()"></div>
  </body>
</html>
```

我所知道的采用这种方法的其他模板引擎只有 Java 生态中的 Thymeleaf。我其实挺喜欢这种语法的，模板引擎源文件可以直接在浏览器中打开。

此外其内容源文件 SuperMD 使用了 Scripty Directive，其伪装成链接语法来实现一些特殊的效果。所以 SuperMD 里也不能存在非 Markdown 的内容，HTML 无法内联，这种方法保证了内容和实际的展示彻底分离。

Zine 可以作为 Zig build system 中的一个步骤使用。所以需要处理复杂的资源时，可以用 Zig build system 来编排各个环节，然后把处理产物交给 Zine 处理。这也很有灵活性。

尽管看上去很有前景，我发现从 Hugo 迁移到 Zine 的成本实在太高了。首先是前面提到的构建时间，我的场景必须使用 Zig build system 来预处理 CSS，这意味着无法使用预编译的 Zine 可执行文件，对于 CI 环境非常不友好。

其次我认为 Zine 太过于 opinionated 了，比如数学公式语法必须使用 Scripty Directive 的 `[y = kx + b]($mathtex)`，我有太多的公式，迁移起来太麻烦。另外一个情况就是 SuperMD 强制要求使用 `<h1>` 作为顶级章节标题，而我现有的源文件都遵循 Markdownlint 的 `<h2>` 作为章节标题，`<h1>` 或者 Front Matter 中的 `title` 字段作为页面标题。除此之外还有挺多这样的问题。

前面的都不是主要的问题，最致命的缺陷是 SuperHTML 不支持模板片段，这使我完全打消了使用 Zine 的念头。SuperHTML 只有模板继承可以复用代码。这是我最不能理解的，所有排得上号的模板引擎如 Jinja、Go Template，包括现在几乎被遗忘的 Thymeleaf， 都支持模板片段。我很遗憾作者没有考虑到**组合优于继承**有多么的重要，在一个模板引擎中应该占据多么高的优先级，我宁愿没有模板继承也不能没有模板片段。如果使用模板片段（或者说组件），写出来的页面代码会更容易组合和复用。我可以接受需要对文章内容文件进行迁移，但是我不能接受模板代码不够优雅。

其实你在这里可以发现我对 Zine 的判断已经是本身弊大于利了，不选择它并不是仅仅因为其他 SSG 能够稍微多提供一些功能特性，而是质的差异。我只能希望以后这些问题能够改善，提升开发体验。

### Hugo

Hugo 是我在重构博客之前所使用的 SSG，也是我最终选择的 SSG。

Hugo 同样具有各种比较完善的功能。虽然本身是 Go 编写的，但是其内置了一些工具可以和前端工具进行交互，比如 `js.Build` 可以使用 `esbuild` 打包 JS，`css.PostCSS` 和 `css.TailwindCSS` 可以预处理 CSS，`transform.ToMath` 则可以在构建站点时立刻渲染 MathML 和 HTML，不必再引入数学公式渲染 JS。

Hugo 的另外一个重要功能是 Module Mount。虽然没有构建系统可以预先运行一些打包功能，但是 Hugo 可以直接把任意目录挂载到任意目标位置，在模板中使用的都是 VFS 中的结构。所以这可以实现把 `node_modules` 中的某些 `dist` 挂载到资源目录中，某种程度上也是一个另类但很好用的方法。Module Mount 还同时可以用于改变默认的仓库结构。

继续使用 Hugo 意味着我只需要重写模板，对于内容不需要做一点改动。所以这也是我决定继续使用 Hugo 的一个很大的原因。

Hugo 也不是没有缺点，Go Template 在表达能力上差强人意。Go Template 的模板片段即 `partial` 的语法比较受限，不如 JSX 中的组件那么方便。当我需要给 `partial` 传入多个参数时，必须用 `dict` 打包多个参数。同时我也想要 Named Slot 的功能，这样模板片段就可以更方便地组合多个部分的内容。某种程度上这也比较类似模板继承的“扩展”的模式，但是 JSX 的方式明显更加灵活。Hugo 的比较新的版本中引入了 Partial Decorator，这相当于仅有一个 Slot 的简化版本，我觉得在语法上比较类似于 Typst 的 `#xxx()[]` 风格的内容块语法糖。但是，我最终想到了如何实现我想要的功能，将在下文介绍。

## 前端

### 理论准备

自从之前被吐槽我某个 vibe 的网页很丑后，我痛定思痛，决定必须认真学习前端设计，并且这次绝对要完全自己设计，不能偷懒用 AI。我选择的书是《Design for Developers》和《Refactoring UI》。总体上来说，我觉得前者更系统地讲解了各种理论，包括色彩、排版、各种组件的交互等等。按顺序阅读完这本书，我对于怎么设计一个看得过去且合理的网站有了基本的了解。后面这本书我看得不多，我觉得它的知识点比较细碎，从前者开始系统学习会更好。

于是在设计博客时，我做的第一件事情就是确定好 Design System。

### 色彩

我选择了 primary、secondary、base 三个色相，用 [tints.dev](https://www.tints.dev) 生成了 `50` 到 `950` 的阶梯。随后是从这些阶梯中选择一些合适的，作为语义化的别名变量。

{{< palette path="palette-primary.yaml" >}}

{{< palette path="palette-secondary.yaml" >}}

{{< palette path="palette-base.yaml" >}}

对于我这个博客而言，secondary 几乎没有使用。我曾经尝试在一些地方使用这一系列颜色，不过感觉有些喧宾夺主，还是改为 base 系列了。

最终的版本位于 [`color.css`](https://github.com/StarryReverie/blog/blob/965bc4399267ffb7639e54246e95717e40f2be4c/site/assets/css/colors.css)。

当然后续我完成大部分重构后，和群友讨论设计相关的问题，[Cuskiy](https://ity.moe/) 教我可以使用 `color-mix` 混合前景色和透明色来定义边框或背景色，比如 `color-mix(in oklch, var(--text) 10%, transparent)`。我后续倒是用这种做法来调比较次要的按钮的配色。

### 排版

在文字排版方面，我使用了 [Utopia](https://utopia.fyi) 生成了字号阶梯和间距阶梯。值得注意的是这是 Fluid Type Scale 和 Fluid Space Scale，这些 CSS 变量可以随着 Viewport 的宽度动态伸缩，比如

```css
:root {
  --static-type-base: 1rem;
  --fluid-type-base: clamp(var(--static-type-base), 0.9489rem + 0.2273vw, 1.125rem);
}
```

随后同样也是选择了一些语义化别名，比如我把 `h1` 到 `h6` 映射到了 `--fluid-type-4xl` 到 `--fluid-type-sm`，在普通文本中定义了 `emphasis`、`body`、`note` 分别对应 `lg`、`base`、`sm`。我当时不太确定是否要在全站完全使用 Fluid Scale，所以仍然保留了 static scale 系列变量，当然到最后我发现基本上没有用到。

Space scale 是我觉得更需要确定的一个部分。因为间距的情况比较复杂，也不如 `h1` 到 `h6` 那么好记忆，不定义别名很容易弄混。我的方法是先把间距分为两类，第一类是一个容器的边框与内部内容之间的间距，即 padding，第二类是容器内的多个子元素之间的间距，即 gap。然后对于每一类，都按从大到小的顺序合理分配一些映射，具体怎么分配，其实也需要找感觉，我是直接结合一些实例内容进行调整的，直到感觉上比较舒服。

```css
:root {
  --space-page: var(--fluid-space-lg);
  --space-inset: var(--fluid-space-base);
  --space-component: var(--static-space-sm);
  --space-control: var(--static-space-2xs);

  --space-section: var(--fluid-space-xl);
  --space-gutter: var(--fluid-space-base);
  --space-stack: var(--fluid-space-sm);
  --space-line: var(--fluid-space-2xs);
  --space-inline: var(--static-space-xs);
}
```

因为缺乏经验，这一份配置不是一次成型的，在后续也有一些微调。最终的版本位于 [`typography.css`](https://github.com/StarryReverie/blog/blob/965bc4399267ffb7639e54246e95717e40f2be4c/site/assets/css/typography.css)。

### 技术栈

我再也不想写原生 CSS 了。我也曾经在某课程项目中写过原生 CSS，但是这种样式和结构分离的做法让我很难受，我要来回不停地在不同编辑器标签页中切换，而且还要考虑各种样式继承和覆盖的问题。

最近我了解到了 Tailwind CSS（相比熟知前端的群友们还是太不敏锐了），这种 utility class 的做法让我感觉非常舒适，简直是看上一眼就喜欢上了。2026 年，Hugo 对于 Tailwind CSS 已经有了 first-class 级别的支持，集成起来几乎没有难度了。所以我马上选择了 Tailwind CSS。

## 模板开发

### 组件化 Go Template

#### Self-Contained 组件

在这次开发中，我大量使用了 Go Template Partials。不过 `partial` 终究是字符串替换，相比 JSX 还是没有那么严格。这就导致了一个问题，`partial` 的结果到底能不能被确定性地展示、是否放在任何地方都有符合预期的内部布局。

具体来说，`partial` 不一定能做到 self-contained。如果一个 `partial` 返回的是多个 HTML 元素，那么替换后都会成为上级 HTML 元素的子节点，上级元素的设置就会影响到这些替换后的子元素，比如间距。或许我们在 `partial` 中并没有打算就这样让这些元素跟随周围环境的样式变化。为了最大程度的可预测性，`partial` 应当只返回恰好一个元素，所有的子元素都包含在一个 `<div>` 中。如果本来就只有一个元素，那么就没有必要再套 `<div>` 了。

考虑模板继承的场景，父模板中的内容是否会被子模板中扩展到内容影响呢？也是有可能的，所以也应该需要在 `block` 的周围套一个 `<div>`。

根据这些原则，我可以举一个例子：

```html
<!doctype html>
<html lang="{{ site.Language.Locale }}" dir="{{ or site.Language.Direction `ltr` }}" class="bg-card">
  <head>
    <!-- ... -->
  </head>
  <body
    hx-boost:inherited="true"
    hx-indicator:inherited="#global-loading-pbr"
    class="flex min-h-dvh flex-col bg-background pb-page"
  >
    {{- partialCached "components/loading-pbr.html" "emptyContext" -}}
    <div>
      {{- partial "components/header.html" $ -}}
      <section>{{- block "hero" $ -}}{{- end -}}</section>
    </div>
    <main id="main" class="grow">{{- block "main" $ -}}{{- end -}}</main>
    {{- partialCached "components/footer.html" $ -}}
  </body>
</html>
```

在这之中，`loading-pbr.html`、`header.html`、`footer.html` 都是组件，必定返回恰好一个 HTML 元素。而 `hero`、`main` 等 `block` 的内容无法确定，需要在外包裹一层。

#### 间距

元素的间距可以分为 padding 和 margin。我觉得这里同样需要遵循 self-contained 的原则。间距是不可视的，但是又确实会对元素的布局产生影响。为了避免布局上的各种奇怪问题，我们也应该尽可能让间距的使用可预测。

具体来说，间距是靠元素与元素之间的关系体现的，如果只有一个元素，理应没有间距的概念。那么对于一个单独的组件，它的可视边界周围理应没有间距。如果存在这种可视边界之外的隐藏部分，只有在与其他元素一起布局时，这些隐藏的部分才会显现。间距的减少比增加要困难得多，所以为什么不在一开始就不要加不必要的间距呢？

所以对于没有边框的元素，比如各种文本，最好不要加任何的 padding 和 margin。对于有边框的元素，就不要加任何 margin。某种程度上，这也是为什么 Tailwind CSS 清空元素的默认样式、设置盒模型为 `border-box` 的原因。

那么元素之间的间距就应该交给容器设置。对于普通的 `block` 容器，可以使用 `space-y-*` utility class 配置，这避免了手动给每个元素手动设置 margin。对于 `flex` 和 `grid` 容器，则可以使用 `gap-*` utility class。反之，不要设置 `mt-*` 或 `mb-*` 这样的 utility class，它们违反了 self-contained 原则，哪怕是在局部，也几乎没有使用的必要。以下片段就是一个例子。

```html
<div class="space-y-section">
  <header class="space-y-line">
    <h1 class="text-fl-h1 font-bold text-heading">{{ $.headerTitle }}</h1>
    <div>{{ $.headerContent }}</div>
  </header>

  <div>{{ $.content }}</div>
</div>
```

当然也有一些例外情况。我目前能想到的就是一个元素宽度受限，但是需要相对于容器水平居中，比如一个限制了最大长度的导航栏。这种情况下可以在这个元素上加 `mx-auto max-w-*`。使用 Flexbox 也不是不可以，需要在容器元素上加 `flex justify-center`，在子元素上加 `grow`，所以不如前一种写法简单。

### Utility Classes 的组合

Utility class 的卖点之一就是可组合性，那么怎么做到可组合呢？我的结论是把所有的 utility classes 尽可能向下移动，直到需要产生对应作用的元素上。

分类来看，对于布局类 utility class，如 `flex`、`gap-*`、`space-*`、`p-*` 等等，它们没有继承性质，所以不能放在父级元素上，所以自然而然地满足了这个要求，只能放在我们想要设置的容器元素本体上。

对于样式类 utility class（其实我也不知道应该叫什么好），如设置颜色的 `text-<color>`、`bg-*`，设置字体排版的 `text-<size>`、`font-*` 等等，则应该直接作用于叶子元素上，也就是直接包含内容的元素上。这些 utility classes 大多可以通过继承往子元素传递，然而这恰恰是我们要避免的！如果我们把样式都放在直接作用的元素上，就可以非常轻松的分析这个元素的样式。反之，就需要考察从当前元素一直到各级祖先元素上的样式，成本更大。更不用说这个元素在一个组件内部的时候，根本无从得知这个组件会被包含在那些元素中，又有哪些样式会继承下来。

这种方法也会导致 utility classes 的重复。但是我觉得这并不会有很严重的影响。如果是结构完全相同的元素，那么大多数情况已经是通过模板引擎的循环结构来生成的，utility classes 也只需写在循环体中一次。如果是结构不同的元素，更多情况下不会有重复样式的可能。在 Visual Hierarchy 上，样式更需要有差异，在功能上，元素的交互行为也有不同，所以几乎不会有很多的 utility classes 重复。

如果真的有大量重复，也有多种可选方案。如果这些重复都在局部的块内，可以通过多光标编辑来解决修改问题。如果是明确的一种样式和功能的模式，可以自定义 utility class，如我的链接颜色样式：

```css
@utility link {
  @apply text-primary underline transition-colors duration-400
    visited:text-secondary hover:text-primary-active hover:visited:text-secondary-active;
}
```

虽然这样做也需要注意不要过度包含 class，以保证组合性。

### JSX-like Partials

前面提到 Go Template Partials 没有 JSX 那么好用，那么如何解决这个问题呢？

事实上，Go Template 足够动态类型，`partial` 可以接受任意类型的参数。没想到动态类型居然成为了优点（笑）。多个参数使用 `dict` 组装，可以模拟命名参数传递。而 Named Slot 功能，也只需要把要插入 slot 的内容提前渲染好，然后通过 `dict` 传递即可。

由于 `partial` 调用使用字符串作为引用，所以我们甚至可以传入一个 `partial` 的名称到另外一个 `partial` 中，接受的 `partial` 使用这个 `partial` 名称进行调用，就实现了一半的高阶 `partial`。当然这实际上只是回调，`partial` 不是 first-class 的，没有闭包功能，也不能作为值自由传递，但是对于我们现有的场景也足够使用了。

一个例子是渲染文章列表页面的实现，以下是一个基本的多节内容模板 `_partials/views/main-sections.html`：

```gotmpl
<!-- prettier-ignore-start -->
{{- partial "views/main.html" (dict
  "headerTitle" $.headerTitle
  "headerContent" $.headerContent
  "content" (partial "views/main-sections.html/content.html" (dict
    "entries" $.entries
    "entryToContent" $.entryToContent
    "extraContent" ($.extraContent | default ""))))
-}}
<!-- prettier-ignore-end -->

{{- define "_partials/views/main-sections.html/content.html" -}}
  <div id="entry-sections" class="space-y-gutter">
    {{- range $entry := $.entries -}}
      <section class="-mx-inset rounded-sm bg-card p-inset">
        {{- partialCached $.entryToContent $entry $entry -}}
      </section>
    {{- end -}}


    <div id="extra-wrapper">
      {{- $.extraContent -}}
    </div>
  </div>
{{- end -}}
```

而渲染 Posts 类文章列表的模板 `pages/section.html` 可以这样写：

```gotmpl
{{- define "main" -}}
  {{- $pages := where site.RegularPages "Section" "posts" -}}
  {{- $pager := $.Paginate $pages -}}

  {{- partial "views/main-sections.html" (dict
    "headerTitle" "All Posts"
    "headerContent" (partial "components/section-metadata.html" $pager)
    "entries" $pager.Pages
    "entryToContent" "components/posts/card-content.html"
    "extraContent" (partial "components/pagination.html" $pager))
  -}}
{{- end -}}
```

其中 `_partials/components/posts/card-content.html` 的实现为：

```html
<div class="space-y-stack">
  <header class="space-y-line">
    <h2>
      <a
        href="{{ $.RelPermalink }}"
        class="text-fl-h3 font-bold text-heading transition-colors duration-400 hover:text-primary"
        >{{ $.LinkTitle | default $.Title }}</a
      >
    </h2>

    <p class="flex gap-1 text-fl-body text-subtle">
      <span>{{- partialCached "components/content/icon.html" (dict "name" "calendar-up") "calendar-up" -}}</span>
      <span>{{- partial "components/content/date.html" $.Date -}}</span>
    </p>
  </header>

  <p class="text-fl-body text-foreground">
    {{ $.Content | transform.Plainify | strings.Truncate 120 }}
  </p>

  <div class="flex justify-end">
    <a
      href="{{ $.RelPermalink }}"
      class="text-fl-note text-subtle transition-colors duration-400 hover:text-foreground"
    >
      Read More ...
    </a>
  </div>
</div>
```

### HTMX 集成和渐进式增强

既然我们已经基于 Node.js 集成了 Tailwind CSS，那么再集成一些前端组件也不是那么麻烦。我选择了 htmx 4 来提升前端的交互体验。在原则上，所有的这些功能应当是可选的，在 JS 无法使用的情况下，用户仍然可以使用原有的方式进行交互。

集成 htmx 只需要在 `main.js` 中添加以下内容，然后使用 `js.Build` 即可打包：

```javascript
import "htmx.org";
import "htmx.org/dist/ext/hx-alpine-compat.js";
import "htmx.org/dist/ext/hx-head.js";
import "htmx.org/dist/ext/hx-history-cache.js";

htmx.config.transitions = true;
```

以上是本站使用的全部 htmx 导入和配置。

#### 平滑跳转

在 `<body>` 上设置 `hx-boost`，即可自动增强站内链接跳转，当用户点击链接时，htmx 拦截这些事件，并在后台使用 `fetch` API 获取页面内容，获取完成后再进行 DOM 的替换：

```html
<body
  hx-boost:inherited="true"
  hx-indicator:inherited="#global-loading-pbr"
  class="flex min-h-dvh flex-col bg-background pb-page"
>
  {{- partialCached "components/loading-pbr.html" "emptyContext" -}}
  <!-- ... -->
</body>
```

因为指定了 `hx-indicator` 为我的自定义进度条，所以在后台加载的过程中，htmx 会给 `#global-loading-pbr` 元素添加 `htmx-request` class 使其在 Viewport 顶部显示。其中的 `_partials/components/loading-pbr.html` 实现为：

```html
<div
  id="global-loading-pbr"
  class="htmx-indicator fixed inset-x-0 top-0 z-50 h-1 w-1/3 animate-indeterminate-pbr rounded-full bg-primary"
></div>
```

相关 CSS 动画实现为：

```css
@theme {
  --animate-indeterminate-pbr: indeterminate-pbr 1s linear infinite;
}

@keyframes indeterminate-pbr {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(500%);
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
    scroll-behavior: auto !important;
  }
}
```

同时注意 `main.js` 的 `htmx.config.transitions = true` 启用了平滑的 View Transition。

#### 文章列表点击加载

其实默认的分页已经足够了，但是我就是想要做一点有意思的东西（炫技）。需要实现的效果是点击 `Load More ...` 后，下一页的文章追加到现有文章列表末尾。

在上文我们已经看到了 `_partials/views/main-sections.html` 的实现，其中有文章列表容器 `<div>` 已经带有 `#entry-sections`，同时这个容器内还有一个 `<div>` `#extra-wrapper`。实际上，这个 `#extra-wrapper` 就是用来放置 `Load More ...` “按钮”的。实际上的实现在 `_partials/components/pagination.html`：

```gotmpl
<div class="flex justify-center gap-stack">
  {{- if $.HasPrev -}}
    {{- partial "components/buttons/normal.html" (dict
      "title" "Go Previous"
      "link" $.Prev.URL
      "type" "neutral")
    -}}
  {{- end -}}

  {{- if $.HasNext -}}
    <!-- prettier-ignore-start -->
    {{- partial "components/buttons/normal.html" (dict
      "title" "Load More ..."
      "link" $.Next.URL
      "type" "primary"
      "extraAttrs" (dict
        "hx-get" $.Next.URL
        "hx-push-url" "true"
        "hx-swap" "outerHTML"
        "hx-select" "#entry-sections > *"
        "hx-target" "#extra-wrapper"))
    -}}
    <!-- prettier-ignore-end -->
  {{- end -}}
</div>
```

其中 `hx-swap="outerHTML"` 和 `hx-target="#extra-wrapper"` 配置了点击后将整个 `#extra-wrapper` 分页组件区域替换为新片段，这里的新片段选择的是返回的响应 HTML 中的 `#entry-sections`，即下一页的文章列表和下一页的分页组件。

Htmx 对于 `hx-get` 请求默认是当作按钮来处理的，地址栏不会发生变化，也无法前进后退。但是我希望这里的行为可以和无 htmx 增强时发生页面跳转的行为尽可能一致，所以我添加了 `hx-push-url="true"`，这样 htmx 就会在请求后修改地址栏为下一页的 URL。

这样做的缺点是地址栏变化和 `Load More ...` 的语义有所冲突。按理来说，旁边的 `Go Previous` 按钮也不应该存在。不过我想到用户如果刷新页面，那么就会直接回到第一页，回看文章列表会更麻烦。如果保留地址栏变化，刷新页面就是回到指定的分页，`Go Previous` 和 `Load More ...` 也仍然可以起到分页移动的功能。我觉得这是一个更值得保留的体验。

当然，当用户点击 `Go Previous` 时，触发的是真正的页面跳转，新页面中所有的非本页文章列表都会丢失。我之前也考虑过把这个按钮实现为直接删除本页的内容、回到上一页的文章列表位置，但是如果用户先刷新页面，存在的文章列表就只有真正属于本页的了，这时候再删除本文列表，就不再剩下任何东西了，所以我最终也没有选择这个方案。

## 内容管理

### 分类和标签管理

Hugo 的 Taxonomy 机制实际上就是一个扁平化的标签系统，可以给每个文章按照不同的维度添加标签列表。不过我还是选择了传统的分类和标签混合的模式，每篇文章只有一个分类和各种各样的标签。

理论上另外一种可行的使用方法是细分类别，每个类别作为 Taxonomy，类别内有各自的 Term。比如 Taxonomy 可以用 `by-language`、`by-speciality`、`by-domain` 等等，不过我感觉这种划分方式还是比较烧脑，且旧文章还需要迁移，所以就算了。

在此之前，我给文章加标签都是想到哪个就加哪个，所以标签命名比较混乱。因此我想到了一种中心化管理分类和标签的机制。我在 `hugo.yaml` 中添加了额外参数 `params.categories` 和 `params.tags`。在每一篇文章的模板中，调用以下验证逻辑 `_partials/components/posts/validation.html`：

```gotmpl
{{- range $taxonomy := slice "categories" "tags" -}}
  {{- range $term := $.GetTerms $taxonomy -}}
    {{- if not (collections.In (index site.Params $taxonomy) $term.LinkTitle) -}}
      {{- errorf "Page %q refers to a non-existent term %q in taxonomy %q" $.Path $term.LinkTitle $taxonomy -}}
    {{- end -}}
  {{- end -}}
{{- end -}}
```

这样每一篇文章就不可能引用不存在的分类和标签了。在给文章添加标签时，就可以去 `hugo.yaml` 中检查有没有已有的可以使用的标签。

### 分类设计

以前我的分类比较粗糙，在 OI 时代的文章都是 `Algorithm Competition`，而后来的文章都是 `Tech`。这样的分类感觉没有什么意义，所以我重新设计了一套分类方式：

- `Experience`：尝鲜新工具、阅读新书籍等活动的体验和感受。
- `Guide`：比较详细的、最终目标和成果比较明确的实践教学。
- `Note`：对已有知识的记录和总结。
- `Showcase`：新项目的介绍和展示。
- `Thought`：对某些话题的看法和思考。

这样的分类感觉不多也不少，只划分最基本的文章性质，我目前还是比较满意的。

### 内容结构

我把以往的 `content/posts/<title>` 的结构改为了 `content/posts/<year>/<title>` 的形式，这样就解决了文章难以定位的问题。不按年份划分时，即使是 20 篇左右的文章列表都显得比较混乱。当然修改结构也需要记得添加 `aliases`，确保旧链接仍然有效。

这一次我还尝试加入了 Journals 板块，用于 microblogging。写作需要积累灵感，而 Journals 就比较适合在有一点想法时做一下记录。相比于 Posts，这里的内容不需要很正式，关键在于可以方便地记录。我同时也有在我的 [Telegram Channel](https://t.me/journalctl_xeu) 上更新，那里的内容会更加随意一些，所以我会先在那里初步发布，如果是比较有价值保留的内容，就再搬到这里。

Journals 相对细碎，发布也更加频繁，所以我选择使用 `content/<year>/<month>/<day>/<hour>-<minute>` 的目录结构。Journals 不需要有标题，所以就直接使用日期格式了：

```markdown
---
title: {{ time.Format `Monday, January 2, 2006 - 15:04` $.Date }}
date: {{ $.Date }}
draft: false
math: false
---

<!-- Content -->
```

## 总结

这一次重构博客真的收获满满，完全自己动手很有成就感，并且向掌握前端设计和相关技术又进了一步。
