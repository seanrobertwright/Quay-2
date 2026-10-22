# HTML and CSS

> **Load when:** writing, reviewing, or debugging HTML markup, server or
> client templates, or the element structure of JSX, or any CSS (plain
> stylesheets, CSS modules, Sass, utility classes): the document skeleton and
> metadata, semantic elements and landmarks, headings, lists, tables, forms and
> validation, buttons, links, dialogs and popovers, images, the cascade,
> specificity and layers, grid and container-query layout, sizing units,
> typography, color and dark mode, focus styles, animation, or deciding whether
> a newer platform feature is safe to ship.
> **See also:** [Accessibility](accessibility.md),
> [Web performance](web-performance.md),
> [Front-end components and state](components-and-state.md),
> [JavaScript and TypeScript](../languages/javascript-typescript.md),
> [Application and API security](../security/application-security.md),
> [Testing](../testing/testing.md),
> [Continuous integration and delivery](../devops/ci-cd.md)

## Top rules

1. **Pick the element for what the content means, never for how it looks.**
   Use landmarks, headings, lists, tables, `<button>`, and `<a href>` for their
   defined purpose; styling belongs in CSS, and `<div>` or `<span>` expose no
   role. *[HTML Standard: Semantics; Learn HTML: Semantic HTML]*
2. **Use a native element before any ARIA.** A `div` with `role="button"` gets
   no focus and no Enter or Space activation; a real `<button>` has both.
   Never add a role that repeats or overrides a native one.
   *[Using ARIA: Rules 1 and 2; Learn HTML: Semantic HTML]*
3. **Give every control an accessible name.** Every input, select, and
   textarea has a `<label>`; every icon-only button has visible or visually
   hidden text or an `aria-label`; every `<img>` has an `alt` (empty when
   decorative). *[Learn HTML: Forms; Learn HTML: Images; MDN: button;
   Review lessons]*
4. **Escape every value interpolated into HTML, and allow only `http`,
   `https`, `mailto`, and relative URLs in generated `href` and `src`.**
   Unescaped text and `javascript:` links are script injection. Set a
   Content-Security-Policy on every page. *[Review lessons]*
5. **Never remove the focus outline without an equally visible replacement.**
   Style focus with `:focus-visible` and `outline` plus `outline-offset`;
   `box-shadow` alone vanishes in forced-colors mode. *[Learn CSS: Focus]*
6. **Never disable zoom.** Use `width=device-width` in the viewport meta and
   never `user-scalable=no` or a `maximum-scale` below 5.
   *[MDN: viewport meta]*
7. **Keep specificity low and flat, and order the cascade with `@layer`.**
   No ID selectors for styling, no long chains, `!important` only as a last
   resort; declare the layer order once so later layers win without
   specificity fights. *[Learn CSS: Specificity; MDN: @layer]*
8. **Keep DOM order equal to reading and focus order.** Do not reorder with
   `order`, dense grid packing, or placement, and never use a positive
   `tabindex`. *[Learn CSS: Grid; Learn CSS: Focus; HTML Standard: tabindex]*
9. **Set `width` and `height` on every `<img>` and never lazy-load the LCP
   image.** Reserved aspect ratio prevents layout shift; a lazy hero image
   delays the largest paint. *[Learn Images: Performance issues]*
10. **Check Baseline status before using a newer feature.** "Widely
    available" needs no fallback for most sites; "newly" or "limited" needs
    progressive enhancement. *[web.dev Baseline]*

## Document skeleton and metadata

- **Start every page with the doctype, `<html lang>`, a UTF-8 charset meta as
  the first child of `<head>`, a viewport meta, and a `<title>`.** These give
  correct parsing, mobile layout, and screen reader pronunciation. Set language
  with `lang`, not a `content-language` pragma. *[Learn HTML: Metadata]*
- **Fix horizontal overflow rather than reaching for viewport scale
  settings.** See Tensions on `initial-scale=1`. *[MDN: viewport meta]*
- **Declare supported schemes with `<meta name="color-scheme">` before any
  CSS and with `color-scheme` on `:root`.** The meta prevents a wrong-scheme
  flash; the property themes scrollbars, form controls, and system colors.
  *[MDN: color-scheme]*
