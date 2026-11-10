<img src="assets/logo.svg" width="56" alt="" align="left" />

# omnisnap-mcp

**Selectors that don't rot, and a page your agent can actually see.**

Agents guess selectors from a DOM dump, and the test breaks next sprint.
`omnisnap-mcp` returns selectors ranked for how likely they are to survive a
redeploy and checked against the live page so you know whether each one
matches a single element or several — taken from the page as *you* see it,
logged in, in your own session.

It needs the [OmniSnap AI Studio][store] Chrome extension, which does the
reading. This server is the bridge.

> **Requires OmniSnap AI Studio 1.9 or later.** The bridge lives in the
> extension, and earlier versions have no **Connect to AI** switch to turn on.
> If the version in the Web Store is older than that, this server will start
> and every tool will report that it is not paired, because there is nothing
> on the other end yet. Check the version on the extension's store listing
> before filing that as a bug.

[store]: https://chromewebstore.google.com/detail/fjjfegkonlkleomaeopmakhlejjiljga

## Why not Playwright MCP

Those drive a browser. This one reads yours, and asks before it touches it.

The category is not empty — several projects connect an agent to your real
Chrome through an extension. What is different here is what comes back: not a
driven browser, but the artefacts of a handoff.

- **Your real session.** A clean automated browser needs a scripted login to
  reach anything behind SSO. This is already in the tab.
- **Scored selectors.** A class like `css-1x2y3z` or an id like `:r7:` is a
  build artefact that changes when the bundler runs. Those are scored down,
  with the reason attached.
- **Uniqueness checked.** A selector that looks perfect and quietly matches
  three elements is the most common cause of a flaky suite. Every candidate is
  counted against the live DOM.
- **A page it can see.** `annotate_interactive` returns a numbered screenshot
  *plus* a selector for each number, so the model reasons visually and acts
  precisely.

## Requirements

- **Node.js 18 or newer.**
- **Google Chrome**, with [OmniSnap AI Studio][store] **1.9 or later**.
- Any MCP client: Claude Code, Claude Desktop, Cursor, VS Code, Windsurf,
  Codex, Cline, Goose, or another that speaks the protocol.

## Install

```json
{
  "mcpServers": {
    "omnisnap": {
      "command": "npx",
      "args": ["-y", "omnisnap-mcp"]
    }
  }
}
```

<details>
<summary>Where that goes, per client</summary>

