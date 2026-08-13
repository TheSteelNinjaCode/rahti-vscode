# Changelog

## 0.0.2 — 2026-08-12

Aligned with the real PulsePoint convention (`docs/conventions/pulsepoint.md`).

- Removed the invented `pp-if`/`pp-key` from the attribute surface — PulsePoint
  has no `pp-if`, `pp-show`, `pp-else`, or `pp-key`.
- The authored `pp-*` set is now the documented one: `pp-for`, `pp-ref`,
  `pp-style`, `pp-spread`, `pp-spa`, `pp-reset-scroll`, `pp-scroll-key`,
  `pp-loading-content`, `pp-loading-transition`.
- Runtime-managed internals (`pp-component`, `pp-owner`, `pp-ref-owner`,
  `pp-ref-forward`, `data-pp-*`) and any other unknown `pp-*` name are flagged
  as invalid — they must never be handwritten.
- `{expression}` inside quoted attributes (`key="{item.id}"`,
  `pp-style="{cssText}"`) and quoted text now highlights as embedded
  JavaScript, matching the binding surface.
- `pp-for="(item, index) in items"` loop DSL: variables and the `in` keyword.
- Tag names may contain dots, for `<token.provider>` context providers.

## 0.0.1 — 2026-08-12

Initial release.

- Injection grammar into `source.rust` for `html! { … }` blocks.
- HTML tag, attribute, doctype, comment, and entity-reference highlighting.
- PascalCase component tags and `<>…</>` fragment roots.
- `@{…}` server interpolation highlighted as embedded Rust (with nested
  `html!` re-entry).
- `{…}` PulsePoint bindings highlighted as embedded JavaScript.
- Raw-text `<script>` bodies as JavaScript (with `@{…}` islands) and
  `<style>` bodies as CSS.
- Distinct scopes for `pp-*` and `on*` event attributes.
