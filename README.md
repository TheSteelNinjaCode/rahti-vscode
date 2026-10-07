# Rahti — VS Code Extension

Syntax highlighting and JSX-style component imports for Rahti `html!` templates
inside Rust files.

A Rahti template is markup written as Rust tokens, `html! { … }`, and only a
`<script>` or `<style>` body is a string, always `r##"…"##`. Without this
extension the template renders as Rust — tags as operators, script bodies as
one string. This extension injects a TextMate grammar into Rust files so the
markup, its two dialects, and the script and style bodies each get their own
color, and flags the forms `html!` refuses.

## What gets highlighted

| Syntax | Highlighted as |
| --- | --- |
| `html! { … }` | The template: markup until the macro's own `}` |
| `<section class="…">` | HTML tags and attributes |
| `<Card title="…">` / `<slot />` | Component tags (PascalCase, distinct color) |
| `<>…</>` | Fragment roots |
| `"Hello"` | Text — a quoted string, apostrophes included, with `&#123;` entity references |
| `@{rust_expression}` | Embedded Rust (server render) |
| `{javascript_expression}` | Embedded JavaScript (PulsePoint, browser render) — in text and as an attribute value like `key={item.id}` |
| `onclick={save()}`, `oninput={…}` | Event attributes, with their handler as JavaScript |
| `<script>r##"…"##</script>` | Plain JavaScript body, with `@{…}` Rust islands anywhere inside it; `@@{` stays a literal `@{`. It closes exactly where rustc closes the raw string |
| `<style>r##"…"##</style>` | CSS body |
| `pp-for`, `pp-ref`, `pp-style`, `pp-spread`, `pp-spa`, … | The authored PulsePoint attribute surface (distinct scope) |
| `pp-for="(item, index) in items"` | Loop DSL: variables and the `in` keyword |
| `<token.provider value={value}>` | Context-provider tags |
| `<!DOCTYPE html>`, `// …`, `/* … */` | Doctype and Rust comments, which are not sent to the browser |

Flagged **invalid**, as `html!` refuses them at compile time:

| Written | Write instead |
| --- | --- |
| `onclick="save()"` | `onclick={save()}` — a handler is a binding |
| `<script>r#"…"#</script>`, `<script>r"…"</script>` | `<script>r##"…"##</script>` — a `"#` such as `"#fff"` would end the body |
| `<script>const a = 1;</script>` | `<script>r##"const a = 1;"##</script>` — a body is a raw string |
| `pp-component`, `pp-owner`, `data-pp-*`, `pp-if`, … | Runtime-managed internals and nonexistent `pp-*` names: PulsePoint has no `pp-if`/`pp-show`/`pp-else`/`pp-key`; use `hidden={cond}`, ternaries, and plain `key` |

A quoted attribute value is text, so `title="{x}"` is not highlighted as a
binding. A template nested inside `@{…}` re-enters markup highlighting, so
`Html::concat(items.iter().map(|item| html! { <li>@{item}</li> }))` works too,
and its parent template carries on after it.

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
code --install-extension rahti-0.0.7.vsix
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
`html! {`, until the macro's own `}` — every `{…}` binding and `@{…}` value
inside consumes its own braces — delegating to the stock `source.rust`,
`source.js`, and `source.css` grammars for the embedded regions, so embedded
code is colored by the same grammars as standalone files, in any theme. A
`<script>r##"…"##</script>` body closes at the quote and the same `#`s it
opened with, exactly where rustc closes the raw string.
`syntaxes/rahti.script-island.injection.tmLanguage.json` finds
`@{rust_expression}` at any depth of embedded JavaScript (`pp.state(@{…})`,
`const x = @{…}`), where `html!` lifts it too.

rust-analyzer's semantic highlighting paints a whole string literal one color,
and VS Code lets semantic tokens override grammars, which would flatten every
`<script>` and `<style>` body to string color. The extension therefore
defaults `rust-analyzer.semanticHighlighting.strings.enable` to `false`, the
setting rust-analyzer provides for exactly this; Rust strings are still
colored by the grammar. Set it back to `true` in your settings to override.

`src/extension.js` registers Rust quick-fix and completion providers using the
[VS Code extension API](https://code.visualstudio.com/api/references/vscode-api).
`src/components.js` handles markup context, component discovery, import scopes,
and edit planning without depending on VS Code. The runtime has no npm dependencies.
