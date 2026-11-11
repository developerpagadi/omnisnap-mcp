## What this changes

<!-- One change per pull request. What it does, and why. -->

## Why

<!-- The problem, the constraint, or the bug that produced this shape.
     Comments and commits here record reasons; the code already says what. -->

## Checklist

- [ ] `npm test` passes
- [ ] A test covers the change, and would have caught the bug
- [ ] `node scripts/verify-live.mjs` passes, if this touches the browser
- [ ] A new tool declares its annotations honestly, and is named in
      `tests/stdio.test.js` if it changes anything
- [ ] `server.json` and `package.json` still agree, if versions moved
- [ ] No em dashes in prose
