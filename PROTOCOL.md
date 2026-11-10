# Bridge protocol v1

The wire format between `omnisnap-mcp` and the OmniSnap browser extension.
This is the normative description; `src/bridge/ws.js` implements it and
`tests/bridge.test.js` holds it to this document.

## Transport

A WebSocket on `127.0.0.1:8787` by default. **The server listens, the
extension dials out.** The extension never opens a port of its own.

Every frame is a single JSON object carrying `v: 1`. Frames larger than
24 MB are rejected before parsing.

## Who may connect

Two gates, in order.

**Origin.** The server reads the `Origin` header on the upgrade request and
accepts only `chrome-extension://…`, `moz-extension://…` or
`safari-web-extension://…`. A browser sets this header itself and page
JavaScript cannot override it, so **no web page can open this socket at all** —
not a site the user is visiting, not an iframe inside one. A client that sends
no Origin (a CLI, the test harness) is allowed through to the second gate.

**Token.** Every connection must pair or present a token. Until it does, only
`hello` and `pair-approve` are accepted; anything else gets `NOT_AUTHENTICATED`.

## Pairing

The problem being solved: the bridge is on a fixed port, so the first process
to claim 8787 is the one the extension will find. Without a human in the loop,
any local process could stand up a listener and inherit the ability to
screenshot and read every page the user is signed in to.

So the code takes a route the socket cannot reach:

- the server issues the code and reports it to the **AI client**, which shows
  it to the user;
- the user reads it there and **types it into the extension**;
- the extension sends it back here, where it is compared with the original.

A rogue listener on the port can issue a code of its own, but it cannot learn
the one the user's real AI client displayed, and that is the one the user
types. Carrying the code by hand is the entire defence — which is why it is
six readable digits and not a hash.

**The server never sends the code over this socket.** If it did, whatever had
claimed the port could read it back and pair itself with no human involved.
`tests/bridge.test.js` asserts this, and `tests/extension.test.js` asserts
that the shipped extension never invents a code of its own.

A code is single-use, expires after two minutes, and allows five attempts.
Once the budget is spent even the correct code is refused, so interleaving a
guess with a retry buys nothing.

### First connection

```
ext → srv   { "v":1, "type":"hello", "client":"omnisnap-extension", "version":"1.4.1" }
srv → ext   { "v":1, "type":"pair-required", "ttlMs":120000 }
```

The extension asks the user for the code their AI client is showing.

```
ext → srv   { "v":1, "type":"pair-approve", "code":"482193" }
srv → ext   { "v":1, "type":"paired", "token":"…" }
```

On failure:

```
srv → ext   { "v":1, "type":"pair-failed", "reason":"mismatch", "remaining":4 }
```

`reason` is one of `mismatch`, `expired`, `too-many-attempts`, `already-used`.

### Later connections

```
ext → srv   { "v":1, "type":"hello", "client":"omnisnap-extension", "token":"…" }
srv → ext   { "v":1, "type":"ready" }
```

The extension stores the token in `chrome.storage.local`; the server stores it
in `~/.omnisnap/bridge.json`, mode `0600`. Tokens are compared in constant
time against a fixed-width buffer, so neither the value nor its length leaks
through timing.

## Calls

```
srv → ext   { "v":1, "type":"call", "id":"uuid", "tool":"capture_page", "args":{…} }
ext → srv   { "v":1, "type":"result", "id":"uuid", "ok":true, "data":{…} }
ext → srv   { "v":1, "type":"result", "id":"uuid", "ok":false,
              "error":{ "code":"TAB_BLOCKED", "message":"Chrome blocks captures on this page." } }
```

Calls are concurrent and replies may arrive in any order; `id` correlates
them. The server times each one out independently (30 s, or 120 s for a
capture) and fails everything in flight the moment the socket closes, so a
caller never waits on a browser that has demonstrably gone.

`error.message` is shown to the model, so write it for a reader: say what
happened and what would fix it.

## Liveness

The server pings every 20 s. A connection that misses one is terminated — a
half-open socket looks connected and answers nothing, which otherwise turns
into a caller waiting out its full timeout.

A second extension connecting **replaces** the first, which is closed with
code 1012. Two browsers answering one call is a correctness problem.

## Tools the extension must implement

Each corresponds to a tool in `src/tools/index.js`. `args` match that schema.

| Tool | Returns |
| --- | --- |
| `list_tabs` | `{ tabs: [{ id, title, url, active }] }` |
| `capture_page` | `{ base64, mimeType, width, height, scale, url, title }` |
| `capture_element` | same as `capture_page` |
| `annotate_interactive` | `{ capture: {…}, elements: [{ n, label, tag, selector, score, matches }] }` |
| `collect_selectors` | `{ candidates: [{ label, css, xpath, score, matches, why }] }` |
| `get_page_object` | `{ code }` |
| `verify_selectors` | `{ results: [{ selector, matches }] }` |
| `get_diagnostics` | the diagnostics bundle |
| `get_design_tokens` | `{ tokens }` or `{ code }` when a format is given |
| `measure_accessibility` | `{ issues: [{ rule, severity, message, selector }] }` |
| `inspect_element` | the element spec |
| `get_latest_capture` | the most recent capture's metadata |

## Versioning

`v` is the protocol version, independent of the npm package version. A server
meeting an unknown `v` should refuse rather than guess.
