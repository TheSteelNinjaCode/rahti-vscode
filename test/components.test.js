"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { componentTags, exportedComponents, modulePath, scopeInfo, suggestions } = require("../src/components");

const candidate = (module, name = "Button") => ({ name, importPath: `crate::components::${module}::${name}` });
const buttons = [candidate("forms::button"), candidate("navigation::button")];
function at(source, candidates = buttons, quickFix = true) {
    const offset = source.indexOf("|");
    assert.notEqual(offset, -1);
    return suggestions(source.replace("|", ""), offset, candidates, quickFix);
}
function apply(source, edit) { return source.slice(0, edit.offset) + edit.text + source.slice(edit.offset); }

test("duplicate names yield separate, fully qualified import choices", () => {
    const fixes = at("fn page() { html! { <But|ton /> } }");
    assert.equal(fixes.length, 2);
    assert.deepEqual(fixes.map(f => f.edit.text), [
        "use crate::components::forms::button::Button;\n",
        "use crate::components::navigation::button::Button;\n"
    ]);
});

test("only component names in html! markup are import targets", () => {
    const source = `// html! { <Comment /> }
/* nested /* html! { <NestedComment /> } */ comment */
const S: &str = r###"html! { <Raw /> }"###;
fn page() { let x = "html! { <String /> }";
 html! { <section title="<Attribute />">
 <!-- <HtmlComment /> -->
 "<Text />"
 <script>const x = "<Script />"; const y = { value: 1 };</script>
 <style>.x::after { content: "<Style />"; }</style>
 <Button prop=@{ foo::<Generic>() } other={a < Client} />
 @{ html! { <Inner /> } }
 </section> }
}`;
    assert.deepEqual(componentTags(source).filter(t => /^[A-Z]/.test(t.name)).map(t => t.name), ["Button", "Inner"]);
    for (const source of ["fn x() { <But|ton> }", "html! { <div title=\"<But|ton />\" /> }", "html! { <div>{a < But|ton}</div> }", "html! { <but|ton /> }", "html! { <forms::But|ton /> }"]) {
        assert.deepEqual(at(source), []);
    }
});

test("supports incomplete tags, closing tags, qualified macros and delimiter variants", () => {
    assert.equal(at("fn page() { rahti::html! { <But| } }", buttons, false).length, 2);
    assert.equal(at("html! { <| }", buttons, false).length, 2);
    assert.equal(at("html! { <Button></But|ton> }").length, 2);
    assert.equal(at("html!(<But|ton />)").length, 2);
    assert.equal(at("html![<But|ton />]").length, 2);
});

test("discovers public attributed functions, not examples or nested/private functions", () => {
    const source = `
// #[component] pub fn Comment() {}
const S: &str = "#[component] pub fn String() {}";
#[component] pub fn Button() -> Html { html! { <div /> } }
#[rahti::component]
#[allow(non_snake_case)]
pub(crate) fn Card<'a>(label: &'a str) -> Html { todo!() }
#[component] fn Private() -> Html { todo!() }
#[component] pub(super) fn Restricted() -> Html { todo!() }
pub fn NotAComponent() -> Html { todo!() }
mod nested { #[component] pub fn Nested() -> Html { todo!() } }
#[component] pub fn Badge() -> Html { todo!() }
`;
    assert.deepEqual(exportedComponents(source).map(c => c.name), ["Button", "Card", "Badge"]);
});

test("module paths follow the generated component tree", () => {
    assert.equal(modulePath("forms\\fields\\text_input.rs"), "crate::components::forms::fields::text_input");
    for (const path of ["mod.rs", "forms/mod.rs", ".hidden/card.rs", "bad-name.rs", "2bad.rs", "type.rs", "card.txt"]) assert.equal(modulePath(path), undefined);
});

test("direct, nested grouped and glob imports suppress duplicate quick fixes", () => {
    for (const use of [
        "use crate::components::forms::button::Button;",
        "use crate::components::{forms::{button::{Button, Other}}, navigation};",
        "use crate::components::forms::button::*;",
        "pub use crate::components::forms::button::{self, Button};"
    ]) assert.deepEqual(at(`${use}\nfn page() { html! { <But|ton /> } }`), []);
});