- **Respect content models.** Never put a `<form>`, list, or other block
  inside a `<p>`: the parser closes the paragraph early and the DOM no longer
  matches the source. Only `<li>` (plus `<script>` and `<template>`) may be a
  direct child of `<ul>` or `<ol>`. *[Review lessons; Learn HTML: Lists;
  HTML Standard: Semantics]*
- **Keep every `id` unique in its tree, non-empty, and without whitespace.**
  Duplicates break `label[for]`, `aria-*` references, and fragment links. In
  reusable components generate per-instance ids (React `useId()` or the
  framework equivalent), never fixed strings.
  *[HTML Standard: Global attributes; Review lessons]*

## Semantics, landmarks, headings, lists, tables

- **Replace wrapper `<div>`s with `<header>`, `<nav>`, `<main>`, `<aside>`,
  `<footer>`, `<article>`, and `<section>`.** Landmarks let screen reader users
  jump between regions. *[Learn HTML: Semantic HTML]*
- **Use exactly one `<main>` per page, and remember that `<header>` and
  `<footer>` become page landmarks only at the top level.** Inside an
  `<article>` or `<section>` they label that section; check this when nesting
  components. *[Learn HTML: Headings and sections]*
- **Use `<article>` for self-contained content, `<section>` for a themed group
  with its own heading, and `<div>` when neither fits.** Name a section only
  when the extra landmark helps navigation. *[Learn HTML: Headings and sections]*
- **Build one heading outline: a single `<h1>`, no skipped levels, and never
  pick a level for its font size.** Users navigate by headings; size comes
  from CSS. *[Learn HTML: Headings and sections]*
- **Mark up every group of items as a list, including nav bars.** Nest
  sub-lists inside an `<li>`; use `<dl>` for term and value pairs. When you set
  `list-style: none` or `display: grid` on a list, decide whether to restore
  `role="list"` for Safari and VoiceOver. *[Learn HTML: Lists]*
- **Use `<table>` only for tabular data.** Give it a `<caption>` (or
  `aria-labelledby`), group rows with `thead`, `tbody`, and `tfoot`, use
  `<th scope>`, use `headers` and `id` in complex tables, and keep spans
  minimal. If CSS `display` changes strip table or list roles, restore them.
  *[Learn HTML: Tables; Learn HTML: Lists]*
- **Cap or paginate every rendered list and table.** Ask what happens at ten
  thousand rows: paginate, window, or virtualize instead of rendering all of
  them, and do not recompute expensive derivations on every render.
  *[Review lessons]*
- **Render dates in `<time datetime>` with a value from the project's single
  date helper, and give every time-of-day value an explicit offset or `Z`.**
  Never format "today" from a timezone-less string in the template.
  *[Review lessons]*

## Buttons, links, and interactive state

- **Use `<button>` for in-page actions and `<a href>` for navigation.** Never
  nest interactive elements: no button in a link, link in a button, or link
  inside a `<label>`. *[Learn HTML: Links; MDN: button]*
- **Give every non-submitting `<button>` an explicit `type="button"`.** A bare
  button inside a form submits it. Avoid `type="reset"`. *[MDN: button]*
- **Mark the icon inside an icon-only button `aria-hidden="true"` and name the
  button itself.** Prefer visible or visually hidden text over `aria-label`.
  Make targets at least 44 by 44 CSS pixels. *[MDN: button; Review lessons]*
- **Use the role that matches the behavior.** `aria-pressed` for toggle
  buttons (not `aria-checked` or `aria-selected`), `role="radio"` in a
  `radiogroup` for exclusive choices, `aria-current="page"` for the current
  nav link, and no `role="tab"` unless you implement the APG tabs keyboard
  pattern (arrow keys move between tabs, Tab leaves the list).
  *[MDN: button; ARIA APG: Tabs; Review lessons]*
- **Keep `aria-expanded` and `aria-controls` true to what is on screen,**
  including a popup that opened with no results. *[Review lessons]*
- **Write link text that says where the link goes, and mark links by more than
  color.** Avoid "click here"; underline or add another cue. Warn when a link
  opens another app (`mailto:`, `tel:`), add `download` for files meant to be
  saved. *[Learn HTML: Links]*
