---
title: 重构博客的总结
date: 2026-10-23T09:54:35+08:00
draft: true
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
