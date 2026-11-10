/**
 * Guides, served as MCP resources.
 *
 * This is the part of the product that is not an API. Any server can return a
 * list of selectors; what decides whether the test still passes next sprint
 * is knowing which one to pick and why. That judgement lives in the
 * extension's scoring engine, but a model that only receives scores has to
 * take them on faith and will cheerfully override them.
 *
 * So the reasoning travels with the data. These are static, need no browser,
 * and work the moment the server starts — which also makes them the one part
 * of the surface that is useful before the extension is paired.
 */

export const SELECTOR_GUIDE = `# Choosing a selector that survives

OmniSnap returns every selector that can reach an element, each with a
stability score out of 100 and a count of how many elements it matches.
Prefer the top result. This explains the ranking so you can tell when to
override it.

## The order, and the reason for it

1. **An explicit test hook** — \`data-testid\`, \`data-test\`, \`data-cy\`, \`data-qa\`.
   Somebody added it on purpose for this. Nothing about the design or the copy
   can move it.
2. **Role and accessible name** — what a user sees and a screen reader
   announces. Survives restyling and re-nesting. This is what Playwright's own
   guidance tells you to reach for first, ahead of test ids.
3. **\`aria-label\`, a form \`name\`, a hand-written \`id\`** — contracts of one
   kind or another. A form field name is part of the submitted payload, so it
   rarely changes without a reason.
4. **Placeholder, visible text** — readable and stable against restyling, but
   a copy edit or a second language breaks them.
5. **CSS path** — depends on where the element sits, so moving it in the
   markup breaks the test.
6. **Absolute XPath** — records the exact position in the tree. Any element
   inserted above it breaks the path.

Note that this inverts the common habit. "Right-click, Copy XPath" produces
item 6, which is why so many suites break on unrelated changes.

## Why some selectors are scored down

A token like \`css-1x2y3z\`, \`sc-bdVaJa\`, \`_button_1a2b3\`, \`makeStyles-root-241\`
or an id like \`:r7:\` is a build artefact. Emotion, styled-components, CSS
modules, JSS and React's \`useId\` all emit them, and they change when the
bundler runs. A selector built on one is a test that fails for a reason
unrelated to any bug.

Scored-down candidates carry a \`why\` explaining which signal fired. Read it
before overriding.

## Uniqueness is not optional

Each candidate reports how many elements it matches **on the live page**.

- \`matches: 1\` — safe.
- \`matches: 0\` — the element is gone, or it has not rendered yet.
- \`matches: 2+\` — the single most common cause of a flaky suite. A selector
  that looks perfect and quietly matches three elements will pick a different
  one depending on timing.

Anything matching more than one element is demoted below even an absolute
XPath, because at least the XPath is unambiguous. If every candidate is
ambiguous, say so rather than picking one.

## The framework matters

The best selector is not a property of the element alone.

- **Playwright** can match a role and an accessible name directly, so
  \`getByRole('button', { name: 'Save' })\` is usually the strongest option.
- **Selenium** has no equivalent and must fall back to CSS or XPath for the
  very same element.
- **Cypress** prefers \`cy.get\` on a test id, or \`cy.contains\` for text.

Always call \`get_page_object\` with the framework you are actually writing
for. The same element yields a different selector for each.

## Before you act on a page

Call \`annotate_interactive\` first. It returns a screenshot with every
interactive element outlined and numbered, plus a selector for each number.
Look at the image, pick the number, use that number's selector. Inferring a
selector from markup you have not seen rendered is where most mistakes start.
`;

export const DIAGNOSTICS_GUIDE = `# Reading OmniSnap diagnostics

\`get_diagnostics\` measures the page in the user's real session: their
network, their extensions, their data, their sign-in. A clean automated
browser cannot show you any of that, which is why a bug that "only happens
for them" often shows up here and nowhere else.

## What the numbers mean

Web Vitals use Google's published thresholds. Largest Contentful Paint good
under 2.5 s, poor over 4 s. Cumulative Layout Shift good under 0.1, poor over
0.25. Interaction to Next Paint good under 200 ms.

## Two mistakes to avoid

**Megabytes are not milliseconds.** A large response is not a slow one unless
the evidence says both. The bundle size and the request duration are separate
fields; do not conflate them in a report.

**Silence is not proof.** Console output only exists while it happens, so if
recording was off before the page loaded, the console section is empty
regardless of what the page did. The payload says whether recording was on.
Absence of errors there is not evidence of no errors.

## Writing it up

Ground every claim in a field that is actually present. Cite the failing
request with its status and URL, the console error with its message, the vital
with its measured value. If the evidence does not support a root cause, say
so — a confident wrong diagnosis costs more than an honest gap.
`;