- **Make every custom widget fully keyboard operable, and never put
  `aria-hidden="true"` or `role="presentation"` on a focusable element or its
  ancestor.** Otherwise keyboard users land on something nobody announces.
  *[Using ARIA: Rules 3 and 4]*
- **Do not use `hidden` for content that is only out of view in this layout,
  such as an inactive tab panel you still want discoverable.** `hidden`
  removes it from every presentation. Never point a visible `label[for]` or a
  link at hidden content. *[HTML Standard: The hidden attribute]*
- **Apply `inert` only to regions that also look obscured, and use `disabled`
  for single form controls.** *[HTML Standard: The inert attribute]*

## Dialogs and popovers

- **Build modals with `<dialog>` and `showModal()`, not by toggling `open` or
  hand-rolling an overlay.** `showModal()` makes the page inert, exposes
  `aria-modal`, closes on Esc, and provides `::backdrop`. Never put `tabindex`
  on the `<dialog>` itself. *[MDN: dialog]*
- **Put `autofocus` on the control the user most likely needs first (the close
  button if none stands out), and always include a visible close or cancel
  button.** Close with a `method="dialog"` form and read `returnValue`; set
  `closedby` on purpose. *[MDN: dialog]*
- **Use the `popover` attribute for menus, tooltips, and other non-blocking
  transient UI, and pick `auto`, `manual`, or `hint` on purpose.** Popovers
  render in the top layer, so no z-index tricks. *[MDN: Popover API]*
- **Prefer declarative invokers (`popovertarget`, or `commandfor` with
  `command`) over script.** `popovertarget` sets an implicit `aria-expanded`
  and returns focus to the invoker on Esc. If you call `showPopover()`, set
  `aria-expanded` yourself and check `:popover-open` first, since showing an
  open popover throws. *[MDN: Popover API; MDN: button]*

## Forms

- **Label every control with `<label for>` or a wrapping `<label>`, and keep
  interactive content out of labels.** *[Learn HTML: Forms; Review lessons]*
- **Use the most specific input `type` and add `autocomplete` tokens.** The
  type picks the mobile keyboard; autofill helps everyone, especially users
  with motor or cognitive impairments. *[Learn HTML: Forms]*
- **Group radios and checkboxes in a `<fieldset>` with a `<legend>` that says
  when the group is required.** One shared `name` per radio group; an explicit
  `value` on every checkbox, since the default is `on`. *[Learn HTML: Forms]*
- **Declare constraints with `required`, `min`, `max`, `step`, `minlength`,
  `maxlength`, and `pattern`, and validate again on the server.** Client
  constraints are a usability aid, not a security boundary. Send sensitive
  data with `POST`, never `GET`.
  *[Learn HTML: Forms; Review lessons]*
- **Do not hide or fake-disable the submit button until the form is valid.**
  That suppresses the browser's validation messages. Put `formnovalidate` on
  cancel and save-draft buttons. *[Learn HTML: Forms]*
- **Show a field's error after the user leaves it, naming the field and the
  problem.** After `setCustomValidity()`, reset it to `""` once the value is
  valid or the form can never submit. *[Learn HTML: Forms]*

## Generated HTML and page security

- **Escape at the sink with the template engine's auto-escaping, and give
  every raw-HTML escape hatch a sanitizer and a stated reason.** Reject
  `javascript:` and `data:` URLs per Top rule 4. *[Review lessons]*
- **Send a Content-Security-Policy, and never disable it in desktop shells
  such as Tauri or Electron.** *[Review lessons]*

## Images and media

- **Write `alt` for what the image conveys in context, not what it looks
  like.** Use `alt=""` for decorative images or when nearby text already says
  it; name an icon's function ("Search"); never start with "image of".
  *[Learn HTML: Images]*
- **Pair the `width` and `height` attributes with CSS `max-width: 100%` and
  `height: auto`.** *[Learn Images: Performance issues]*
- **Lazy-load below-the-fold images with `loading="lazy"`; give the likely LCP
  image `fetchpriority="high"`.** Images revealed only after interaction can
  take `fetchpriority="low"`. *[Learn Images: Performance issues]*
