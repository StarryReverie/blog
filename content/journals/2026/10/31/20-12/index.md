---
title: Saturday, October 31, 2026 - 20:12
date: 2026-10-31T20:12:08+08:00
draft: false
math: false
---

昨天和今天把博客的导航栏重写了一遍，实现了无 JS 的分级菜单。总体上效果不错，看不出来和 JS 实现的有什么区别。现在还没有增加过渡动画，但是我感觉比 JS 版本好实现。

我的导航栏分为桌面端和移动端两个形态，给两个平台单独实现比同一个结构应用不同的样式要更加方便。其中的重点就是如何实现菜单的展开和折叠。我比较推荐的方法有两种。第一种是 `<details>` 和 `<summary>` 的方法。在 `<details>` 中，标题放在 `<summary>` 中，剩下的可以展开和折叠的部分放在 `<summary>` 后面。

这种方法的好处是 `<details>` 自带点击切换显示功能，`<details>` 中的除了 `<summary>` 以外的元素都在 `::details-content` 伪元素中。默认情况下 `<summary>` 会带有一个小箭头，不过这是因为 `<summary>` 默认的 `inline` 模式带有 `::marker` 伪元素，只要改为 `block` 或其他就消失了。另外一个缺点就是 `::details-content` 的切换时瞬时的，不好做过渡，且 `::details-content` 属于 baseline 2025 特性，慎用。

这里在 `<details>` 上加 `group`，内部用 `group-open:` 来给打开的状态提供不同的样式。`scale-y-100` 和 `-scale-y-100` 配合过渡实现了箭头翻转动画。`::details-content` 部分用 `absolute left-1/2 z-20 -translate-x-1/2` 使菜单项部分独立悬浮出来，并与菜单按钮保持水平居中。以下代码实际上是在一个循环中的，因此多个 `<details>` 都会带有同一个 `name="submenus"`，就可以实现最多只有一个菜单展开。

```html
<details class="group relative" name="submenus">
  <summary
    class="flex gap-1 rounded-sm p-control text-fl-body leading-none font-bold text-foreground transition-colors duration-400 hover:bg-background"
  >
    <span class="scale-y-100 transition-transform duration-200 group-open:-scale-y-100">
      {{- partialCached "components/content/icon.html" (dict "name" "chevrons-down") "chevrons-down" -}}
    </span>
    <span class="select-none">{{ $name }}</span>
  </summary>

  <ul
    style="--color-card-active: color-mix(in srgb, var(--card) 80%, light-dark(white, black))"
    class="absolute left-1/2 z-20 -translate-x-1/2 rounded-sm bg-(--color-card-active) p-control"
  >
    {{- range $subEntry := $children -}}
      <li>
{{- $subName := or (and $subEntry.Identifier (T $subEntry.Identifier)) $subEntry.Name -}}
<a
  href="{{ $subEntry.URL }}"
  class="block rounded-sm p-control text-fl-body leading-none font-bold text-foreground transition-colors duration-400 hover:bg-background"
  >{{ $subName }}</a
>
      </li>
    {{- end -}}
  </ul>
</details>
```

第二种方法是使用 `<input type="checkbox">` 和 `peer-checked:` 来控制显示。Checkbox 可以存储状态，而我们可以隐藏这个 checkbox 本身，用另外一个关联的 `<label>` 作为按钮。菜单项部分是单独的元素，可以比较随意地放置。这是这种方法比 `<details>` 更灵活的地方。

这种方法还可以实现展开和折叠过渡动画。即使菜单项元素不好实现动画，也可以把它包装进恰好一个格子的 `grid` 单元格中，间接控制这个单元格的高度并应用过渡，就可以实现泛用的动画了。`grid-template-rows` 为 `0fr` 时就是不显示，`1fr` 就是恢复原高度。注意其中的 `grid` 单元格元素需要设置 `overflow-hidden`，因为单元格高度变化肯定要挤压内部菜单项的，需要隐藏溢出的部分。

使用一个 checkbox 控制一个菜单的展开，多个菜单就要多个 checkbox，这些 checkbox 之间是相互独立的，所以无法控制最多一个菜单展开。

注意 `peer` 状态的声明要在使用之前，也就是 checkbox 需要在菜单元素的前面，这取决于文档解析的顺序，只能引用之前声明过的 `peer`。

```html
<div class="group">
  {{- $checkboxId := printf "mobile-menu-%s" (strings.ReplaceRE ` \"\n\t` "-" $name) -}}
  <input type="checkbox" id="{{ $checkboxId }}" name="{{ $checkboxId }}" class="peer hidden" />

  <label
    for="{{ $checkboxId }}"
    class="flex gap-1 rounded-sm p-control text-fl-body leading-none font-bold text-foreground transition-colors duration-400 hover:bg-background"
  >
    <span class="scale-y-100 transition-transform duration-200 group-open:-scale-y-100">
      {{- partialCached "components/content/icon.html" (dict "name" "chevrons-down") "chevrons-down" -}}
    </span>
    <span class="select-none">{{ $name }}</span>
  </label>

  <div class="grid grid-rows-[0fr] transition-[grid-template-rows] duration-200 peer-checked:grid-rows-[1fr]">
    <ul class="overflow-hidden pl-component">
      {{- range $subEntry := $children -}}
        <li>
          {{- $subName := or (and $subEntry.Identifier (T $subEntry.Identifier)) $subEntry.Name -}}
          <a
            href="{{ $subEntry.URL }}"
            class="flex gap-1 rounded-sm p-control text-fl-body leading-none font-bold text-foreground transition-colors duration-400 hover:bg-background"
          >
            <span>{{- partialCached "components/content/icon.html" (dict "name" "link") "link" -}}</span>
            <span>{{ $subName }}</span>
          </a>
        </li>
      {{- end -}}
    </ul>
  </div>
</div>
```
