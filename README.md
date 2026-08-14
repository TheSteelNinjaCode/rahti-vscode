# Rahti — VS Code Extension

Syntax highlighting for Rahti `html!` templates inside Rust files.

Without this extension, everything inside `html! { … }` renders as plain Rust
tokens — tags, attributes, and PulsePoint bindings all look the same. This
extension injects a TextMate grammar into Rust files so the template dialects
each get their own color.

## What gets highlighted

| Syntax | Highlighted as |
| --- | --- |
| `<section class="…">` | HTML tags and attributes |
| `<Card title="…">` / `<slot />` | Component tags (PascalCase, distinct color) |
| `<>…</>` | Fragment roots |
| `@{rust_expression}` | Embedded Rust (server render) |
| `{javascript_expression}` | Embedded JavaScript (PulsePoint, browser render) — in text, unquoted attributes, and quoted attributes like `key="{item.id}"` |
| `<script>…</script>` | JavaScript body, with `@{…}` Rust islands inside |
| `<style>…</style>` | CSS body |
| `pp-for`, `pp-ref`, `pp-style`, `pp-spread`, `pp-spa`, … | The authored PulsePoint attribute surface (distinct scope) |
| `pp-for="(item, index) in items"` | Loop DSL: variables and the `in` keyword |
| `pp-component`, `pp-owner`, `data-pp-*`, `pp-if`, … | Flagged **invalid** — runtime-managed internals and nonexistent `pp-*` names (PulsePoint has no `pp-if`/`pp-show`/`pp-else`/`pp-key`; use `hidden={cond}`, ternaries, and plain `key`) |
| `<token.provider value="{value}">` | Context-provider tags |
| `onclick={…}`, `oninput={…}` | Event attributes |
| `"Quoted authored text"` | Strings, with escapes and `&#123;` entity references |
| `<!DOCTYPE html>`, `<!-- … -->` | Doctype and authored HTML comments |
| `// line`, `/* block */` | Rust comments — anywhere inside the macro, between nodes or between attributes. Their text is never read as markup |

Nested `html! { … }` blocks inside `@{…}` expressions re-enter HTML
highlighting, so patterns like `Html::concat(items.iter().map(|item| html! { <li>@{item}</li> }))`
work too.

## Install

### From a packaged .vsix

```bash
code --install-extension rahti-0.0.3.vsix
```

(Or in VS Code: Extensions panel → `…` menu → *Install from VSIX…*)

### Package it yourself

```bash
npx --yes @vscode/vsce package --allow-missing-repository
```

### Develop / test

Open this `vscode/` folder in VS Code and press `F5` — an Extension
Development Host opens with the grammar loaded. Open any Rahti `page.rs`,
`layout.rs`, or component file to see the highlighting. `examples/sample.rs`
in this folder exercises every syntax form.

To inspect what scope a token received: `Ctrl+Shift+P` →
*Developer: Inspect Editor Tokens and Scopes*.

## How it works

The extension contributes no language of its own. It contributes one
**injection grammar** (`syntaxes/rahti.injection.tmLanguage.json`) targeting
`source.rust`. When the tokenizer meets `html! {`, the grammar takes over
until the macro's closing brace, delegating to the stock `source.rust`,
`source.js`, and `source.css` grammars for the embedded regions — so embedded
code is colored by the same grammars as standalone files, in any theme.
