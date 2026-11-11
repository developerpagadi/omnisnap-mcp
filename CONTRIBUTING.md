# Contributing

Thanks for looking. This is a small project with opinions, so it is worth
saying what those are before you spend time on a change.

## Getting set up

```bash
npm install
npm test
```

Node 18 or newer. There is no build step; the published package is the source.

The test suite runs against stubs and a fake extension, so it needs no
browser. Two things it cannot check are whether the service worker registers
and whether a tool behaves against a real page. For those:

```bash
node scripts/verify-live.mjs
```

That needs Chrome, the extension installed and paired, and an ordinary page in
the active tab. It refuses to run against a stale extension build, because a
stale service worker answers every call perfectly well with the previous
build's behaviour. That reads as a pass and is the most expensive kind of
wrong answer.

## What this project is

A bridge, and a set of tools whose other half lives in a Chrome extension.
Almost everything reads. A few tools change what is on screen. Exactly one can
click or type, and it cannot do so without a person approving it in the page.

Changes that give the agent more reach without a person in the loop will not
be merged. That constraint is the product, not an oversight.

## House style

- **Tools return things a model can act on.** An error that says what went
  wrong and which tool to call instead is worth more than a stack trace. Most
  of the dispatcher tests are about error paths for this reason.
- **Limits are declared, not discovered.** If a tool can be called in a way
  that queues, leaks or floods, bound it and say so in the message.
- **Annotations tell the truth.** A tool that moves the viewport is not
  `readOnlyHint: true`, even though claiming otherwise would skip a prompt.
  `tests/stdio.test.js` enforces this, and a new tool that changes anything
  has to be named there.
- **Comments explain why, not what.** The code says what it does. A comment
  earns its place by recording the reason, the constraint, or the bug that
  produced the shape.
- **Prose reads like a person wrote it.** Plain sentences. No em dashes.

## Tests

Every behavioural change needs one. The suite is `node --test`, no framework.

Prefer a test that would have caught the bug over one that restates the
implementation. Several tests here exist because something shipped broken:
the stdout guard, the concurrency limit, the version match. Each names the
failure it prevents.

## Opening a pull request

Keep it to one change. Say what it does and why in the description, run
`npm test`, and run `scripts/verify-live.mjs` if you touched anything that
talks to the browser.

For anything large, open an issue first. It is easier to disagree about an
idea than about a branch you have already written.

## Security

Please do not report security problems in a public issue. See
[SECURITY.md](SECURITY.md).
