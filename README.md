<img src="assets/logo.svg" width="56" alt="" align="left" />

# omnisnap-mcp

**Selectors that don't rot, and a page your agent can actually see.**

Agents guess selectors from a DOM dump, and the test breaks next sprint. This
server returns selectors ranked for how likely they are to survive a redeploy,
each one counted against the live page so you know whether it matches one
element or three. It reads the page as you see it: logged in, in your own
session.

The reading is done by the [OmniSnap AI Studio][store] Chrome extension. This
server is the bridge between it and your AI client.

> **Requires OmniSnap AI Studio 1.9 or later.** The bridge lives in the
> extension. Earlier versions have no **Connect to AI** switch, so this server
> will start and every tool will report that it is not paired. If that happens,
> check the version on the extension's store listing before filing a bug.

[store]: https://chromewebstore.google.com/detail/fjjfegkonlkleomaeopmakhlejjiljga

## How this is different

Several projects connect an agent to your real Chrome through an extension, so
the category is not empty. Tools such as Playwright MCP and Chrome DevTools MCP
drive a browser: they click, type and navigate.

This one reads your browser, and asks before it touches it. What comes back is
not a driven session but the artefacts of a handoff.

- **Your real session.** An automated browser needs a scripted login to reach
  anything behind SSO. This is already in the tab.
- **Scored selectors.** A class like `css-1x2y3z` or an id like `:r7:` is a
  build artefact that changes when the bundler runs. Both are scored down, with
  the reason attached.
- **Uniqueness checked.** A selector that looks perfect and quietly matches
  three elements is the most common cause of a flaky suite. Every candidate is
  counted against the live DOM before you see it.
- **A page it can see.** `annotate_interactive` returns a numbered screenshot
  and a selector for each number, so the model can reason about the picture and
  still act precisely.

## Requirements

- Node.js 18 or newer
- Google Chrome, with [OmniSnap AI Studio][store] 1.9 or later
- An MCP client: Claude Code, Claude Desktop, Cursor, VS Code, Windsurf, Codex,
  Cline, Goose, or anything else that speaks the protocol

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
| **Goose** | Settings, Extensions, Add, as a stdio command |

Anything else that speaks MCP over stdio takes the same `command` and `args`.

</details>

Options go in the same `args` array, which is usually easier than setting
environment variables:

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

Then install the [extension][store], version 1.9 or later. Click its icon and
turn on **Connect to AI**. Ask your agent to call `omnisnap_status`: it reports
a six-digit code. Type that code into the extension. You are paired for good.

If the switch is not there, the installed extension predates the bridge.

## Tools

Twenty-two of them, in three tiers. The tier depends on who has to agree to it.

### It reads

Nothing in this group changes your page.

| Tool | What it gives you |
| --- | --- |
| `omnisnap_status` | Whether the bridge is paired, and how to fix it if not |
| `annotate_interactive` | Numbered screenshot, a selector per number, and how much of the page you are seeing |
| `collect_selectors` | Every selector for an element, ranked and verified |
| `get_page_object` | A page object for Playwright, Selenium, Cypress or WebdriverIO |
| `verify_selectors` | Which of your existing selectors have rotted |
| `read_page` | The page as text, with a heading outline |
| `capture_page`, `capture_element`, `capture_matrix` | Screenshots, including three widths side by side |
| `get_diagnostics` | Vitals, failed requests, console errors, storage |
| `watch_page` | Waits, then reports the errors, failed requests and layout shifts that happened |
| `get_design_tokens` | Palette with contrast audit, type scale, spacing |
| `measure_accessibility` | WCAG failures, with selectors |
| `inspect_element` | Box model and computed styles for one element |
| `list_tabs` | Which tabs can be read |

### It moves the camera

These change what is on screen, not what the page contains. They are declared
as changes rather than as reads.

| Tool | |
| --- | --- |
| `scroll_to` | See the rest of the page. One capture covers one viewport, which on a long page is a few per cent of it |
| `set_viewport` | Hold the page at 375, 768 or 1440, so every tool afterwards answers about that width |
| `set_color_scheme` | Light or dark. Dark mode is where contrast regressions hide |
| `hover`, `focus_element` | Photograph a dropdown, a tooltip or a focus ring. No ordinary capture reaches these |

### It asks before it acts

| Tool | |
| --- | --- |
| `propose_action` | Proposes a click or a keystroke. The extension outlines the element and asks the user in the page. Nothing happens unless they approve |
| `await_user_selection` | Hands the question back. The user clicks the element they mean, and you get it with ranked selectors |

Once an element has a number from `annotate_interactive`, every tool above also
takes `element: 5` instead of a selector you would otherwise copy out of a
table and retype exactly.

## Prompts and resources

Four slash commands: `/write-test`, `/file-bug`, `/audit-accessibility`,
`/extract-design-system`.

| Resource | |
| --- | --- |
| `omnisnap://guide/selectors` | The ranking and the reasoning behind it: what makes a selector fragile, and how the right choice differs per framework |
| `omnisnap://guide/diagnostics` | What the vitals mean, and the two mistakes that produce confidently wrong bug reports |
| `omnisnap://capture/latest` | The most recent screenshot and its metadata |
| `omnisnap://help/pairing` | Install and pairing steps |

The first two work before you have paired anything. Any server can hand back a
list of selectors. Knowing which one to pick is what decides whether the test
still passes next sprint, so the reasoning travels with the data.

