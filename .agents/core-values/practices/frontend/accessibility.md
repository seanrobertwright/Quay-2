# Accessibility

> **Load when:** building, reviewing, or testing user-facing web UI (forms,
> buttons, links, images, dialogs, menus, tabs, tooltips, toasts, custom
> widgets); adding ARIA, keyboard handling, focus management, or live regions;
> choosing colors, focus styles, target sizes, or motion; or checking against
> WCAG 2.2 AA or fixing an accessibility lint or audit finding.
> **See also:** [HTML and CSS](../frontend/html-and-css.md),
> [Front-end components and state](../frontend/components-and-state.md),
> [Web performance](../frontend/web-performance.md),
> [Mobile apps](../mobile/mobile-apps.md),
> [Unit, integration, and TDD](../testing/testing.md),
> [Continuous integration and delivery](../devops/ci-cd.md),
> [Version control and code review](../core/version-control.md)

## Top rules

1. **Use the native HTML element whenever it gives the semantics and behavior
   you need; add ARIA only where HTML cannot.** A `<button>` is focusable and
   handles Enter and Space for free; a clickable `<div>` needs a role, a
   `tabindex`, and hand-written key handling. *[MDN HTML a11y; Using ARIA;
   ARIA in HTML]*
2. **Treat every ARIA role as a promise to implement that role's full keyboard
   contract.** A role changes only what assistive technology announces, never
   behavior; wrong ARIA is worse than none. Do not use `role="tab"`,
   `menu`, or `grid` unless you ship the matching key handling. *[APG Read Me
   First; Review lessons]*
3. **Give every input, select, and textarea a programmatic label, and every
   icon-only button an accessible name.** Without one a screen reader announces
   only "edit text" or "button". Never rely on `placeholder` or `title` as the
   name. *[web.dev Forms; APG Names; Review lessons]*
4. **Make every function operable by keyboard, keep focus visible, and never
   trap focus outside a modal.** Do a keyboard-only pass (Tab, Shift+Tab,
   arrows, Space, Enter, Escape) on every interactive change. *[WCAG 2.2;
   web.dev Manual testing; web.dev Focus]*
5. **Never leave focus on a removed element or let it fall to `<body>`.** When
   a dialog closes or an item is deleted, move focus to the trigger or the next
   logical item. *[APG Keyboard; APG Dialog]*
6. **Keep ARIA state attributes true to what is on screen.** `aria-expanded`,
   `aria-controls`, `aria-selected`, and `aria-pressed` must match the visible
   state, including a popup that opened with zero results. *[Review lessons;
   APG Tabs]*
7. **Give every `<img>` an `alt`: empty for decoration, the purpose for
   informative images, the action for functional ones.** A missing `alt` makes
   screen readers read the filename. *[web.dev Images; WCAG 2.2]*
8. **Meet contrast minimums and never use color as the only cue.** 4.5:1 for
   body text, 3:1 for large text, UI component boundaries, focus indicators, and
   meaningful graphics. *[WCAG 2.2]*
9. **Announce async status ("Saved", "3 results") through a live region that
   exists in the initial markup.** Regions injected at the moment of the update
   are often not announced. *[MDN Live regions; WCAG 2.2]*
10. **Treat a clean automated scan and a passing a11y lint as the floor, not
    proof.** Tools miss many failures; follow up with keyboard, zoom, and
    screen reader checks. *[web.dev Automated testing; Review lessons]*

## Semantics and ARIA

- **Pick the role by behavior, not by look.** Use `aria-pressed` for a toggle
  button, `role="radio"` inside a `radiogroup` (or native radios) for an
  exclusive choice, and `aria-current="page"` for the active navigation link,
  not `aria-selected`. *[Review lessons; ARIA in HTML]*
- **Do not restate implicit roles or override strong native ones.** No
  `role="button"` on `<button>`, no `role="main"` on `<main>`, never a
  non-interactive role on an interactive element, and never an abstract role
  such as `select`. *[ARIA in HTML]*
- **Let native state win; never duplicate it with ARIA.** No `aria-checked` on
  a checkbox or radio input, no `aria-selected` on `<option>`, no
  `aria-valuemin` on a range input. Two sources of truth drift apart.
  *[ARIA in HTML]*
- **Never put `aria-hidden="true"` or `role="presentation"` on a focusable
  element or its ancestor, and never on `<body>`.** Keyboard users land on
  something that is announced as nothing. Content under `display: none` or
  `visibility: hidden` is already hidden and needs no ARIA. *[Using ARIA; ARIA
  in HTML]*
