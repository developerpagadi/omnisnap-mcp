# Changelog

## 0.2.1

Added `mcpName` so the official MCP registry can verify npm ownership. No
change to behaviour.

## 0.2.0

Requires OmniSnap AI Studio 1.9 or later. Most of this release is tools whose
other half lives in the extension.

### Seeing more than one screenful

`scroll_to` moves the viewport. `annotate_interactive` now reports how much of
the page it is showing, because on a long page a single capture covers a few
per cent of it, and a model with no way to know that will answer confidently
about a page it has barely seen.

### Reading rather than photographing

`read_page` returns text and a heading outline for about a fortieth of a
screenshot's cost. That is the right trade whenever the question is what a page
says rather than what it looks like.

### States an ordinary capture cannot reach

`hover` moves a real pointer through the DevTools protocol. A synthetic event
fires the page's own handlers but leaves `:hover` styling untouched, so the
menu opens and the styling does not. `focus_element` photographs focus rings.
`set_viewport` holds the page at a phone or tablet width, so every tool
afterwards answers about that width. `set_color_scheme` shows it light or dark.

### Waiting instead of asking

`watch_page` reports the console errors, failed requests and layout shifts that
happen during a window of time. Everything else here is a pull, and most of
what goes wrong in a browser does not wait to be asked about.

### Asking the user

`propose_action` can click or type, and never does so alone: the extension
outlines the element and asks for approval in the page. `await_user_selection`
hands the question the other way, so the user clicks the element they mean and
you get it back with ranked selectors.

### Addressing by number

Every tool that takes a selector now also takes `element: 5`, a number from the
last `annotate_interactive`. The map is discarded on navigation rather than
answering with a selector that no longer means what it meant.

### Limits, where there were none

At most six calls in flight. There is one browser at the other end and much of
what it does is serialised, so a fan-out became a queue whose last entries
timed out having never been reached. It is now refused with a message a model
can act on.

Only one `watch_page` may run on a page at a time. Two of them patch
`console.error` in turn, and whichever finishes last restores the other's
wrapper, leaving the page logging through a closure belonging to a watch that
ended.

### Options

Every setting is now a command-line flag as well as an environment variable,
and the flag wins. Clients differ in which they make easy, and `args` is the
one they all support.

### Smaller screenshots

JPEG at 1536px rather than PNG at 2048, which is about a twentieth of the
bytes. Vision models downscale to roughly that size anyway.

## 0.1.0

First release, paired with OmniSnap AI Studio 1.6.0.

- WebSocket bridge on loopback, with constant-time token checks, an
  extension-only origin policy, rate limiting and heartbeats.
- Pairing carries a six-digit code from this server to the user through their
  AI client, and the user types it into the extension. The code never crosses
  the socket, so a program that had claimed the port cannot pair itself.
- Twelve tools, four resources, four prompts.
- `--doctor` for diagnosing port, pairing and extension problems.