## Troubleshooting

```bash
npx omnisnap-mcp --doctor
```

This checks the port, checks whether a token is stored, then waits for the
extension and walks you through pairing. It prints the code to type in and
waits for that to land. Almost every first-run problem is one of three things,
and this says which.

## Security

You are pairing a tool that can read any page you are signed in to. That
deserves a straight answer about what stops it being abused.

- **Loopback only.** The bridge binds `127.0.0.1`. Nothing off the machine can
  reach it.
- **No web page can connect.** The server requires a `chrome-extension://`
  origin. A browser sets that header itself, and page JavaScript cannot forge
  it.
- **Acting needs a human, every time.** One tool can click or type, and it
  never does so on its own. The extension outlines the element in your page and
  asks you to approve or deny. The Approve control accepts only a real click
  from you: a page can dispatch a click on that button from script, but it
  cannot forge `event.isTrusted`. Nothing navigates, and nothing submits a
  form.
- **Pairing needs a human.** The bridge sits on a fixed port, so a local
  process could race to claim it. Pairing therefore requires you to read a
  six-digit code from your AI client and type it into the extension. A rogue
  server can issue a code of its own, but it cannot make your AI client show
  you that code. **If your client is not showing one, type nothing. Something
  else is listening on the port.**
- **The code never crosses the socket.** If it did, a rogue client could read
  it back and pair itself. A test asserts this.
- **Rate limited and short lived.** Six digits, five attempts, two minutes,
  single use.
- **Constant-time comparison** for codes and tokens, against a fixed-width
  buffer, so neither the value nor its length leaks.
- **No telemetry.** No account, no remote config, nothing phones home. The only
  state on disk is the pairing token at `~/.omnisnap/bridge.json`, mode `0600`.

Unpair at any time by deleting that file, or from the extension.

**This is not a security boundary.** It is a set of deliberate limits with a
human in the loop, which is a different claim. Anyone who can run processes as
you can read that token, and an AI client you pair is a program you have chosen
to trust with your browser. Treat it the way you would treat handing that
client your terminal. The
[MCP security best practices](https://modelcontextprotocol.io/specification/draft/basic/security_best_practices)
are worth reading before you pair anything, including this.

[PROTOCOL.md](PROTOCOL.md) is the full wire format.

## Configuration

Every option is both a flag and an environment variable. A flag wins, because
it sits in the client config in front of you, where the environment may have
come from a shell profile written months ago.

| Flag | Environment | Default | |
| --- | --- | --- | --- |
| `--port` | `OMNISNAP_PORT` | `8787` | Must match the extension |
| `--log-level` | `OMNISNAP_LOG_LEVEL` | `info` | `silent`, `error`, `warn`, `info`, `debug` |
| `--state-dir` | `OMNISNAP_STATE_DIR` | `~/.omnisnap` | Where the pairing token lives |
| `--call-timeout` | `OMNISNAP_CALL_TIMEOUT_MS` | `30000` | Per call |
| `--capture-timeout` | `OMNISNAP_CAPTURE_TIMEOUT_MS` | `120000` | Captures get longer |
| `--max-concurrent-calls` | `OMNISNAP_MAX_CONCURRENT_CALLS` | `6` | In flight at once |
| `--max-image-bytes` | `OMNISNAP_MAX_IMAGE_BYTES` | `8388608` | Past this a capture is refused rather than sent |
| `--pairing-ttl` | `OMNISNAP_PAIRING_TTL_MS` | `120000` | How long a pairing code lasts |
| | `OMNISNAP_MAX_FRAME_BYTES` | `25165824` | Any single message from the extension |

`omnisnap-mcp --help` prints the same list with the defaults resolved on your
machine.

### Limits worth knowing

There is one browser at the other end, and much of what it does is serialised.
Chrome allows two screenshots a second, and a prompt waiting on a human cannot
be had twice. A fan-out of twenty calls is therefore refused at six, rather
than becoming a queue whose last entries time out having never been reached.

Screenshots come back as JPEG with the long edge at 1536px, roughly 100KB for a
viewport. Vision models downscale to about that anyway, so anything larger is
paid for and then discarded. `read_page` returns up to 12,000 characters by
default and 60,000 on request, which costs a fortieth of a picture when the
question is what the page says. `annotate_interactive` numbers at most 60
elements, since a picture with two hundred badges on it is no longer a map.
`verify_selectors` takes 200 selectors at a time. `watch_page` runs for up to
120 seconds, records 60 events of each kind, and only one watch may run on a
page at a time.

Logs go to stderr, always. Stdout carries the MCP protocol, and a single stray
write to it corrupts the session, so a test spawns the real binary and asserts
that every line it emits parses as JSON-RPC.

## Development

```bash
npm install
npm test
```

38 tests cover pairing and its failure modes, origin rejection, the bridge end
to end against a fake extension, the stdio contract, the concurrency limit, and
that every option works as a flag, as an environment variable, and in the right
order of precedence.

`tests/extension.test.js` goes further. It runs the Chrome extension's own
bridge module, unmodified, against a real server, so the two halves cannot
drift apart unnoticed. It skips unless the extension is checked out beside this
repository.

## Licence

MIT. Playwright, Chrome and any other product named here are trademarks of
their respective owners, referred to only for comparison.
