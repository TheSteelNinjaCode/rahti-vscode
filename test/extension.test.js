"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

// Contract tests run the actual extension entry point against a minimal VS Code
// API double. No extension-host download or npm dependencies are needed.
function environment(files = {}) {
    class Uri {
        constructor(value) { this.path = value; this.scheme = "file"; this.authority = ""; }
        toString() { return `file://${this.path}`; }
        static joinPath(uri, ...segments) { return new Uri(path.posix.join(uri.path, ...segments)); }
    }
    class Range { constructor(start, end) { this.start = start; this.end = end; } }
    class WorkspaceEdit { set(uri, edits) { this.uri = uri; this.edits = edits; } }
    class CodeAction { constructor(title, kind) { this.title = title; this.kind = kind; } }
    class CompletionItem { constructor(label, kind) { this.label = label; this.kind = kind; } }
    class RelativePattern { constructor(base, pattern) { this.base = base; this.pattern = pattern; } }
    const events = {};
    const registrations = {};
    const event = name => callback => { events[name] = callback; return { dispose() {} }; };
    const workspace = {
        textDocuments: [],
        getWorkspaceFolder: uri => uri.path.startsWith("/workspace/") ? { uri: new Uri("/workspace") } : undefined,
        fs: {
            async stat(uri) { if (!(uri.path in files)) throw Object.assign(new Error("not found"), { code: "FileNotFound" }); return {}; },
            async readFile(uri) { if (!(uri.path in files)) throw Object.assign(new Error("not found"), { code: "FileNotFound" }); return Buffer.from(files[uri.path]); }
        },
        async findFiles(pattern) { return Object.keys(files).filter(file => file.startsWith(pattern.base.path + "/") && file.endsWith(".rs")).map(file => new Uri(file)); },
        createFileSystemWatcher: () => ({ dispose() {}, onDidCreate: event("create"), onDidChange: event("change"), onDidDelete: event("delete") }),
        onDidChangeTextDocument: event("text"), onDidOpenTextDocument: event("open"), onDidCloseTextDocument: event("close"), onDidChangeWorkspaceFolders: event("folders")
    };
    const vscode = {
        Uri, Range, WorkspaceEdit, CodeAction, CompletionItem, RelativePattern, workspace,
        CodeActionKind: { QuickFix: "quickfix" }, CompletionItemKind: { Function: 2 },
        TextEdit: { insert: (position, text) => ({ position, text }), replace: (range, text) => ({ range, text }) },
        languages: {
            registerCodeActionsProvider: (selector, provider, metadata) => { registrations.actions = { selector, provider, metadata }; return { dispose() {} }; },
            registerCompletionItemProvider: (selector, provider, ...triggers) => { registrations.completions = { selector, provider, triggers }; return { dispose() {} }; }
        }
    };
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../src/extension.js"), "utf8"), {
        require: name => name === "vscode" ? vscode : require("../src/components"), module, Buffer
    });
    const document = (source, file = "/workspace/app/src/app/page.rs") => ({
        uri: new Uri(file), languageId: "rust", version: 1,
        getText: () => source, offsetAt: position => position, positionAt: offset => offset
    });
    return { ...module.exports, workspace, document, registrations, events, files };
}

function fixture() {
    return environment({
        "/workspace/Cargo.toml": "[workspace]",
        "/workspace/app/Cargo.toml": "[package]",
        "/workspace/app/src/components/forms/button.rs": "#[component] pub fn Button() -> Html { todo!() }",
        "/workspace/app/src/components/navigation/button.rs": "#[component] pub fn Button() -> Html { todo!() }",
        "/workspace/app/src/components/mod.rs": "pub mod forms; pub mod navigation;",
        "/workspace/other/Cargo.toml": "[package]",
        "/workspace/other/src/components/button.rs": "#[component] pub fn WrongCrate() -> Html { todo!() }"
    });
}
const token = { isCancellationRequested: false };

test("entry point registers Rust quick fixes and '<' completion and disposes all listeners", () => {
    const env = fixture();
    const context = { subscriptions: [] };
    env.activate(context);
    assert.equal(env.registrations.actions.selector.language, "rust");
    assert.equal(env.registrations.actions.metadata.providedCodeActionKinds[0], "quickfix");
    assert.equal(env.registrations.completions.triggers[0], "<");
    assert.equal(context.subscriptions.length, 10);
    for (const disposable of context.subscriptions) disposable.dispose();
});