- **Use real headings in a logical hierarchy and real lists.** Screen reader
  users navigate by heading. Keep DOM source order meaningful, because
  assistive technology follows source order even when CSS reorders the
  layout. *[MDN HTML a11y; WCAG 2.2]*
- **Put all content inside landmarks with exactly one top-level `main`.** Keep
  `banner`, `main`, `complementary`, and `contentinfo` at the top level. Give
  repeated landmarks distinct labels without the role word ("Site",
  "Breadcrumb", not "Site navigation"). A `<section>` is a region only when
  named. Wrap search in the HTML `<search>` element, falling back to
  `role="search"`. *[APG Landmarks]*
- **Set `lang` on `<html>` and on passages in another language, and give every
  page a descriptive `<title>`.** In a single-page app, update the title on
  every client-side route change; it is the first thing a screen reader
  announces. *[WCAG 2.2]*
- **Mark up data tables with `<caption>`, `<th>`, and `scope`.** Prefer a
  visible caption over the `summary` attribute. *[MDN HTML a11y]*

## Accessible names and descriptions

- **Name controls from visible text through native mechanisms first.** Use
  `<label>`, `<legend>`, `<caption>`, `<figcaption>`, or button content before
  `aria-label`; visible text stays in sync and gets translated with the UI.
  `aria-label` on an element named by its content hides that content.
  *[APG Names]*
- **Make the accessible name contain the visible label, ideally at the
  start.** Voice-control users speak what they see; a button reading "Send"
  named "Submit order form" breaks their command. *[WCAG 2.2]*
- **Keep names short, functional, unique on the page, and free of the role
  word.** "Save", not "Save button" or "Floppy icon". *[APG Names]*
- **Know the precedence: `aria-labelledby` beats `aria-label`, which beats
  native labelling and content.** `aria-labelledby` can join several ids and
  can point at hidden elements, but it does not chain. Do not name roles that
  prohibit names, such as `generic`, `paragraph`, `presentation`, and `code`.
  *[APG Names]*
- **Generate the ids that wire labels, descriptions, and `aria-controls` with
  the framework's id helper (`useId()` in React), never fixed strings.** A
  reusable component rendered twice with a hard-coded id points both labels at
  the first instance. *[Review lessons]*
- **Use `aria-describedby` for hints and constraints in plain sentences.**
  Descriptions are read after name and role; lists and tables inside them are
  flattened. *[APG Names; APG Dialog]*
- **Write link text that makes sense out of context.** Avoid "click here", and
  say when a link opens a new window or downloads a non-HTML file. *[MDN HTML
  a11y; WCAG 2.2]*

## Keyboard and focus

- **Never use a positive `tabindex`; control order through DOM order.**
  `tabindex="0"` joins the natural order and obliges you to add key handling;
  `tabindex="-1"` makes an element focusable by script only. *[APG Keyboard;
  web.dev Focus]*
- **Never remove the focus outline without a replacement that survives
  forced-colors mode.** Faint color shifts vanish there; use an outline, for
  example with the `Highlight` system color. *[web.dev Focus; APG Keyboard;
  WCAG 2.2]*
- **Keep sticky headers, footers, cookie banners, and non-modal panels from
  covering the focused element.** Use `scroll-padding` to clear sticky regions
  and let Escape dismiss user-opened overlays. *[Understanding 2.4.11]*
- **Give a composite widget one tab stop and move inside it with arrow keys.**
  This covers tablists, radio groups, menus, listboxes, grids, trees, and
  toolbars. Use roving `tabindex` or `aria-activedescendant` (then scroll the
  active item into view yourself), and make pointer clicks update the same
  state. *[APG Keyboard]*
- **Land Tab on the right item when entering a composite.** The selected item
  (or first) for radio groups, tabs, listboxes, and trees; the last-focused
  cell for grids; the first item for toolbars and menubars. *[APG Keyboard]*
- **Let selection follow focus only when activation is instant.** Tabs whose
  panels are already rendered can activate on arrow; tabs that fetch on switch
  need Enter or Space. *[APG Keyboard; APG Tabs]*
- **Choose `disabled` vs `aria-disabled` by discoverability.** Native
  `disabled` removes the control from the tab order (fine for "Previous" on
  page one); `aria-disabled="true"` keeps menu items, tabs, and toolbar
  buttons discoverable. *[APG Keyboard]*
- **Never change context on focus, or on input without warning.** No
  auto-submit, no navigation when a select changes, no surprise new window.
  *[WCAG 2.2]*
- **Provide a skip link first in the tab order, or landmarks and headings, to
  bypass repeated blocks.** The link may stay hidden until focused. *[web.dev
  Focus; WCAG 2.2]*
