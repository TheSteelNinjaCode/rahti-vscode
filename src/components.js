"use strict";

// A small, offset-preserving lexer, not a Rust type resolver. Strings/comments
// are opaque so example markup and braces in them cannot affect import edits.
function tokenize(source) {
    const tokens = [];
    let i = 0;
    while (i < source.length) {
        const start = i;
        if (/\s/.test(source[i])) { i++; continue; }
        if (source.startsWith("//", i)) {
            const end = source.indexOf("\n", i);
            i = end < 0 ? source.length : end;
            continue;
        }
        if (source.startsWith("/*", i)) {
            let depth = 1;
            i += 2;
            while (i < source.length && depth) {
                if (source.startsWith("/*", i)) { depth++; i += 2; }
                else if (source.startsWith("*/", i)) { depth--; i += 2; }
                else i++;
            }
            continue;
        }
        if (source.startsWith("<!--", i)) {
            const end = source.indexOf("-->", i + 4);
            i = end < 0 ? source.length : end + 3;
            continue;
        }
        const raw = /^(?:br|cr|r)(#*)"/.exec(source.slice(i));
        let kind = "code";
        if (raw) {
            const end = source.indexOf('"' + raw[1], i + raw[0].length);
            i = end < 0 ? source.length : end + 1 + raw[1].length;
            kind = "string";
        } else if (source[i] === '"' || source[i] === '`' ||
            (source[i] === "'" && /^'(?:\\(?:u\{[\da-fA-F]+\}|x[\da-fA-F]{2}|.)|[^'\\\r\n])'/u.test(source.slice(i)))) {
            const quote = source[i++];
            while (i < source.length) {
                if (source[i] === "\\") i += 2;
                else if (source[i++] === quote) break;
            }
            kind = "string";
        } else {
            const word = /^(?:r#)?[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(i));
            if (word) i += word[0].length;
            else if (source.startsWith("::", i) || source.startsWith("->", i)) i += 2;
            else i++;
        }
        tokens.push({ value: source.slice(start, i), start, end: i, kind });
    }
    return tokens;
}

function matching(tokens, start, open = "{", close = "}") {
    let depth = 0;
    for (let i = start; i < tokens.length; i++) {
        if (tokens[i].kind !== "code") continue;
        if (tokens[i].value === open) depth++;
        if (tokens[i].value === close && --depth === 0) return i;
    }
    return tokens.length;
}

// Only markup positions are returned: never ordinary Rust, prop expressions,
// quoted text, comments, or raw script/style bodies. Nested html! re-enters.
function componentTags(source) {
    const tokens = tokenize(source);
    const tags = [];
    const value = i => tokens[i]?.value;
    function rust(start, end) {
        for (let i = start; i < end; i++) {
            if (value(i) === "html" && value(i + 1) === "!" && ["{", "(", "["].includes(value(i + 2))) {
                const open = value(i + 2);
                const close = { "{": "}", "(": ")", "[": "]" }[open];
                const last = Math.min(matching(tokens, i + 2, open, close), end);
                markup(i + 3, last, tokens[i].start);
                i = last;
            }
        }
    }
    function markup(start, end, macroStart) {
        for (let i = start; i < end; i++) {
            if (value(i) === "{") {
                const last = Math.min(matching(tokens, i), end);
                if (value(i - 1) === "@") rust(i + 1, last);
                i = last;
                continue;
            }
            if (value(i) !== "<") continue;
            const closing = value(i + 1) === "/";
            const nameIndex = i + (closing ? 2 : 1);
            const name = tokens[nameIndex];
            let tag;
            const nameStart = tokens[i + (closing ? 1 : 0)].end;
            if (!name || name.start > nameStart || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name.value)) {
                tags.push({ name: "", start: nameStart, end: nameStart, closing, macroStart });
                continue;
            }
            // Qualified/context-provider tags are not simple component names.
            if (!["::", ".", "-", ":"].includes(value(nameIndex + 1))) {
                tag = { name: name.value, start: name.start, end: name.end, closing, macroStart };
                tags.push(tag);
            }
            i = nameIndex;
            while (i + 1 < end && value(i + 1) !== ">") {
                // A new '<' or macro end can follow an unfinished tag while typing.
                if (value(i + 1) === "<") break;
                i++;
                if (value(i) === "{") {
                    const last = Math.min(matching(tokens, i), end);
                    if (value(i - 1) === "@") rust(i + 1, last);
                    i = last;
                }
            }
            if (value(i + 1) === ">") {
                const selfClosing = value(i) === "/";
                if (tag) tag.selfClosing = selfClosing;
                i++;
                if (!closing && !selfClosing && ["script", "style"].includes(name.value)) {
                    while (i + 1 < end && !(value(i + 1) === "<" && value(i + 2) === "/" && value(i + 3) === name.value)) i++;
                }
            }
        }
    }
    rust(0, tokens.length);
    const stacks = new Map();
    for (const tag of tags) {
        if (!stacks.has(tag.macroStart)) stacks.set(tag.macroStart, []);
        const stack = stacks.get(tag.macroStart);
        if (tag.closing) {
            const opening = stack.at(-1);
            if (opening?.name === tag.name) {
                stack.pop();
                opening.pair = { start: tag.start, end: tag.end };
                tag.pair = { start: opening.start, end: opening.end };
            }
        } else if (tag.name && !tag.selfClosing) stack.push(tag);
    }
    return tags;
}

