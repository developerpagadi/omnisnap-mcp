# omnisnap-mcp

**Selectors that don't rot, and a page your agent can actually see.**

Agents guess selectors from a DOM dump, and the test breaks next sprint.
`omnisnap-mcp` returns selectors ranked for how likely they are to survive a
redeploy and checked against the live page so you know whether each one
matches a single element or several — taken from the page as *you* see it,
logged in, in your own session.

It needs the [OmniSnap AI Studio][store] Chrome extension, which does the
reading. This server is the bridge.

[store]: https://chromewebstore.google.com/detail/fjjfegkonlkleomaeopmakhlejjiljga

## Why not Playwright MCP

Those drive a browser: click, type, navigate. This one **reads** a browser and
hands back artefacts.

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

Claude Desktop: `~/Library/Application Support/Claude/claude_desktop_config.json`.
Cursor: `~/.cursor/mcp.json`. Claude Code: `claude mcp add omnisnap -- npx -y omnisnap-mcp`.

Then install the [extension][store], click its icon, choose **Connect to AI**,
and approve the pairing code. Once. Ask your agent to call `omnisnap_status`
to confirm.

## Tools

| Tool | What it gives you |
| --- | --- |
| `omnisnap_status` | Whether the bridge is paired, and how to fix it if not |
| `annotate_interactive` | Numbered screenshot + a selector per number |
| `collect_selectors` | Every selector for an element, ranked and verified |
| `get_page_object` | A page object for Playwright, Selenium, Cypress, WebdriverIO |
| `verify_selectors` | Which of your existing selectors have rotted |
| `capture_page` · `capture_element` | Screenshots the model can see |
| `get_diagnostics` | Vitals, failed requests, console errors, storage |
| `get_design_tokens` | Palette with contrast audit, type scale, spacing |
| `measure_accessibility` | WCAG AA failures with selectors |
| `inspect_element` | Box model and computed styles for one element |

Plus resources (`omnisnap://capture/latest`) and four slash commands:
`/write-test`, `/file-bug`, `/audit-accessibility`, `/extract-design-system`.

## Security

You are pairing a tool that can read any page you are signed in to. That
deserves a straight answer about what stops it being abused.

- **Loopback only.** The bridge binds `127.0.0.1`. Nothing off the machine can
  reach it.
- **No web page can connect.** The server requires a `chrome-extension://`
  origin, and a browser sets that header itself — page JavaScript cannot forge
  it.
- **Pairing needs a human.** The bridge is on a fixed port, so a local process
  could race to claim it. Pairing therefore requires you to compare the code
  your AI client reports against the one the extension shows. A rogue server
  can produce a code but cannot make your AI client report it. **If the two
  codes differ, do not approve — something else is listening.**
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

[PROTOCOL.md](PROTOCOL.md) is the full wire format.

## Configuration

| Variable | Default | |
| --- | --- | --- |
| `OMNISNAP_PORT` | `8787` | Must match the extension |
| `OMNISNAP_LOG_LEVEL` | `info` | `silent` · `error` · `warn` · `info` · `debug` |
| `OMNISNAP_STATE_DIR` | `~/.omnisnap` | Where the pairing token lives |
| `OMNISNAP_CALL_TIMEOUT_MS` | `30000` | Per call |
| `OMNISNAP_CAPTURE_TIMEOUT_MS` | `120000` | Captures get longer |

Logs go to **stderr**, always. Stdout carries the MCP protocol and a single
stray write to it corrupts the session, so a test spawns the real binary and
asserts every line it emits parses as JSON-RPC.

## Development

```bash
npm install
npm test
```

28 tests: pairing and its failure modes, origin rejection, the bridge end to
end against a fake extension, and the stdio contract.

## Licence

MIT