- **Generate `srcset` width candidates with a build tool or CDN, and write
  `sizes` in viewport terms with the default last.** Candidates differ only in
  width; keep a sensible `src` fallback and sizes large enough for high-DPR
  screens. A `sizes` too small blurs, too large wastes bytes.
  *[Learn Images: Descriptive syntax]*

## Cascade, specificity, and CSS architecture

- **Declare the full layer order once at the top, then put every rule in a
  layer.** For example `@layer reset, base, components, utilities;`. Import
  third-party CSS into its own layer with `@import url(...) layer(vendor)`.
  *[MDN: @layer]*
- **Know the two layer traps.** Unlayered styles beat all layered normal
  styles, and `!important` reverses layer order so the first layer wins. A
  stray unlayered rule or a low-layer `!important` silently overrides.
  *[MDN: @layer]*
- **Wrap resets and library defaults in `:where()` so they have zero
  specificity.** `:is()`, `:not()`, and `:has()` take the specificity of their
  most specific argument, so one ID inside raises the whole selector.
  *[Learn CSS: Specificity; MDN: :has()]*
- **Fix an over-specific rule instead of out-specifying it.** Avoid inline
  `style` attributes on anything a stylesheet must override, since they beat
  every selector. *[Learn CSS: Specificity]*
- **In native nesting, write `&` for compounds (`&.active`, `&:hover`) and
  never Sass-style concatenation such as `&__item`.** Without `&` you get a
  descendant selector; concatenation is invalid and the block is dropped
  silently. `&` carries `:is()` specificity; put declarations before nested
  rules. *[MDN: CSS nesting]*
- **Anchor `:has()` narrowly and limit its inner selector with `>` or `+`.**
  Avoid `body:has()`, `:root:has()`, and `*:has()`; broad anchors re-check large
  subtrees on every DOM change. *[MDN: :has()]*

## Layout and responsive sizing

- **Use media queries for page layout and container queries for reusable
  components.** Default to `container-type: inline-size`, and name containers
  when the target is not the nearest ancestor. *[Learn CSS: Container queries]*
- **Use grid for two-dimensional layout, `minmax(0, 1fr)` when columns must
  stay equal, and `gap` instead of margins on items.**
  `repeat(auto-fit, minmax(...))` gives responsive columns without media
  queries; use subgrid, not `display: contents`, on semantic elements.
  *[Learn CSS: Grid]*
- **Use logical properties (`margin-inline`, `padding-block`,
  `inset-inline-start`, `max-inline-size`, `text-align: end`).** Layout then
  follows `dir` and writing mode. *[Learn CSS: Logical properties]*
- **Size text in `rem` or `em`, leave the root font size unset, use unitless
  `line-height`, and cap measure near `60ch`.** A root `px` size overrides the
  user's font setting. *[Learn CSS: Sizing units]*
- **Choose `dvh`, `svh`, or `lvh` on purpose for full-height layouts instead
  of `100vh`.** `dvh` follows mobile browser UI as it shows and hides; `svh` and
  `lvh` stay fixed and avoid jumpy layouts. *[Learn CSS: Sizing units]*

## Typography, color, and dark mode

- **Set `font-display` on every `@font-face`, list `local()` before `url()`,
  subset with `unicode-range`, and end each `font-family` with a generic
  family.** *[Learn CSS: Typography]*
- **Use `text-wrap: balance` on headings and captions and `text-wrap: pretty`
  only on modest runs of body text.** Browsers balance only a few lines, and
  `pretty` costs layout time on long text. *[MDN: text-wrap]*
- **Define colors as custom properties from a few source colors and derive
  variants with `oklch()` relative color or `color-mix()`.** Check contrast on
  every derived pair: 4.5:1 for text, 3:1 for large text; watch for out-of-gamut
  high-chroma values. *[Learn CSS: Color; MDN: button]*
- **Implement dark mode with `color-scheme: light dark` plus `light-dark()` or
  `prefers-color-scheme` for your own tokens.** `color-scheme` alone themes
  only browser UI. *[MDN: color-scheme]*

## Motion and rendering cost

