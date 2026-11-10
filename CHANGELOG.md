# Changelog

## 0.1.0

First release, paired with OmniSnap AI Studio 1.6.0, which is the half of the
bridge that lives in the browser.

- WebSocket bridge on loopback, with constant-time token checks, an
  extension-only origin policy, rate limiting and heartbeats.
- Pairing carries a six-digit code from this server to the user through their
  AI client, and the user types it into the extension. The code never crosses
  the socket, so a program that had claimed the port cannot pair itself.
- Twelve tools covering captures, selectors, page objects, diagnostics, design
  tokens and accessibility, all annotated read-only so clients need not prompt.
- Four resources: two guides that work without a browser, the latest capture,
  and pairing help.
- Four prompts: `/write-test`, `/file-bug`, `/audit-accessibility`,
  `/extract-design-system`.
- `--doctor` for diagnosing port, pairing and extension problems.
- 35 tests, including one suite that runs the shipped extension's own bridge
  module against a real server so the two halves cannot drift apart.