function tagAt(source, offset) {
    return componentTags(source).find(tag => tag.start <= offset && offset <= tag.end);
}

// Discover only module-level #[component] functions. Nested modules need a
// different path/visibility calculation and are intentionally not guessed.
function exportedComponents(source) {
    const tokens = tokenize(source);
    const result = [];
    let component = false;
    let visibility = "";
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (token.value === "#" && tokens[i + 1]?.value === "[") {
            const end = matching(tokens, i + 1, "[", "]");
            const attr = tokens.slice(i + 2, end).map(t => t.value).join("");
            if (/^(?:[A-Za-z_][A-Za-z0-9_]*::)*component$/.test(attr)) component = true;
            i = end;
        } else if (token.value === "pub") {
            visibility = "pub";
            if (tokens[i + 1]?.value === "(") {
                const end = matching(tokens, i + 1, "(", ")");
                visibility = tokens.slice(i + 2, end).map(t => t.value).join("");
                i = end;
            }
        } else if (token.value === "fn") {
            const name = tokens[i + 1];
            if (component && ["pub", "crate"].includes(visibility) && /^[A-Z][A-Za-z0-9_]*$/.test(name?.value)) {
                result.push({ name: name.value, offset: name.start });
            }
            component = false;
            visibility = "";
        } else if (token.value === "{") {
            i = matching(tokens, i);
            component = false;
            visibility = "";
        } else if (token.value === ";") {
            component = false;
            visibility = "";
        }
    }
    return result;
}

const RESERVED = new Set("as break const continue crate else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while async await dyn abstract become box do final macro override priv typeof unsized virtual yield try gen".split(" "));

function modulePath(relativeFile) {
    const segments = relativeFile.replace(/\\/g, "/").replace(/\.rs$/, "").split("/");
    if (!relativeFile.endsWith(".rs") || segments.at(-1) === "mod" ||
        segments.some(s => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(s) || RESERVED.has(s))) return undefined;
    return "crate::components::" + segments.join("::");
}

function parseUse(tokens) {
    let i = 0;
    const imports = [];
    function tree(prefix) {
        if (tokens[i]?.value === "{") {
            i++;
            while (i < tokens.length && tokens[i].value !== "}") {
                const before = i;
                tree(prefix);
                if (tokens[i]?.value === ",") i++;
                if (i === before) i++;
            }
            i++;
            return;
        }
        const parts = [...prefix];
        while (i < tokens.length) {
            const name = tokens[i++].value;
            if (name === "::") continue;
            if (name === "*") { imports.push({ path: parts.join("::"), name: "*" }); return; }
            parts.push(name);
            if (tokens[i]?.value !== "::") break;
            i++;
            if (tokens[i]?.value === "{") { tree(parts); return; }
        }
        let name = parts.at(-1);
        if (name === "self") { parts.pop(); name = parts.at(-1); }
        if (tokens[i]?.value === "as") { i++; name = tokens[i++]?.value; }
        imports.push({ path: parts.join("::"), name });
    }
    tree([]);
    return imports;
}

// Rust block scopes matter: a use in another function must not suppress a fix.
// Inline modules are boundaries, because they don't inherit their parent's uses.
function scopeInfo(source, offset) {
    const tokens = tokenize(source);
    const root = { start: 0, end: source.length, parent: null, module: true, imports: [], names: new Set() };
    const scopes = [root];
    let scope = root;
    let itemStart = 0;
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.value === "use") {
            const end = tokens.findIndex((token, index) => index > i && token.value === ";");
            if (end < 0) continue;
            scope.imports.push(...parseUse(tokens.slice(i + 1, end)));
            i = end;
            itemStart = i + 1;
        } else if (["fn", "struct", "enum", "type", "union", "mod", "const", "static"].includes(t.value)) {
            if (tokens[i + 1]) scope.names.add(tokens[i + 1].value);
        } else if (t.value === "{") {
            const module = tokens.slice(itemStart, i).some(token => token.value === "mod");
            const child = { start: t.end, end: source.length, parent: scope, module, imports: [], names: new Set() };
            scopes.push(child);
            scope = child;
            itemStart = i + 1;
        } else if (t.value === "}") {
            scope.end = t.start;
            scope = scope.parent || root;
            itemStart = i + 1;
        } else if (t.value === ";") itemStart = i + 1;
    }
    const containing = scopes.filter(s => s.start <= offset && offset <= s.end);
    let current = containing.at(-1) || root;
    const imports = [];
    const names = new Set();
    while (current) {
        // A binding in a nearer Rust block shadows the same spelling outside.
        const outerHidden = new Set(names);
        for (const entry of current.imports) {
            if (entry.name === "*" || !outerHidden.has(entry.name)) imports.push(entry);
            if (entry.name !== "*") names.add(entry.name);
        }
        for (const name of current.names) names.add(name);
        if (current.module) break;
        current = current.parent;
    }
    return { imports, names, module: current || root };
}

