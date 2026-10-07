# Rahti — VS Code Extension

Syntax highlighting and JSX-style component imports for Rahti `html!` templates
inside Rust files.

A Rahti template is one raw string of HTML, `html! {r##"…"##}`. Without this
extension it renders as one Rust string — tags, attributes, PulsePoint
bindings and script bodies all one color. This extension injects a TextMate
grammar into Rust files so the template's HTML and its dialects each get their
own color.

## What gets highlighted

| Syntax | Highlighted as |
| --- | --- |
| `<section class="…">` | HTML tags and attributes |
| `<Card title="…">` / `<slot />` | Component tags (PascalCase, distinct color) |
| `<>…</>` | Fragment roots |
| `@{rust_expression}` | Embedded Rust (server render) |
| `html! {r##"…"##}` | The template: its delimiters, and HTML until the `"##}` that closes it — exactly where rustc closes the raw string |
| `{javascript_expression}` | Embedded JavaScript (PulsePoint, browser render) — in text and as a quoted attribute value like `key="{item.id}"` |
| `<script>…</script>` | Plain JavaScript body, with `@{…}` Rust islands anywhere inside it; `@@{` stays a literal `@{` |
| `<style>…</style>` | CSS body |
| `pp-for`, `pp-ref`, `pp-style`, `pp-spread`, `pp-spa`, … | The authored PulsePoint attribute surface (distinct scope) |
| `pp-for="(item, index) in items"` | Loop DSL: variables and the `in` keyword |
| `pp-component`, `pp-owner`, `data-pp-*`, `pp-if`, … | Flagged **invalid** — runtime-managed internals and nonexistent `pp-*` names (PulsePoint has no `pp-if`/`pp-show`/`pp-else`/`pp-key`; use `hidden="{cond}"`, ternaries, and plain `key`) |
| `<token.provider value="{value}">` | Context-provider tags |
| `onclick="…"`, `oninput="…"` | Event attributes |
| Text | Plain HTML text — a quote or an apostrophe in it is just text — with `&#123;` entity references |
| `<!DOCTYPE html>`, `<!-- … -->` | Doctype and template comments. Markup inside a comment never opens a region |

A template nested inside `@{…}` (written with one fewer `#`) re-enters HTML
highlighting, so `Html::concat(items.iter().map(|item| html! {r#"<li>@{item}</li>"#}))`
works too, and its parent template carries on after it.

## Component imports

Inside `html!`, put the cursor on an unresolved PascalCase tag such as
`<Button />` and press **Ctrl+.** (Quick Fix). Choose an import to insert an
ordinary Rust `use` into the containing module:

```rust
use crate::components::forms::button::Button;
```

Typing `<` or requesting completion with **Ctrl+Space** also lists components.
Selecting a component completes its name and adds its import in one edit.
The existing Rust language service can stay enabled; no keybindings are replaced.

Component identity includes the directory, not just the function name. For
example, both of these appear as separate choices, labeled with their full paths:

```text
crate::components::forms::button::Button
crate::components::navigation::button::Button
```

Neither choice is preferred automatically. If `Button` is already in scope,
completion offers the other component with a free alias such as
`NavigationButton`, inserts `use ...::Button as NavigationButton;`, and updates
the selected tag and its matching closing tag. Existing explicit, grouped, and
aliased imports are respected; direct component-module glob imports are also
recognized. Imports in an unrelated function or inline module do not suppress
the quick fix.

Discovery follows Rahti's generated module convention: module-level
`#[component]` (including `#[rahti::component]`) functions with `pub` or
`pub(crate)` visibility under the current Cargo crate's `src/components/**/*.rs`.
One file can export several components. Saved file changes and unsaved edits in
open component files refresh the index. Other Cargo crates, generated `mod.rs`,
private functions, comments, strings, and script/style bodies are not import
candidates. No framework or generated files are modified.

This is a source-based importer, not a Rust type resolver: dependency-crate
exports, re-export traversal, inline component modules, restricted visibility
such as `pub(super)`, and conditional-compilation evaluation are not indexed.
Relative glob imports are not resolved. Rust Analyzer/rustc remain responsible
for semantic diagnostics. Open a Cargo project in a workspace to enable imports.

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

Open this extension folder in VS Code and press `F5` — an Extension
Development Host opens with the grammar and import providers loaded. Open your
Rahti application folder in that host, then open any `page.rs`,
`layout.rs`, or component file to see the highlighting. `examples/sample.rs`
in this folder exercises every syntax form.

To inspect what scope a token received: `Ctrl+Shift+P` →
*Developer: Inspect Editor Tokens and Scopes*.

The grammar tests tokenize real Rahti markup with the same grammars and
tokenizer VS Code uses, read from your installed VS Code — no npm packages.
They find a standard installation on their own; `VSCODE_APP` names an
editor's `resources/app` directory otherwise. Without one they skip and say
so; `RAHTI_GRAMMAR_REQUIRED=1` makes that a failure.

Run the dependency-free lexer, import, index, and VS Code provider contract tests
with Node.js 18 or newer:

```bash
node --test test/*.test.js
```

For a manual import check, create `src/components/forms/button.rs` and
`src/components/navigation/button.rs`, each exporting a `#[component] pub fn
Button() -> Html`. In a page, write `<Button />` inside `html!` and press Ctrl+.
on `Button`: both paths should appear. Select one and confirm the `use` is added.
Then request completion on another `<But` and choose the other path: it should
insert an aliased import. Undo restores the original document in one step.

## How it works

The extension contributes no language of its own. It contributes two
**injection grammars** targeting `source.rust`.
`syntaxes/rahti.injection.tmLanguage.json` takes over when the tokenizer meets
`html! {r##"`, until the `"##}` that closes it (the end back-references the
opening hashes, so it closes exactly where rustc closes the raw string),
delegating to the stock `source.rust`, `source.js`, and `source.css` grammars
for the embedded regions — so embedded code is colored by the same grammars as
standalone files, in any theme.
`syntaxes/rahti.script-island.injection.tmLanguage.json` finds
`@{rust_expression}` at any depth of embedded JavaScript (`pp.state(@{…})`,
`const x = @{…}`), where `html!` lifts it too.

rust-analyzer's semantic highlighting paints a whole string literal one color,
and VS Code lets semantic tokens override grammars, which would flatten a
whole template to string color. The extension therefore defaults
`rust-analyzer.semanticHighlighting.strings.enable` to `false`, the setting
rust-analyzer provides for exactly this; Rust strings are still colored by the
grammar. Set it back to `true` in your settings to override.

`src/extension.js` registers Rust quick-fix and completion providers using the
[VS Code extension API](https://code.visualstudio.com/api/references/vscode-api).
`src/components.js` handles markup context, component discovery, import scopes,
and edit planning without depending on VS Code. The runtime has no npm dependencies.