- **Let users turn off or remap single-character shortcuts, or scope them to a
  focused component.** Do not take keys reserved by the browser or assistive
  technology, and keep every shortcut target reachable by normal navigation.
  *[WCAG 2.2; APG Keyboard]*

## Forms and errors

- **Give every field a persistent visible label tied by `for`/`id` or by
  wrapping, and group related fields with `<fieldset>` and `<legend>`.** An
  associated label also enlarges the click target. *[web.dev Forms; MDN HTML
  a11y; WCAG 2.2]*
- **Add the correct `autocomplete` token to fields that collect the user's own
  data** (`email`, `given-name`, `street-address`, `tel`). *[WCAG 2.2; web.dev
  Forms]*
- **On a validation failure, name the field and describe the error and its fix
  in text.** Set `aria-invalid="true"` only after the user has interacted,
  link the message with `aria-describedby` (and `aria-errormessage` where your
  target screen readers support it), show it only while invalid, and announce
  it. *[WCAG 2.2; MDN aria-errormessage]*
- **Make legal, financial, or data-changing submissions reversible, checked,
  or confirmable before they are final.** *[WCAG 2.2]*
- **Never ask for the same information twice in one process.** Auto-fill it
  or offer it for selection, such as "billing same as shipping". *[WCAG 2.2
  New]*
- **Never block paste or password managers on password and one-time-code
  fields, and never make login depend on a memory or puzzle test without an
  alternative.** Passkeys, email links, and paste are acceptable. *[WCAG 2.2
  New]*
- **Keep repeated help (contact details, chat, self-help links) in the same
  relative order on every page of a set.** *[WCAG 2.2 New]*
- **Give every time limit a way to turn it off, extend it tenfold, or warn
  with at least 20 seconds to extend.** *[WCAG 2.2]*
- **Never nest a `<form>` inside a `<p>`.** The parser closes the paragraph
  early and the resulting tree differs from the source. *[Review lessons]*

## Dialogs, menus, and widgets

- **Build modals with native `<dialog>` and `showModal()`, not the `open`
  attribute.** `showModal()` makes the page inert, exposes modality, closes on
  Escape, and handles stacking; a custom modal must reproduce all of it,
  including `inert`. Never put `tabindex` on `<dialog>`. *[MDN dialog]*
- **Give a modal with required fields a Cancel button marked `formnovalidate`
  or closed from script.** Otherwise constraint validation blocks closing.
  *[MDN dialog]*
- **Choose a modal's initial focus by its content and return focus to the
  trigger on close.** Least destructive button for irreversible confirmations;
  the likely action for informational dialogs; a static heading with
  `tabindex="-1"` for long content. Always include a visible close or Cancel.
  *[APG Dialog; MDN dialog]*
- **Label every dialog, and set `aria-modal="true"` only when the outside is
  truly blocked.** Use `aria-labelledby` on its title. A false `aria-modal`
  hides usable content. *[APG Dialog]*
- **Use disclosure buttons, not `menu`/`menubar`, for site navigation.** Menu
  roles promise application-style keys that a list of links does not need.
  *[APG Disclosure Nav]*
- **If you do use `menu`/`menubar`, implement the whole contract.** Arrows
  move, Enter activates and closes, Escape closes and returns focus to the
  opener, Tab leaves and closes all menus. An item must not both navigate and
  open a submenu. *[APG Menu]*
- **Wire tabs completely.** Named `tablist`; each `tab` with `aria-controls`
  and `aria-selected`; each `tabpanel` with `aria-labelledby` and
  `tabindex="0"` when its first content is not focusable. Horizontal tablists
  ignore Up and Down. *[APG Tabs]*
- **Make hover and focus popups dismissible with Escape, hoverable, and
  persistent until dismissed.** Moving the pointer onto a tooltip must not
  close it. *[WCAG 2.2]*
- **Test custom widgets on every browser and screen reader pair you support,
  including mobile.** Only techniques that work there count toward
  conformance; APG examples target desktop only. *[APG Read Me First; WCAG 2.2]*

## Dynamic content and status messages

- **Put live regions in the initial markup and change their content later.**
  If script must create one, insert it empty and fill it in a later task. Use
  `aria-atomic="true"` when a partial update is meaningless, such as a clock.
  *[MDN Live regions]*
- **Use `role="status"` (polite) for routine messages and `role="alert"` only
  for urgent errors.** Alerts interrupt speech. Do not add
  `aria-live="assertive"` on top of `role="alert"`; some readers then announce
  twice. *[WCAG 2.2; MDN Live regions]*