- **Animate `transform` and `opacity`, never `top`, `left`, `width`, or other
  layout properties.** Confirm in the DevTools Performance panel; add
  `will-change` only for a measured problem, never the `translateZ(0)` hack.
  *[web.dev Animations]*
- **Ship a `prefers-reduced-motion: reduce` override that replaces scaling,
  panning, and parallax with opacity or color changes.** Keep the same feedback,
  and match specificity so the override wins.
  *[MDN: prefers-reduced-motion]*

## Gates and review

- **Run an accessibility linter on markup (`eslint-plugin-jsx-a11y` or the
  framework equivalent) and a CSS linter in CI.** Never downgrade a
  correctness rule globally; scope a suppression to the one file.
  *[Review lessons]*
- **When you fix a markup or CSS defect, grep for the same pattern and fix
  every sibling in the same commit.** A missing `type="button"` or label rarely
  appears only once. *[Review lessons]*
- **Choose a Baseline year target for the project and check MDN status before
  adopting a feature.** Widely available means 30 months in every core
  browser. For CSS, declare the safe value first and the modern one second.
  *[web.dev Baseline; Learn CSS: The cascade]*

## Tensions

- **`initial-scale=1` in the viewport meta vs `width=device-width` alone.**
  Boilerplates include it; MDN calls it usually unnecessary. Either is fine;
  this library cares only that zoom is never restricted. *[MDN: viewport meta]*
- **One `<h1>` vs a new `<h1>` in every section.** The outline algorithm that
  would scope headings to sections was never implemented and was removed from
  the standard, and in May 2025 the standard also dropped the default style
  that shrank `<h1>` inside sectioning elements. House position: one `<h1>`
  and explicit ranks; treat section-scoped `<h1>` advice as dated.
  *[Learn HTML: Headings and sections; MDN: Heading elements]*
- **Restore `role="list"` only when it helps vs on every styled list.** web.dev
  says add it when the count or context matters; many practitioners add it to
  every styled nav list. House position: add it to navigation and content
  lists, not to layout grids; do not make it a lint rule.
  *[Learn HTML: Lists]*
- **Native popover and `<dialog>` features vs broad browser support.** Popover
  is Baseline newly available (early 2025); `hint` and `closedby` are newer.
  House position: use them with a fallback until they are widely available,
  and test focus return on dialog close in target browsers, since the MDN page
  does not document it. *[MDN: Popover API; MDN: dialog; web.dev Baseline]*

## Sources

- **HTML Standard**: WHATWG HTML Living Standard, DOM chapter (semantics,
  content models, global attributes) and User interaction chapter (`hidden`,
  `inert`, `tabindex`)
  (<https://html.spec.whatwg.org/multipage/dom.html>,
  <https://html.spec.whatwg.org/multipage/interaction.html>)
- **Using ARIA**: W3C, Using ARIA (Discontinued Draft, kept for its rules of
  ARIA use; the W3C now points to the APG for patterns)
  (<https://www.w3.org/TR/using-aria/>)
- **ARIA APG**: W3C WAI, ARIA Authoring Practices Guide, cited by pattern name
  (<https://www.w3.org/WAI/ARIA/apg/>)
- **Learn HTML**: web.dev Learn HTML course; sections cited by page title
  (<https://web.dev/learn/html>)
- **Learn CSS**: web.dev Learn CSS course; sections cited by page title
  (<https://web.dev/learn/css>)
- **Learn Images**: web.dev Learn Images course, Image performance issues and
  Descriptive syntax (<https://web.dev/learn/images>)
- **web.dev Baseline**: Baseline overview (<https://web.dev/baseline>)
- **web.dev Animations**: How to create high-performance CSS animations
  (<https://web.dev/articles/animations-guide>)
- **MDN**: MDN Web Docs reference pages, cited by page title (viewport meta,
  `color-scheme`, `<button>`, `<dialog>`, Using the Popover API, `@layer`,
  Using CSS nesting, `:has()`, `text-wrap`, `prefers-reduced-motion`, Heading
  elements)
  (<https://developer.mozilla.org/en-US/docs/Web>)
- **Review lessons**: rules distilled from the maintainer's code-review
  findings
