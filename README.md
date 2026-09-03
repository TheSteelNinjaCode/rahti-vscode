# Rahti — VS Code Extension

Syntax highlighting and JSX-style component imports for Rahti `html!` templates
inside Rust files.

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

The extension contributes no language of its own. It contributes one
**injection grammar** (`syntaxes/rahti.injection.tmLanguage.json`) targeting
`source.rust`. When the tokenizer meets `html! {`, the grammar takes over
until the macro's closing brace, delegating to the stock `source.rust`,
`source.js`, and `source.css` grammars for the embedded regions — so embedded
code is colored by the same grammars as standalone files, in any theme.

`src/extension.js` registers Rust quick-fix and completion providers using the
[VS Code extension API](https://code.visualstudio.com/api/references/vscode-api).
`src/components.js` handles markup context, component discovery, import scopes,
and edit planning without depending on VS Code. The runtime has no npm dependencies.
