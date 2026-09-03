"use strict";

const vscode = require("vscode");
const { exportedComponents, modulePath, suggestions, tagAt } = require("./components");

class ComponentIndex {
    constructor(workspace) {
        this.workspace = workspace;
        this.cache = new Map();
    }

    invalidate() { this.cache.clear(); }

    async crateRoot(uri) {
        const folder = this.workspace.getWorkspaceFolder(uri);
        if (!folder) return undefined;
        let directory = vscode.Uri.joinPath(uri, "..");
        while (directory.path === folder.uri.path || directory.path.startsWith(folder.uri.path + "/")) {
            try {
                await this.workspace.fs.stat(vscode.Uri.joinPath(directory, "Cargo.toml"));
                return directory;
            } catch (error) {
                if (error.code !== "FileNotFound") throw error;
            }
            if (directory.path === folder.uri.path) break;
            directory = vscode.Uri.joinPath(directory, "..");
        }
        return undefined;
    }

    async candidates(document, token) {
        const root = await this.crateRoot(document.uri);
        if (!root || token.isCancellationRequested) return [];
        const key = root.toString();
        if (!this.cache.has(key)) {
            const pending = this.scan(root);
            this.cache.set(key, pending);
            pending.catch(() => { if (this.cache.get(key) === pending) this.cache.delete(key); });
        }
        const candidates = await this.cache.get(key);
        if (token.isCancellationRequested) return [];
        return candidates.filter(candidate => candidate.uri.toString() !== document.uri.toString());
    }

    async scan(root) {
        const directory = vscode.Uri.joinPath(root, "src", "components");
        const uris = await this.workspace.findFiles(new vscode.RelativePattern(directory, "**/*.rs"), "**/{target,node_modules,.git}/**");
        const open = this.workspace.textDocuments;
        const files = new Map(uris.map(uri => [uri.toString(), uri]));
        for (const doc of open) {
            if (doc.uri.scheme === directory.scheme && doc.uri.authority === directory.authority && doc.uri.path.startsWith(directory.path + "/")) {
                files.set(doc.uri.toString(), doc.uri);
            }
        }
        // Bound concurrent filesystem reads in large component trees.
        const queue = [...files.values()];
        const result = [];
        const worker = async () => {
            while (queue.length) {
                const uri = queue.pop();
                const relative = uri.path.slice(directory.path.length + 1);
                const module = modulePath(relative);
                if (!module) continue;
                const document = open.find(doc => doc.uri.toString() === uri.toString());
                let source;
                try {
                    source = document ? document.getText() : Buffer.from(await this.workspace.fs.readFile(uri)).toString("utf8");
                } catch (error) {
                    if (error.code === "FileNotFound") continue; // deleted during scan
                    throw error;
                }
                for (const component of exportedComponents(source)) {
                    result.push({ ...component, uri, importPath: `${module}::${component.name}`, relativeFile: `src/components/${relative}` });
                }
            }
        };
        await Promise.all(Array.from({ length: Math.min(8, queue.length) }, worker));
        return result.sort((a, b) => a.name.localeCompare(b.name) || a.importPath.localeCompare(b.importPath));
    }
}

function createProviders(index) {
    const editsFor = (document, edit) => edit ? [vscode.TextEdit.insert(document.positionAt(edit.offset), edit.text)] : [];
    return {
        async provideCodeActions(document, range, context, token) {
            if (context.only && !context.only.contains(vscode.CodeActionKind.QuickFix)) return [];
            const source = document.getText();
            const version = document.version;
            const offset = document.offsetAt(range.start);
            const tag = tagAt(source, offset);
            if (!tag || !/^[A-Z]/.test(tag.name)) return [];
            const candidates = await index.candidates(document, token);
            if (token.isCancellationRequested || document.version !== version) return [];
            return suggestions(source, offset, candidates, true).map(suggestion => {
                const action = new vscode.CodeAction(`Import ${suggestion.name} from ${suggestion.candidate.importPath}`, vscode.CodeActionKind.QuickFix);
                action.edit = new vscode.WorkspaceEdit();
                action.edit.set(document.uri, editsFor(document, suggestion.edit));
                // No preferred action: equal names in different directories are
                // equally valid. The user chooses the component's identity.
                return action;
            });
        },
        async provideCompletionItems(document, position, token) {
            const source = document.getText();
            const version = document.version;
            const offset = document.offsetAt(position);
            const tag = tagAt(source, offset);
            if (!tag || (tag.name && !/^[A-Z]/.test(tag.name))) return [];
            const candidates = await index.candidates(document, token);
            if (token.isCancellationRequested || document.version !== version) return [];
            return suggestions(source, offset, candidates).map(suggestion => {
                const item = new vscode.CompletionItem({ label: suggestion.name, description: suggestion.candidate.importPath }, vscode.CompletionItemKind.Function);
                item.detail = `${suggestion.edit ? "Auto import" : "Already imported"} • ${suggestion.candidate.relativeFile}`;
                item.insertText = suggestion.name;
                item.filterText = `${suggestion.candidate.name} ${suggestion.name}`;
                item.range = new vscode.Range(document.positionAt(suggestion.tag.start), document.positionAt(suggestion.tag.end));
                item.additionalTextEdits = editsFor(document, suggestion.edit);
                if (suggestion.rename) {
                    item.additionalTextEdits.push(vscode.TextEdit.replace(
                        new vscode.Range(document.positionAt(suggestion.rename.start), document.positionAt(suggestion.rename.end)), suggestion.rename.text
                    ));
                }
                item.sortText = `${suggestion.name}:${suggestion.candidate.importPath}`;
                return item;
            });
        }
    };
}

function activate(context) {
    const index = new ComponentIndex(vscode.workspace);
    const provider = createProviders(index);
    const selector = { language: "rust", scheme: "file" };
    const watcher = vscode.workspace.createFileSystemWatcher("**/{*.rs,Cargo.toml}");
    const invalidate = () => index.invalidate();
    const invalidateComponent = document => {
        if (document.languageId === "rust" && /\/src\/components\/.*\.rs$/.test(document.uri.path)) invalidate();
    };
    context.subscriptions.push(
        watcher,
        watcher.onDidCreate(invalidate), watcher.onDidChange(invalidate), watcher.onDidDelete(invalidate),
        vscode.workspace.onDidChangeTextDocument(event => invalidateComponent(event.document)),
        vscode.workspace.onDidOpenTextDocument(invalidateComponent),
        vscode.workspace.onDidCloseTextDocument(invalidateComponent),
        vscode.workspace.onDidChangeWorkspaceFolders(invalidate),
        vscode.languages.registerCodeActionsProvider(selector, provider, { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }),
        vscode.languages.registerCompletionItemProvider(selector, provider, "<")
    );
}

module.exports = { activate, ComponentIndex, createProviders };
