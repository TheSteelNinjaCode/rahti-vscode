"use strict";

// Grammar tests: tokenize Rust the way VS Code does — its Rust, JavaScript and
// CSS grammars plus this extension's injection — with the vscode-textmate and
// vscode-oniguruma copies VS Code itself ships. No npm dependencies: the
// libraries are read out of the installed editor's `node_modules.asar`.
//
// `VSCODE_APP` names an editor's `resources/app` directory when the search
// does not find one. Without an editor the tests skip and say so;
// `RAHTI_GRAMMAR_REQUIRED=1` makes that a failure instead.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const MANIFEST = require("../package.json");

function findVsCodeApp() {
    if (process.env.VSCODE_APP) return process.env.VSCODE_APP;
    const roots = [];
    if (process.platform === "win32") {
        for (const base of [process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs"), process.env.ProgramFiles]) {
            if (base) roots.push(path.join(base, "Microsoft VS Code"));
        }
    } else if (process.platform === "darwin") {
        roots.push("/Applications/Visual Studio Code.app/Contents/Resources");
    } else {
        roots.push("/usr/share/code/resources", "/opt/visual-studio-code/resources");
    }
    for (const root of roots) {
        // The app sits in `resources/app`, possibly under a versioned folder.
        const candidates = [path.join(root, "app"), path.join(root, "resources", "app")];
        if (fs.existsSync(root)) {
            for (const entry of fs.readdirSync(root)) candidates.push(path.join(root, entry, "resources", "app"));
        }
        const found = candidates.find(dir => fs.existsSync(path.join(dir, "node_modules.asar")));
        if (found) return found;
    }
    return null;
}

// asar: a pickled JSON header, then the files' bytes back to back.
function extractFromAsar(asar, packages, out) {
    const fd = fs.openSync(asar, "r");
    try {
        const head = Buffer.alloc(16);
        fs.readSync(fd, head, 0, 16, 0);
        const headerSize = head.readUInt32LE(4);
        const json = Buffer.alloc(head.readUInt32LE(12));
        fs.readSync(fd, json, 0, json.length, 16);
        const header = JSON.parse(json.toString("utf8"));
        const write = (node, rel) => {
            if (node.files) {
                for (const [name, child] of Object.entries(node.files)) write(child, path.join(rel, name));
                return;
            }
            if (node.unpacked) return;
            const bytes = Buffer.alloc(node.size);
            fs.readSync(fd, bytes, 0, node.size, 8 + headerSize + Number(node.offset));
            fs.mkdirSync(path.join(out, path.dirname(rel)), { recursive: true });
            fs.writeFileSync(path.join(out, rel), bytes);
        };
        for (const name of packages) write(header.files[name], name);
    } finally {
        fs.closeSync(fd);
    }
}

let grammarPromise;
function loadGrammar(app) {
    grammarPromise ??= (async () => {
        const libs = fs.mkdtempSync(path.join(os.tmpdir(), "rahti-grammar-"));
        extractFromAsar(path.join(app, "node_modules.asar"), ["vscode-textmate", "vscode-oniguruma"], libs);
        const tm = require(path.join(libs, "vscode-textmate/release/main.js"));
        const onig = require(path.join(libs, "vscode-oniguruma/release/main.js"));
        await onig.loadWASM(fs.readFileSync(path.join(app, "node_modules.asar.unpacked/vscode-oniguruma/release/onig.wasm")).buffer);
        const files = {
            "source.rust": path.join(app, "extensions/rust/syntaxes/rust.tmLanguage.json"),
            "source.js": path.join(app, "extensions/javascript/syntaxes/JavaScript.tmLanguage.json"),
            "source.css": path.join(app, "extensions/css/syntaxes/css.tmLanguage.json"),
        };
        // This extension's grammars, exactly as package.json contributes them.
        const injections = [];
        for (const contributed of MANIFEST.contributes.grammars) {
            files[contributed.scopeName] = path.join(__dirname, "..", contributed.path);
            if (contributed.injectTo?.includes("source.rust")) injections.push(contributed.scopeName);
        }
        const registry = new tm.Registry({
            onigLib: Promise.resolve({
                createOnigScanner: patterns => new onig.OnigScanner(patterns),
                createOnigString: text => new onig.OnigString(text),
            }),
            loadGrammar: async scope => files[scope] ? tm.parseRawGrammar(fs.readFileSync(files[scope], "utf8"), files[scope]) : null,
            getInjections: scope => scope === "source.rust" ? injections : undefined,
        });
        return { tm, grammar: await registry.loadGrammar("source.rust") };
    })();
    return grammarPromise;
}

const app = findVsCodeApp();
const skip = app ? false : "no VS Code installation found (set VSCODE_APP to its resources/app directory)";
if (!app && process.env.RAHTI_GRAMMAR_REQUIRED && process.env.RAHTI_GRAMMAR_REQUIRED !== "0") {
    throw new Error(`grammar tests required, but ${skip}`);
}

// Every token as { text, scopes } per line, ignoring whitespace-only tokens.
async function tokenize(source) {
    const { tm, grammar } = await loadGrammar(app);
    let state = tm.INITIAL;
    return source.split("\n").map(line => {
        const result = grammar.tokenizeLine(line, state);
        state = result.ruleStack;
        return result.tokens
            .map(token => ({ text: line.slice(token.startIndex, token.endIndex), scopes: token.scopes.join(" ") }))
            .filter(token => token.text.trim());
    });
}

function scopesOf(lines, text, { line } = {}) {
    const pool = line === undefined ? lines.flat() : lines[line];
    const token = pool.find(t => t.text === text);
    assert.ok(token, `no token ${JSON.stringify(text)} in ${JSON.stringify(pool.map(t => t.text))}`);
    return token.scopes;
}

// A page whose template wraps `body`. Line 0 is `fn page`, line 1 opens the
// template, line 2 opens <section>, `body` starts on line 3.
const page = body => `fn page() -> Html {
    html! {r##"
        <section>
${body}
        </section>
    "##}
}

pub fn after() -> u32 { 1 }
`;

const lastLines = lines => lines.slice(-4).flat();

test("a template is HTML, closed where rustc closes the raw string", { skip }, async () => {
    const lines = await tokenize(page(`            <p class="lede">Don't panic — say "hi" to {name} and @{user}.</p>`));

    assert.match(scopesOf(lines, "html!"), /entity\.name\.function\.macro\.rust/);
    assert.match(scopesOf(lines, "r", { line: 1 }), /punctuation\.definition\.template\.begin\.rahti/);
    assert.match(scopesOf(lines, "p", { line: 3 }), /entity\.name\.tag\.html\.rahti/);
    assert.match(scopesOf(lines, "class"), /entity\.other\.attribute-name\.html\.rahti/);
    // A quote or an apostrophe in text is text, not the start of a string.
    assert.doesNotMatch(scopesOf(lines, "{", { line: 3 }), /string/);
    assert.match(scopesOf(lines, "name"), /meta\.embedded\.block\.javascript/);
    assert.match(scopesOf(lines, "user"), /meta\.embedded\.block\.rust/);
    assert.match(scopesOf(lines, "section", { line: 4 }), /entity\.name\.tag\.html\.rahti/);
    // The template ends at `"##}`, and the Rust after it is Rust.
    assert.match(scopesOf(lines, "##", { line: 5 }), /punctuation\.definition\.template\.end\.rahti/);
    assert.match(scopesOf(lines, "fn", { line: 8 }), /storage\.type|keyword/);
    assert.ok(lastLines(lines).every(t => !/rahti|\.js/.test(t.scopes)), JSON.stringify(lastLines(lines)));
});

test("a script body is plain JavaScript, whatever the Rust lexer would think of it", { skip }, async () => {
    const lines = await tokenize(page(`            <script>
                // a comment
                const label = 'single quotes';
                const shout = \`\${label}!\`;
                const color = "#fff";
                const digits = /\d+/;
            </script>`));

    assert.match(scopesOf(lines, " a comment"), /comment\.line\.double-slash\.js/);
    assert.match(scopesOf(lines, "single quotes"), /string\.quoted\.single\.js/);
    assert.match(scopesOf(lines, "`", { line: 6 }), /string\.template\.js/);
    assert.match(scopesOf(lines, "#fff"), /string\.quoted\.double\.js/);
    assert.match(scopesOf(lines, "script", { line: 9 }), /entity\.name\.tag\.script\.html\.rahti/);
    assert.match(scopesOf(lines, "section", { line: 10 }), /entity\.name\.tag\.html\.rahti/);
    assert.ok(lastLines(lines).every(t => !/rahti|\.js/.test(t.scopes)), JSON.stringify(lastLines(lines)));
});

test("@{…} is a Rust island at any depth of a script", { skip }, async () => {
    const lines = await tokenize(page(`            <script>
                const [items, setItems] = pp.state(@{Json(&items)});
                const literal = "@@{not rust}";
            </script>`));

    assert.match(scopesOf(lines, "Json"), /meta\.embedded\.block\.rust/);
    assert.match(scopesOf(lines, ";", { line: 4 }), /punctuation\.terminator\.statement\.js/);
    assert.doesNotMatch(scopesOf(lines, "@@{not rust}"), /embedded\.block\.rust/);
});

test("a template nested in @{…} is HTML too, and its parent goes on", { skip }, async () => {
    const lines = await tokenize(page(`            <ul>@{Html::concat(items.iter().map(|i| html! {r#"<li>@{i}</li>"#}))}</ul>
            <p>after</p>`));

    assert.match(scopesOf(lines, "li"), /entity\.name\.tag\.html\.rahti/);
    assert.match(scopesOf(lines, "ul", { line: 3 }), /entity\.name\.tag\.html\.rahti/);
    assert.match(scopesOf(lines, "after"), /meta\.embedded\.block\.html\.rahti/);
    assert.match(scopesOf(lines, "section", { line: 5 }), /entity\.name\.tag\.html\.rahti/);
});
