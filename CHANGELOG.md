# Changelog

## 0.4.0

Requires OmniSnap AI Studio 1.10 or later.

### `audit_page`: problems only a rendered page has

Six checks that need a real browser, and that reading the source cannot find.
The one that justifies the rest asks what a click on a control would actually
hit, which is how you learn that a consent banner is sitting on the submit
button. In the source those two components know nothing about each other and
neither is wrong.

Also: text cut off by its own container, a page that scrolls sideways, a
webfont that was asked for and never arrived, images with nothing reserving
their box, and text too small to read.

Hit testing cannot see past the fold, so the report says how much of the page
it could see rather than implying it checked all of it.

### `diff_capture`: did the change land

Call it, edit, call it again. The regions that moved come back outlined on the
newer frame. Two screenshots answer this badly, because the eye has to hunt
and most of the frame is identical.

The baseline is per URL and held in memory only. One that outlived the session
would quietly compare against yesterday, and nothing would say so.

### A design system you can commit

`get_design_tokens` takes `format: "markdown"` and returns a dated DESIGN.md
with the contrast audit inline, for the repository rather than the
conversation.

### Three more slash commands

`/check-responsive` walks phone, tablet and desktop and audits each, because
most of what audit_page finds exists at one width only. `/find-flaky-selectors`
checks the selectors you already have and offers scored replacements.
`/why-is-this-slow` reads the diagnostics, then watches for ten seconds to
catch what a snapshot on arrival cannot.

## 0.3.0

### `omnisnap_status` says when the extension is too old

Ten of the twenty-two tools arrived with extension 1.9. An older extension
connects and pairs perfectly well, then refuses those ten one at a time, which
reads as a broken server rather than a browser extension in need of an update.

Status now compares the version the extension reports in its handshake against
the minimum, names every tool that will refuse, and says where to update. Both
in the prose and in `structuredContent`, so a client can act on it without
parsing English.

### Documentation

Rewritten around a worked example rather than a feature list, with a branded
banner, a comparison table, and a troubleshooting table covering the failures
people actually hit. Both the SVG and the PNG are generated from one script so
the two cannot drift.

## 0.2.3

The repository is public, so the links that pointed nowhere now point
somewhere: `repository` is back in `package.json`, and `server.json` carries
it too, which is what directories read to find the README, the licence and the
tool list.

Project scaffolding for a public repository: SECURITY.md, CONTRIBUTING.md,
issue and pull request templates, an editorconfig, and two workflows. CI runs
the suite on Node 18 and 22, installs the packed tarball to prove it starts,
and fails if `server.json` and `package.json` disagree about the version. The
release workflow publishes with `--provenance`, so npm records which commit
and which workflow built the tarball.

Prose in the source was rewritten the same way the docs were. The selector and
diagnostics guides are served to AI clients, so people read them.

## 0.2.2

Documentation only. The README, this changelog and PROTOCOL.md were rewritten
for plainer prose. No change to behaviour.

The comparison section is now headed "How this is different" rather than
naming another project in the heading, and names Playwright MCP and Chrome
DevTools MCP in the body as examples of the category. It also states plainly
that connecting an agent to your real browser is not a unique idea, which is
true and was previously implied otherwise.

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