test("aliases are recognized, and an aliased component can still be referenced by its original name", () => {
    assert.deepEqual(at("use crate::components::forms::button::Button as Primary; fn page() { html! { <Prim|ary /> } }"), []);
    const fixes = at("use crate::components::forms::button::Button as Primary; fn page() { html! { <But|ton /> } }");
    assert.equal(fixes.length, 2);
    // An unresolved <Button> needs a Button binding, not a no-op alias suggestion.
    assert.ok(fixes[0].edit);
    assert.equal(fixes[0].name, "Button");
});

test("completion reuses an import alias and adds collision-free imports for alternatives", () => {
    const results = at("use crate::components::forms::button::Button; fn page() { html! { <But| } }", buttons, false);
    assert.equal(results[0].name, "Button");
    assert.equal(results[0].edit, undefined);
    assert.equal(results[1].name, "NavigationButton");
    assert.match(results[1].edit.text, /Button as NavigationButton;/);
    const aliased = at("use crate::components::forms::button::Button as Primary; fn page() { html! { <Pri| } }", buttons, false);
    assert.equal(aliased[0].name, "Primary");
    assert.equal(aliased[0].edit, undefined);
});

test("scoped imports don't leak between functions or into inline modules", () => {
    assert.equal(at("fn other() { use crate::components::forms::button::Button; } fn page() { html! { <But|ton /> } }").length, 2);
    assert.deepEqual(at("fn page() { use crate::components::forms::button::Button; html! { <But|ton /> } }"), []);
    const source = "use crate::components::forms::button::Button; mod pages { fn page() { html! { <But|ton /> } } }";
    const fixes = at(source);
    assert.equal(fixes.length, 2);
    assert.equal(fixes[0].edit.offset, source.indexOf("{", source.indexOf("mod pages")) + 1);
});

test("local declarations suppress fixes, but unrelated local declarations do not", () => {
    assert.deepEqual(at("#[component] fn Button() {} fn page() { html! { <But|ton /> } }"), []);
    assert.equal(at("fn other() { fn Button() {} } fn page() { html! { <But|ton /> } }").length, 2);
});

test("insertion preserves inner attributes, docs, BOM, shebang, CRLF and outer item docs", () => {
    const source = "\ufeff#!/usr/bin/env script\r\n//! Module docs\r\n#![allow(dead_code)]\r\n/// Page docs\r\n#[allow(unused)]\r\nfn page() { html! { <But|ton /> } }";
    const edit = at(source)[0].edit;
    const updated = apply(source.replace("|", ""), edit);
    assert.match(updated, /#!\[allow\(dead_code\)\]\r\nuse crate::components::forms::button::Button;\r\n\r\n\/\/\/ Page docs/);
    assert.equal(updated.charCodeAt(0), 0xfeff);
    assert.equal(/(?<!\r)\n/.test(edit.text), false);
});

test("import scope is the module even inside nested html and closures", () => {
    const source = "fn page() { html! { <div>@{ items.map(|x| html! { <Button /> }) }</div> } }";
    const offset = source.indexOf("<Button") + 3;
    assert.equal(scopeInfo(source, offset).module.start, 0);
    assert.equal(suggestions(source, offset, buttons, true)[0].edit.offset, 0);
});

test("alias completions rename the matching tag, not children or another macro's tags", () => {
    const source = "use crate::components::forms::button::Button; fn page() { html! { <But|ton><Button />@{html! { <Button /> }}</Button> } }";
    const results = at(source, buttons, false);
    assert.equal(results[1].rename.text, "NavigationButton");
    assert.equal(results[1].rename.start, source.replace("|", "").indexOf("</Button>") + 2);
    assert.equal(results[0].rename, undefined);
});

test("completion respects a local import shadowing a same-named module import", () => {
    const source = "use crate::components::forms::button::Button; fn page() { use crate::components::navigation::button::Button; html! { <But| } }";
    const results = at(source, buttons, false);
    assert.equal(results[0].name, "FormsButton");
    assert.match(results[0].edit.text, /Button as FormsButton;/);
    assert.equal(results[1].name, "Button");
    assert.equal(results[1].edit, undefined);
});