- **Do not use a live region as a substitute for focus management.**
  Announcements are plain text; links or buttons inside them lose semantics.
  *[MDN Live regions]*
- **Announce loading and result counts for async searches and filters, and
  drop announcements from stale requests.** A response from an earlier query
  must not overwrite the announcement for the current one. *[Review lessons;
  WCAG 2.2]*
- **Cap or paginate long lists, and set `aria-setsize`/`aria-posinset` (or
  `aria-rowcount`/`aria-rowindex`) when only part of a list or grid is in the
  DOM.** Virtualized rows otherwise report the wrong total. *[Review lessons;
  WAI-ARIA 1.2]*

## Visual design, pointer, and motion

- **Pair color with a second cue.** Required fields, errors, link-versus-text,
  and chart series need text, an icon, an underline, or a pattern too.
  *[WCAG 2.2]*
- **Check contrast of text over images and gradients by hand.** Automated
  tools miss it. *[web.dev Manual testing; WCAG 2.2]*
- **Make layouts survive 200% text zoom, 320 CSS px reflow without two-way
  scrolling, and user text-spacing overrides.** Avoid fixed-height text
  containers and clipping `overflow: hidden`. Data tables and maps are exempt
  from reflow. Do not lock orientation unless it is essential. *[WCAG 2.2]*
- **Make pointer targets at least 24 by 24 CSS px, or space smaller ones so
  24 px circles around them do not overlap.** Inline links are exempt; aim for
  44 by 44 on primary controls. *[Understanding 2.5.8]*
- **Give every drag a single-pointer alternative, and every multipoint or path
  gesture a single-tap alternative.** This covers sortable lists, sliders,
  kanban cards, and map panning. *[WCAG 2.2 New; WCAG 2.2]*
- **Fire actions on pointer up, not down, unless the action can be aborted or
  undone.** Users cancel by sliding off. *[WCAG 2.2]*
- **Honor `prefers-reduced-motion`.** Replace scaling, panning, and looping
  motion with a fade or nothing, or apply motion only under `no-preference`.
  *[MDN reduced motion]*
- **Give pause, stop, or hide controls to anything that moves or auto-updates
  for more than 5 seconds, and never flash more than three times a second.**
  *[WCAG 2.2]*
- **Give informative inline SVGs `role="img"` and a `<title>`; hide
  decorative ones.** Use real text instead of images of text except for logos.
  *[web.dev Images; WCAG 2.2]*
- **Keep alt text short (about 150 characters) and never start with "image
  of".** Pair complex charts, maps, and diagrams with a long description via
  `<figure>`/`<figcaption>`, a link, or `aria-describedby`. *[web.dev Images]*

## Conformance, tooling, and review

- **Target WCAG 2.2 Level AA for every page, every responsive variant, and
  every step of a multi-step flow.** One failing step breaks conformance for
  the whole process. *[WCAG 2.2]*