function importedName(candidate, info) {
    for (const entry of info.imports) {
        if (entry.path === candidate.importPath && entry.name !== "_") return entry.name;
        if (entry.name === "*" && entry.path === candidate.importPath.split("::").slice(0, -1).join("::")) return candidate.name;
    }
    return undefined;
}

function aliasFor(candidate, names) {
    if (!names.has(candidate.name)) return candidate.name;
    const parts = candidate.importPath.split("::").slice(2, -1).reverse();
    let alias = candidate.name;
    for (const part of parts) {
        const prefix = part.split("_").map(s => s.charAt(0).toUpperCase() + s.slice(1)).join("");
        if (!alias.startsWith(prefix)) alias = prefix + alias;
        if (!names.has(alias)) return alias;
    }
    let suffix = 2;
    while (names.has(alias + suffix)) suffix++;
    return alias + suffix;
}

// Insert after the module preamble (inner docs/attributes), before outer item
// docs/attributes, so an item's documentation never becomes attached to a use.
function importLocation(source, module) {
    const eol = source.includes("\r\n") ? "\r\n" : "\n";
    let offset = module.start;
    if (offset === 0 && source.charCodeAt(0) === 0xfeff) offset++;
    if (offset <= 1 && source.startsWith("#!", offset) && !source.startsWith("#![", offset)) {
        const end = source.indexOf("\n", offset);
        offset = end < 0 ? source.length : end + 1;
    }
    const tokens = tokenize(source);
    while (offset < source.length) {
        const whitespace = /^\s*/.exec(source.slice(offset))[0];
        const next = offset + whitespace.length;
        if (source.startsWith("//!", next) || (source.startsWith("//", next) && !source.startsWith("///", next))) {
            const end = source.indexOf("\n", next);
            offset = end < 0 ? source.length : end + 1;
        } else if (source.startsWith("/*", next) && !source.startsWith("/**", next)) {
            let end = next + 2;
            let depth = 1;
            while (end < source.length && depth) {
                if (source.startsWith("/*", end)) { depth++; end += 2; }
                else if (source.startsWith("*/", end)) { depth--; end += 2; }
                else end++;
            }
            offset = end;
        } else if (/^#!\s*\[/.test(source.slice(next))) {
            const start = tokens.findIndex(t => t.start >= next && t.value === "[");
            const end = matching(tokens, start, "[", "]");
            if (!tokens[end]) break;
            offset = tokens[end].end;
        } else break;
    }
    const indent = module.parent ? "    " : "";
    const prefix = offset > 0 && source[offset - 1] !== "\n" ? eol : "";
    return { offset, indent, prefix, eol };
}

function importEdit(source, module, importPath, name, location = importLocation(source, module)) {
    const { offset, indent, prefix, eol } = location;
    const localName = importPath.split("::").at(-1);
    const alias = name === localName ? "" : ` as ${name}`;
    return { offset, text: `${prefix}${indent}use ${importPath}${alias};${eol}` };
}

function suggestions(source, offset, candidates, quickFix = false) {
    const tag = tagAt(source, offset);
    if (!tag || (tag.name && !/^[A-Z]/.test(tag.name))) return [];
    const info = scopeInfo(source, tag.macroStart);
    // A glob importing this name resolves the tag too; don't offer a competing
    // explicit import from another directory as an "unresolved" quick fix.
    for (const candidate of candidates) {
        const name = importedName(candidate, info);
        if (name) info.names.add(name);
    }
    if (quickFix && (!tag.name || info.names.has(tag.name))) return [];
    const prefix = quickFix ? tag.name : source.slice(tag.start, offset);
    let location;
    return candidates.flatMap(candidate => {
        const imported = quickFix ? undefined : importedName(candidate, info);
        if (quickFix && imported === tag.name) return [];
        const name = imported || aliasFor(candidate, info.names);
        if (quickFix ? candidate.name !== prefix : !candidate.name.startsWith(prefix) && !name.startsWith(prefix)) return [];
        // A closing tag completion should not invent a second component import.
        if (!quickFix && tag.closing && !imported) return [];
        if (!imported && !location) location = importLocation(source, info.module);
        return [{ candidate, name, tag,
            edit: imported ? undefined : importEdit(source, info.module, candidate.importPath, name, location),
            rename: !quickFix && tag.pair && name !== tag.name ? { ...tag.pair, text: name } : undefined
        }];
    });
}

module.exports = { tokenize, componentTags, tagAt, exportedComponents, modulePath, parseUse, scopeInfo, importedName, aliasFor, importEdit, suggestions };