| Client | |
| --- | --- |
| **Claude Code** | `claude mcp add omnisnap -- npx -y omnisnap-mcp` |
| **Claude Desktop** | `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS), `%APPDATA%\Claude\claude_desktop_config.json` (Windows) |
| **Cursor** | `~/.cursor/mcp.json`, or `.cursor/mcp.json` in a project |
| **VS Code** | `.vscode/mcp.json`, or `code --add-mcp '{"name":"omnisnap","command":"npx","args":["-y","omnisnap-mcp"]}'` |
| **Windsurf** | `~/.codeium/windsurf/mcp_config.json` |
| **Cline** | `cline_mcp_settings.json`, through the MCP Servers pane |
| **Codex** | `~/.codex/config.toml` |
| **Goose** | Settings → Extensions → Add, as a stdio command |

Anything else that speaks MCP over stdio takes the same `command` and `args`.

</details>

Options can be passed in the same `args` array, which is usually easier than
setting environment variables:

```json
{
  "mcpServers": {
    "omnisnap": {
      "command": "npx",
      "args": ["-y", "omnisnap-mcp", "--port", "8787", "--log-level", "debug"]
    }
  }
}
```

Then install the [extension][store] — **1.9 or later** — click its icon and
turn on **Connect to AI**. Ask your agent to call `omnisnap_status`: it
reports a six-digit code. Type that code into the extension. Once, and you
are paired for good.

If the switch is not there, the installed extension predates the bridge.

## Tools

Twenty-two, in three tiers. The tier is decided by who has to agree to it.

**It reads.** Nothing here changes your page.

| Tool | What it gives you |
| --- | --- |
| `omnisnap_status` | Whether the bridge is paired, and how to fix it if not |
| `annotate_interactive` | Numbered screenshot + a selector per number, and how much of the page you are seeing |
| `collect_selectors` | Every selector for an element, ranked and verified |
| `get_page_object` | A page object for Playwright, Selenium, Cypress, WebdriverIO |
| `verify_selectors` | Which of your existing selectors have rotted |
| `read_page` | The page as text and a heading outline, at a fortieth the cost of a screenshot |
| `capture_page` · `capture_element` · `capture_matrix` | Screenshots the model can see, including three widths side by side |
| `get_diagnostics` | Vitals, failed requests, console errors, storage |
| `watch_page` | Waits, and reports the errors, failed requests and layout shifts that happen meanwhile |
| `get_design_tokens` | Palette with contrast audit, type scale, spacing |
| `measure_accessibility` | WCAG failures with selectors |
| `inspect_element` | Box model and computed styles for one element |
| `list_tabs` | Which tabs can be read |

**It moves the camera.** These change what is on screen, not what the page
contains, and they say so rather than claiming to be reads.

| Tool | |
| --- | --- |
| `scroll_to` | See the rest of the page. `annotate_interactive` covers one viewport; on a long page that is a few per cent of it |
| `set_viewport` | Hold the page at 375, 768 or 1440 so every tool afterwards answers about that width |
| `set_color_scheme` | Light or dark. Dark is where contrast regressions hide, because it is the theme nobody screenshots |
| `hover` · `focus_element` | Photograph a dropdown, a tooltip, a focus ring — states no ordinary capture can reach |

**It asks before it acts.**

| Tool | |
| --- | --- |
| `propose_action` | Proposes a click or a keystroke. The extension outlines the element and asks the user in the page; nothing happens unless they approve |
| `await_user_selection` | Hands the question back: the user clicks the element they mean, and you get it with ranked selectors |

Once an element has a number from `annotate_interactive`, every tool above
takes `element: 5` instead of a selector you would otherwise have to copy out
of a table and retype exactly.

Four slash commands: `/write-test`, `/file-bug`, `/audit-accessibility`,
`/extract-design-system`.

And four resources, two of which work before you have paired anything:

| Resource | |
| --- | --- |
| `omnisnap://guide/selectors` | The ranking and why, what makes a selector fragile, how the right choice differs per framework |
| `omnisnap://guide/diagnostics` | What the vitals mean, and the two mistakes that produce confidently wrong bug reports |
| `omnisnap://capture/latest` | The most recent screenshot and its metadata |
| `omnisnap://help/pairing` | Install and pairing steps |

The guides are the part that is not an API. Any server can hand back a list of
selectors; knowing which one to pick is what decides whether the test still
passes next sprint, so the reasoning travels with the data.

## Troubleshooting

```bash
npx omnisnap-mcp --doctor
```

Checks the port and whether a token is stored, then waits for the extension
and walks you through pairing: it prints the code to type into the extension
and waits for that to land. Almost every first-run problem is one of three
things, and this says which.

## Security

You are pairing a tool that can read any page you are signed in to. That
deserves a straight answer about what stops it being abused.

- **Loopback only.** The bridge binds `127.0.0.1`. Nothing off the machine can
  reach it.
- **No web page can connect.** The server requires a `chrome-extension://`
  origin, and a browser sets that header itself — page JavaScript cannot forge
  it.
- **Acting needs a human, every time.** One tool can click or type. It never
  does so on its own: the extension outlines the element in your page and asks
  you to approve or deny, and the Approve control accepts only a real click
  from you. A page can dispatch a click on that button from script; it cannot
  forge `event.isTrusted`. Nothing navigates and nothing submits a form.
- **Pairing needs a human.** The bridge is on a fixed port, so a local process
  could race to claim it. Pairing therefore requires you to read a six-digit
  code from your AI client and type it into the extension. A rogue server can
  issue a code, but it cannot make your AI client show you that code. **If
  your client is not showing one, do not type anything — something else is
  listening on the port.**
