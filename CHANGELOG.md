# Changelog

## 0.1.0

First release. The bridge and the full tool surface; the browser half of the
bridge is still being built, so calls other than `omnisnap_status` report that
the extension is not paired.

- WebSocket bridge on loopback, with code-comparison pairing, constant-time
  token checks, an extension-only origin policy, rate limiting and heartbeats.
- Twelve tools covering captures, selectors, page objects, diagnostics, design
  tokens and accessibility, all annotated read-only so clients need not prompt.
- Four resources: two guides that work without a browser, the latest capture,
  and pairing help.
- Four prompts: `/write-test`, `/file-bug`, `/audit-accessibility`,
  `/extract-design-system`.
- `--doctor` for diagnosing port, pairing and extension problems.