test("index confines discovery to nearest Cargo crate and keeps duplicate names", async () => {
    const env = fixture();
    const index = new env.ComponentIndex(env.workspace);
    const found = await index.candidates(env.document(""), token);
    assert.equal(found.length, 2);
    assert.equal(found[0].importPath, "crate::components::forms::button::Button");
    assert.equal(found[1].importPath, "crate::components::navigation::button::Button");
    assert.equal((await index.candidates(env.document("", "/elsewhere/page.rs"), token)).length, 0);
});

test("index reads unsaved components and invalidates creations, renames and deletions", async () => {
    const env = fixture();
    const index = new env.ComponentIndex(env.workspace);
    env.workspace.textDocuments.push(env.document("#[component] pub fn Unsaved() -> Html { todo!() }", "/workspace/app/src/components/forms/button.rs"));
    assert.ok((await index.candidates(env.document(""), token)).some(c => c.name === "Unsaved"));
    delete env.files["/workspace/app/src/components/navigation/button.rs"];
    env.files["/workspace/app/src/components/navigation/link.rs"] = "#[component] pub fn Link() -> Html { todo!() }";
    index.invalidate();
    const found = await index.candidates(env.document(""), token);
    assert.equal(found.length, 2);
    assert.ok(found.some(c => c.importPath.endsWith("link::Link")));
    assert.ok(!found.some(c => c.name === "Button"));
    const own = await index.candidates(env.workspace.textDocuments[0], token);
    assert.ok(!own.some(c => c.name === "Unsaved"));
});

test("quick fix produces actual WorkspaceEdit; completion produces additionalTextEdits", async () => {
    const env = fixture();
    const providers = env.createProviders(new env.ComponentIndex(env.workspace));
    const source = "fn page() { html! { <Button /> } }";
    const doc = env.document(source);
    const offset = source.indexOf("Button") + 3;
    const actions = await providers.provideCodeActions(doc, { start: offset }, {}, token);
    assert.equal(actions.length, 2);
    assert.match(actions[0].title, /forms::button::Button/);
    assert.equal(actions[0].isPreferred, undefined);
    assert.equal(actions[0].edit.edits[0].position, 0);
    const fixed = actions[0].edit.edits[0].text + source;
    const next = await providers.provideCodeActions(env.document(fixed), { start: fixed.indexOf("<Button") + 3 }, {}, token);
    assert.equal(next.length, 0);
    const completions = await providers.provideCompletionItems(doc, offset, token);
    assert.equal(completions.length, 2);
    assert.match(completions[1].label.description, /navigation::button/);
    assert.equal(completions[0].range.start, source.indexOf("Button"));
    assert.equal(completions[0].additionalTextEdits.length, 1);
});

test("provider respects cancellation, document version, non-quickfix requests and markup context", async () => {
    const env = fixture();
    let scans = 0;
    const doc = env.document("html! { <Button /> }");
    const provider = env.createProviders({ candidates: async () => { scans++; doc.version++; return []; } });
    assert.equal((await provider.provideCodeActions(doc, { start: 12 }, {}, token)).length, 0);
    assert.equal((await provider.provideCodeActions(doc, { start: 12 }, { only: { contains: () => false } }, token)).length, 0);
    assert.equal((await provider.provideCompletionItems(env.document("let Button = 1;"), 5, token)).length, 0);
    assert.equal(scans, 1);
    const index = new env.ComponentIndex(env.workspace);
    assert.equal((await index.candidates(doc, { isCancellationRequested: true })).length, 0);
});

test("file and buffer events invalidate the active index", async () => {
    const env = fixture();
    env.activate({ subscriptions: [] });
    const provider = env.registrations.completions.provider;
    const doc = env.document("html! { < }");
    assert.equal((await provider.provideCompletionItems(doc, 9, token)).length, 2);
    env.files["/workspace/app/src/components/card.rs"] = "#[component] pub fn Card() -> Html { todo!() }";
    env.events.create();
    assert.equal((await provider.provideCompletionItems(doc, 9, token)).length, 3);
    env.workspace.textDocuments.push(env.document("#[component] pub fn Badge() -> Html { todo!() }", "/workspace/app/src/components/card.rs"));
    env.events.text({ document: env.workspace.textDocuments[0] });
    const found = await provider.provideCompletionItems(doc, 9, token);
    assert.ok(found.some(item => item.label.label === "Badge"));
    assert.ok(!found.some(item => item.label.label === "Card"));
});