- **Run an accessibility linter as an error-level gate** (`eslint-plugin-jsx-a11y`
  for JSX, or the framework's equivalent), plus an automated page scan such as
  axe or Lighthouse in CI. *[Review lessons; web.dev Automated testing]*
- **Never downgrade an a11y lint rule to `warn` globally.** Suppress it inline
  or per file with a reason. *[Review lessons]*
- **After fixing an a11y finding, grep the codebase for the same pattern and
  fix every sibling in the same change.** Missing labels, unlabeled icon
  buttons, and stale `aria-expanded` usually repeat across components.
  *[Review lessons]*
- **Check every a11y claim in comments, docs, and PR descriptions against the
  code.** "Fully keyboard accessible" in a docstring must match the key
  handling that ships. *[Review lessons]*

## Tensions

- **WCAG 2.2 vs WCAG 3.** WCAG 3 (Working Draft, September 2026) is not
  normative, will change, and will not replace WCAG 2 soon. This library gates
  on WCAG 2.2 AA and its 4.5:1 and 3:1 ratios. *[WCAG 3 Intro; WCAG 2.2]*
- **4.1.1 Parsing.** WCAG 2.2 removed it, and errata to 2.0 and 2.1 treat it
  as always satisfied for HTML; never report validator-only parse errors as
  WCAG failures. *[WCAG 2.2 New; WCAG FAQ]*
- **Focus appearance at AA.** web.dev cites a draft "Focus Appearance
  (Minimum)" criterion that did not survive into WCAG 2.2; the final 2.4.13 is
  AAA. House position: focus must be visible and not fully obscured (AA), and
  rings still meet 3:1 under 1.4.11. *[web.dev Focus; WCAG 2.2]*
- **Using ARIA vs ARIA in HTML.** The "rules of ARIA" note is a Discontinued
  Draft listing four rules; ARIA in HTML is the normative Recommendation. The
  rules still hold; cite ARIA in HTML and APG. *[Using ARIA; ARIA in HTML]*
- **APG menubar navigation vs disclosure navigation.** APG ships both: a
  menubar for site nav, and a disclosure example noting typical nav needs no
  menu keys. Use disclosure unless you build the full menu contract.
  *[APG Menu; APG Disclosure Nav]*
- **`aria-errormessage` vs `aria-describedby`.** Support for
  `aria-errormessage` has lagged; reference the error from `aria-describedby`
  as well until your target pairs are verified. *[MDN aria-errormessage]*
- **Automatic vs manual tab activation.** Automatic when panels are already
  rendered; manual when switching fetches or reloads. *[APG Tabs]*

## Sources

- **WCAG 2.2**: Web Content Accessibility Guidelines 2.2, W3C Recommendation (<https://www.w3.org/TR/WCAG22/>)
- **WCAG 2.2 New**: What's New in WCAG 2.2, W3C WAI (<https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/>)
- **Understanding 2.4.11**: Understanding SC 2.4.11 Focus Not Obscured (Minimum) (<https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html>)
- **Understanding 2.5.8**: Understanding SC 2.5.8 Target Size (Minimum) (<https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html>)
- **WCAG 3 Intro**: WCAG 3 Introduction and the September 2026 Working Draft notice, W3C WAI (<https://www.w3.org/WAI/standards-guidelines/wcag/wcag3-intro/>, <https://www.w3.org/WAI/news/2026-09-10/wcag3/>)
- **APG Read Me First**: ARIA Authoring Practices Guide, Read Me First (<https://www.w3.org/WAI/ARIA/apg/practices/read-me-first/>)
- **APG Keyboard**: ARIA APG, Developing a Keyboard Interface (<https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/>)
- **APG Names**: ARIA APG, Providing Accessible Names and Descriptions (<https://www.w3.org/WAI/ARIA/apg/practices/names-and-descriptions/>)
- **APG Landmarks**: ARIA APG, Landmark Regions (<https://www.w3.org/WAI/ARIA/apg/practices/landmark-regions/>)
- **APG Dialog**: ARIA APG, Dialog (Modal) Pattern (<https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/>)
- **APG Tabs**: ARIA APG, Tabs Pattern (<https://www.w3.org/WAI/ARIA/apg/patterns/tabs/>)
- **APG Menu**: ARIA APG, Menu and Menubar Pattern (<https://www.w3.org/WAI/ARIA/apg/patterns/menubar/>)
- **APG Disclosure Nav**: ARIA APG, Example Disclosure Navigation Menu (<https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/examples/disclosure-navigation/>)
- **WAI-ARIA 1.2**: Accessible Rich Internet Applications 1.2, W3C Recommendation (<https://www.w3.org/TR/wai-aria-1.2/>)
- **WCAG FAQ**: WCAG 2 FAQ, W3C WAI, entry on 4.1.1 Parsing (<https://www.w3.org/WAI/standards-guidelines/wcag/faq/>)
- **ARIA in HTML**: ARIA in HTML, W3C Recommendation (<https://www.w3.org/TR/html-aria/>)
- **Using ARIA**: Using ARIA, W3C Discontinued Draft (<https://www.w3.org/TR/using-aria/>)
- **MDN HTML a11y**: MDN, HTML: A good basis for accessibility (<https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Accessibility/HTML>)
- **MDN Live regions**: MDN, ARIA live regions (<https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Guides/Live_regions>)
- **MDN aria-errormessage**: MDN, aria-errormessage (<https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-errormessage>)
- **MDN dialog**: MDN, The Dialog element (<https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/dialog>)
- **MDN reduced motion**: MDN, prefers-reduced-motion (<https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion>)
- **web.dev Focus**: web.dev Learn Accessibility, Focus (<https://web.dev/learn/accessibility/focus>)
- **web.dev Forms**: web.dev Learn Accessibility, Forms (<https://web.dev/learn/accessibility/forms>)
- **web.dev Images**: web.dev Learn Accessibility, Images (<https://web.dev/learn/accessibility/images>)
- **web.dev Automated testing**: web.dev Learn Accessibility, Automated accessibility testing (<https://web.dev/learn/accessibility/test-automated>)
- **web.dev Manual testing**: web.dev Learn Accessibility, Manual accessibility testing (<https://web.dev/learn/accessibility/test-manual>)
- **Review lessons**: rules distilled from the maintainer's code-review findings
