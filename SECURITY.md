# Security

This project pairs an AI client with a browser that is signed in to things.
That deserves a clear statement of what is defended, what is not, and how to
tell us when we have got it wrong.

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Use GitHub's [private vulnerability reporting][advisories] on this repository,
or email **hello@omnisnap.metago.in**.

Include what you did, what happened, and what you expected. A proof of concept
helps, even a rough one. We will confirm receipt within three working days and
tell you what we intend to do about it.

This is a small project with no bounty programme. What we can offer is a
prompt answer, credit in the release notes if you want it, and a fix.

[advisories]: https://github.com/developerpagadi/omnisnap-mcp/security/advisories/new

## Supported versions

The latest minor release on npm. Fixes are not backported.

## What is defended

- **The socket is loopback only.** The bridge binds `127.0.0.1`. Nothing off
  the machine can reach it.
- **No web page can connect.** The server requires a `chrome-extension://`,
  `moz-extension://` or `safari-web-extension://` origin. A browser sets that
  header itself and page JavaScript cannot override it.
- **Pairing requires a person.** The port is fixed, so another local process
  could claim it first. Pairing therefore depends on a six-digit code that
  travels from this server to the user through their AI client, and is typed
  into the extension by hand. The code never crosses the socket, so a program
  that had claimed the port cannot learn it.
- **Codes are rate limited and short lived.** Six digits, five attempts, two
  minutes, single use. Codes and tokens are compared in constant time against
  a fixed-width buffer, so neither the value nor its length leaks through
  timing.
- **Acting requires a person, every time.** One tool can click or type. The
  extension outlines the element in the page and asks the user to approve. The
  Approve control accepts only `event.isTrusted`, so a page can dispatch a
  click on that button from script but cannot authorise itself. No tool
  navigates, and no tool submits a form.
- **Secrets are redacted from logs.** Fields named `token`, `secret`, `code`,
  `authorization` and `password` are replaced before anything reaches stderr,
  so pasting debug output into an issue does not hand over a pairing token.
- **Nothing is transmitted off the machine.** No account, no telemetry, no
  remote configuration. The only state on disk is the pairing token at
  `~/.omnisnap/bridge.json`, written mode `0600`.

## What is not defended

Say this plainly, because the limits matter more than the list above.

- **This is not a security boundary.** It is a set of deliberate limits with a
  person in the loop. Anyone who can already run processes as you can read the
  pairing token and talk to the bridge.
- **The AI client you pair is trusted.** Once paired it can read any page you
  are signed in to. Treat pairing the way you would treat giving that client
  your terminal.
- **Page content leaves the machine if your client sends it.** The bridge does
  not transmit anything, but a cloud-based AI client necessarily does. That is
  the point of connecting one, and it is the one place where "nothing leaves
  your device" stops being true.
- **A page can see that an action was proposed.** The approval card lives in
  the page's DOM, inside a shadow root. A hostile page can observe it and can
  remove it. It cannot approve it.

The [MCP security best practices][best-practices] are worth reading before
pairing anything, this included.

[best-practices]: https://modelcontextprotocol.io/specification/draft/basic/security_best_practices
