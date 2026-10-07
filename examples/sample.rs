//! Highlighting exercise file — open in the Extension Development Host.
//! Covers every syntax form the Rahti grammar handles.

use crate::rahti::{Html, component, html, rpc};

/// Root layout: doctype, literal <html> root, script/link tags, slot.
pub fn layout(children: Html) -> Html {
    html! {
        <!DOCTYPE html>
        <html lang="en">
            <head>
                <meta charset="UTF-8" />
                <title>"my-app"</title>
                /* A template comment is a note, not sent to the browser. Markup
                     in it must NOT open a region: <script>, <style>, <head>,
                     a lone " quote, or a {brace}. */
                <link href="/css/styles.css" rel="stylesheet" />
                <script type="module" src="/js/main.js"></script>
                <style>r##"
                    .hero { color: rebeccapurple; font-weight: 600; }
                "##</style>
            </head>
            <body>
                <div pp-loading-content="true">
                    <slot />
                </div>
            </body>
        </html>
    }
}

/// Page: @{rust} vs {js} dialects, events, pp-* attributes, script body.
pub async fn page() -> Html {
    let server_title = "Dashboard";
    let initial_count = 3;
    html! {
        <section class="mx-auto max-w-2xl px-6 py-16">
            // authored comment 
            <h1>@{server_title}</h1>
            <a href=@{format!("/users/{}", 42)}>"Profile"</a>

            <button onclick={setCount(count + 1)}>{count}</button>
            <input value={name} oninput={setName(target.value)} />
            <input
                type="file"
                pp-ref={file} 
            />
            <a href="/about" pp-spa="false">"About"</a>

            <ul>
                <template pp-for="(item, index) in items">
                    <li key={item.id} hidden={item.done}>{index}": "{item.label}</li>
                </template>
            </ul>

            <span pp-style={cssText}>"Admin: "{admin ? "yes" : "no"}</span>
            <p>"Literal braces: &#123;user&#125;"</p>

            <Card title="Profile" count="3" wide>
                <p>"Ada"</p>
                <Badge text="Rust" />
            </Card>

            <script>r##"
                const [count, setCount] = pp.state(@{initial_count});
                const [name, setName] = pp.state("");
                const file = pp.ref(null);

                async function greet() {
                    setCount(await pp.rpc("hello", { who: name }));
                }
            "##</script>
        </section>
    }
}

/// Fragment root, nested html! inside @{…}.
#[component]
pub fn Pair(label: &str, items: Vec<String>) -> Html {
    html! {
        <>
            <dt>@{label}</dt>
            <dd>@{Html::concat(items.iter().map(|item| html! {
                <li>@{item}</li>
            }))}</dd>
        </>
    }
}

/// Plain Rust after the macro stays plain Rust.
#[rpc]
pub async fn hello(who: String) -> String {
    format!("Hello, {who}.")
}

/// A script is plain JavaScript: what the Rust lexer would reject (single
/// quotes, template literals, comments, "#fff") highlights as JavaScript, and
/// `@{…}` is Rust at any depth.
#[component]
pub fn Greeter(name: String) -> Html {
    html! {
        <section class="greeter">
            <p>{greeting}</p>
            <script>r##"
                // Comments survive.
                const name = @{Json(&name)};
                const [greeting, setGreeting] = pp.state(`Hello, ${name}!`);
                const color = '#4f46e5';
                const accent = "#fff"; // a "# never ends a body written with two #s
                const literal = "@@{not rust}";
            "##</script>
        </section>
    }
}