- **The code never crosses the socket.** Otherwise a rogue client would read
  it back and pair itself. A test asserts this.
- **Rate limited and short lived.** Six digits, five attempts, two minutes,
  single use.
- **Constant-time comparison** for codes and tokens, against a fixed-width
  buffer so neither value nor length leaks.
- **No telemetry.** No account, no remote config, nothing phones home. The
  only state on disk is the pairing token at `~/.omnisnap/bridge.json`,
  mode `0600`.

Unpair at any time by deleting that file, or from the extension.

**This is not a security boundary.** It is a set of deliberate limits and a
human in the loop, which is a different thing: anyone who can run processes
as you can read that token, and an AI client you pair is a program you have
chosen to trust with your browser. Treat it the way you would treat giving
that client your terminal. The
[MCP security best practices](https://modelcontextprotocol.io/specification/draft/basic/security_best_practices)
are worth reading before you pair anything, this included.

[PROTOCOL.md](PROTOCOL.md) is the full wire format.

## Configuration

Every option is both a flag and an environment variable. A flag wins: it is
in the client config in front of you, where the environment may have come
from a shell profile written months ago.

| Flag | Environment | Default | |
| --- | --- | --- | --- |
| `--port` | `OMNISNAP_PORT` | `8787` | Must match the extension |
| `--log-level` | `OMNISNAP_LOG_LEVEL` | `info` | `silent` · `error` · `warn` · `info` · `debug` |
| `--state-dir` | `OMNISNAP_STATE_DIR` | `~/.omnisnap` | Where the pairing token lives |
| `--call-timeout` | `OMNISNAP_CALL_TIMEOUT_MS` | `30000` | Per call |
| `--capture-timeout` | `OMNISNAP_CAPTURE_TIMEOUT_MS` | `120000` | Captures get longer |
| `--max-concurrent-calls` | `OMNISNAP_MAX_CONCURRENT_CALLS` | `6` | In flight at once |
| `--max-image-bytes` | `OMNISNAP_MAX_IMAGE_BYTES` | `8388608` | Past this, a capture is refused rather than sent |
| `--pairing-ttl` | `OMNISNAP_PAIRING_TTL_MS` | `120000` | How long a pairing code lasts |
| | `OMNISNAP_MAX_FRAME_BYTES` | `25165824` | Any single message from the extension |

`omnisnap-mcp --help` prints the same list with the defaults resolved on your
machine.

### Limits worth knowing

There is one browser at the other end, and much of what it does is serialised:
Chrome allows two screenshots a second, and a prompt waiting on a human cannot
be had twice. So a fan-out of twenty calls is refused at six rather than
turned into a queue whose last entries time out having never been reached.

Screenshots come back as JPEG with the long edge at 1536px — roughly 100KB for
a viewport. Vision models downscale to about that anyway, so anything larger
is paid for and discarded. `read_page` returns up to 12,000 characters by
default and 60,000 on request, which is a fortieth the cost of a picture when
the question is what the page says. `annotate_interactive` numbers at most 60
elements, because a picture with two hundred badges on it is not a map.
`verify_selectors` takes 200 selectors at a time, `watch_page` runs up to 120
seconds and records 60 events of each kind, and only one watch may run on a
page at a time.

Logs go to **stderr**, always. Stdout carries the MCP protocol and a single
stray write to it corrupts the session, so a test spawns the real binary and
asserts every line it emits parses as JSON-RPC.

## Development

```bash
npm install
npm test
```

37 tests: pairing and its failure modes, origin rejection, the bridge end to
end against a fake extension, the stdio contract, the concurrency limit, and
that every option works as a flag, as an environment variable, and in the
right order of precedence.

`tests/extension.test.js` goes further and runs the Chrome extension's own
bridge module, unmodified, against a real server, so the two halves cannot
drift apart unnoticed. It skips unless the extension is checked out beside
this repository.

## Licence

MIT
