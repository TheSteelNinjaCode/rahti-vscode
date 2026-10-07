# Changelog

## 0.0.7 — 2026-10-07

- JSX-style Ctrl+. component import quick fixes inside `html!` markup.
- Component tag completion with automatic Rust `use` edits.
- Full-path choices for same-named components in different directories;
  completion adds a collision-free alias when needed and keeps paired tags aligned.
- Cargo-crate-scoped indexing, nested component directories, multiple components
  per file, and refreshes for unsaved edits and filesystem changes.
- Scope-aware handling of existing explicit, grouped, aliased, and direct
  component-module glob imports, with preservation of module docs and attributes.
- Dependency-free unit and VS Code provider contract tests.
- Highlights templates as Rahti writes them: markup as Rust tokens,
  `html! { … }`, closed at the macro's own brace. Quoted text is text, `{…}`
  bindings and `onclick={…}` handlers are JavaScript, `@{…}` is Rust, and Rust
  comments are comments. A template nested in `@{…}` re-enters markup.
- `<script>r##"…"##</script>` bodies are JavaScript and `<style>r##"…"##</style>`
  bodies CSS, each closing exactly where rustc closes the raw string.
- Flags what `html!` refuses: a quoted handler, a script or style body with
  fewer than two `#`s, and a body written as tokens.
- `@{…}` Rust islands are found at any depth of a script body, such as
  `pp.state(@{Json(&items)})` or `const x = @{…}`.
- Defaults `rust-analyzer.semanticHighlighting.strings.enable` to `false`, so
  rust-analyzer's string coloring does not paint over script and style bodies.
- Grammar tests that tokenize with the grammars and tokenizer of the installed
  VS Code, still with no npm dependencies.

## 0.0.3 — 2026-08-13

Rust comments inside `html!`.

- `// line` and `/* block */` comments — including nested block comments — are
  now recognized inside the macro, both between nodes and between a tag's
  attributes. `html!` is a proc macro, so the Rust lexer strips these before
  the macro ever sees them; they are legal anywhere inside the template.
- Fixes highlighting collapsing from a comment onward. The grammar previously
  read comment text as markup, so a comment mentioning `` `<script>` `` opened
  a JavaScript region that ran to the next real `</script>` — swallowing the
  tags, text, and script in between. Prose mentioning `<head>`, a stray `"`,
  or a `{brace}` misfired the same way.

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
