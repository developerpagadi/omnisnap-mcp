/**
 * The tool catalogue.
 *
 * Each entry is data, not code: a name, a description the model reads when
 * deciding what to call, a Zod shape, and how to turn the extension's answer
 * into MCP content. Keeping them declarative means the server file stays a
 * loop, the test suite can assert the whole surface without starting
 * anything, and adding a tool is one object rather than a new handler.
 *
 * The descriptions matter more than they look. A model picks a tool by
 * reading them, so each one says what it returns and when to reach for it,
 * not merely what it is.
 */
import { z } from 'zod';
import { config } from '../lib/config.js';

const text = (value) => ({ content: [{ type: 'text', text: value }] });

const json = (value, summary) => ({
  content: [{ type: 'text', text: summary || JSON.stringify(value, null, 2) }],
  structuredContent: value,
});

/**
 * An image plus the words that make it usable. A bare screenshot leaves the
 * model guessing at scale and origin, so the dimensions travel with it.
 */
function image(data, note) {
  if (!data || !data.base64) return text(note || 'The extension returned no image.');

  const bytes = Math.floor((data.base64.length * 3) / 4);
  if (bytes > config.maxImageBytes) {
    return text(
      `The capture is ${(bytes / 1024 / 1024).toFixed(1)} MB, over the ${(
        config.maxImageBytes /
        1024 /
        1024
      ).toFixed(0)} MB limit. Capture a region or a single breakpoint instead.`
    );
  }

  return {
    content: [
      { type: 'image', data: data.base64, mimeType: data.mimeType || 'image/png' },
      {
        type: 'text',
        text:
          note ||
          `Capture of ${data.url || 'the page'} at ${data.width}x${data.height} px` +
            (data.scale ? ` (${data.scale}x device pixels)` : '') +
            '.',
      },
    ],
    structuredContent: { width: data.width, height: data.height, url: data.url, title: data.title },
  };
}

const VIEWPORT = z
  .enum(['current', 'mobile', 'tablet', 'desktop', 'wide'])
  .describe('Render the page at a breakpoint before capturing. "current" uses the window as it is.');

/**
 * Annotations, and why every tool carries them.
 *
 * The spec's defaults are `readOnlyHint: false` and `destructiveHint: true`,
 * so a tool that says nothing is treated as potentially destructive and the
 * client asks the user to confirm it. Every tool here only reads, and a
 * confirmation dialog in front of each capture would make the server tedious
 * enough to uninstall.
 *
 * `openWorldHint` is true for anything that touches the live page, because
 * the web changes underneath you and the same call can legitimately return
 * something different each time. Status is the exception: it only inspects
 * local state.
 *
 * These are hints, not a security boundary. The real boundary is pairing.
 */
const READS_THE_PAGE = { readOnlyHint: true, openWorldHint: true };
const READS_LOCAL = { readOnlyHint: true, openWorldHint: false };

/**
 * Moves the viewport, which the user will see happen. Not destructive and
 * safe to repeat, but declaring it read-only would be a lie: the page they
 * were looking at is not where they left it.
 */
const MOVES_THE_VIEW = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true };

/** Waits for a person. Changes nothing, but takes as long as they take. */
const ASKS_THE_USER = { readOnlyHint: true, openWorldHint: true };

/** A number from annotate_interactive, usable anywhere a selector is. */
const ELEMENT_REF = z
  .number()
  .int()
  .positive()
  .optional()
  .describe('A number from the most recent annotate_interactive on this tab. Easier and safer than retyping a selector.');

export const TOOLS = [
  {
    name: 'omnisnap_status',
    title: 'Bridge status',
    description:
      'Reports whether the OmniSnap browser extension is paired with this server, and which tab is active. ' +
      'Call this first when any other OmniSnap tool fails, and to get pairing instructions.',
    schema: {},
    local: true,
    annotations: READS_LOCAL,
  },

  {
    name: 'list_tabs',
    title: 'List open tabs',
    description:
      'Lists the open browser tabs OmniSnap can act on, with their titles and URLs. ' +
      'Use it to find the right tab before capturing or collecting selectors.',
    schema: {},
    annotations: READS_THE_PAGE,
    render: (data) =>
      json(
        data,
        (data.tabs || [])
          .map((t, i) => `${i + 1}. ${t.active ? '* ' : '  '}${t.title}\n     ${t.url}`)
          .join('\n') || 'No capturable tabs are open.'
      ),
  },

  {
    name: 'capture_page',
    title: 'Capture the page',
    description:
      'Takes a screenshot of the active tab and returns it as an image the model can see. ' +
      'Captures the full scrollable page by default, including pages that scroll inside a panel. ' +
      'Use it to check layout, verify a fix visually, or see what the user is describing.',
    schema: {
      mode: z
        .enum(['full', 'viewport', 'region'])
        .default('full')
        .describe('"full" stitches the whole page, "viewport" takes only what is on screen.'),
      viewport: VIEWPORT.default('current'),
    },
    annotations: READS_THE_PAGE,
    render: (data) => image(data),
  },

  {
    name: 'capture_element',
    title: 'Capture one element',
    description:
      'Screenshots a single element, given a CSS selector. Cheaper and far easier to reason about ' +
      'than a full page when the question is about one component.',
    schema: {
      selector: z.string().min(1).optional().describe('A CSS selector for the element to capture.'),
      element: ELEMENT_REF,
    },
    annotations: READS_THE_PAGE,
    render: (data) => image(data),
  },

  {
    name: 'annotate_interactive',
    title: 'Numbered map of interactive elements',
    description:
      'Returns a screenshot with every interactive element outlined and numbered, plus a table ' +
      'mapping each number to its best selector and a stability score. ' +
      'This is the tool to use before acting on a page: look at the image, pick a number, then use ' +
      'that number\'s selector. Far more reliable than guessing a selector from the DOM.',
    schema: {
      viewport: VIEWPORT.default('current'),
      include: z
        .enum(['all', 'controls', 'links'])
        .default('controls')
        .describe('"controls" covers buttons, inputs and selects; "all" adds links and landmarks.'),
    },
    annotations: READS_THE_PAGE,
    render: (data) => {
      const rows = (data.elements || [])
        .map(
          (e) =>
            `${String(e.n).padStart(2)}. ${e.label || e.tag}\n    ${e.selector}\n    stability ${
              e.score
            }/100 · ${e.matches === 1 ? 'unique' : `${e.matches} matches`}`
        )
        .join('\n');

      const picture = image(data.capture, `${(data.elements || []).length} interactive elements.`);
      return {
        content: [...picture.content, { type: 'text', text: rows || 'No interactive elements found.' }],
        structuredContent: { elements: data.elements },
      };
    },
  },

  {
    name: 'collect_selectors',
    title: 'Selectors for an element',
    description:
      'Given a description or a CSS hint, returns every selector that could reach the element, ' +
      'ranked by how likely it is to survive a redeploy and checked against the live page so you ' +
      'know whether it matches one element or several. ' +
      'Prefer the top result. A selector built on a generated class such as css-1x2y3z is scored ' +
      'down because it changes whenever the bundler runs.',
    schema: {
      hint: z
        .string()
        .min(1)
        .optional()
        .describe('A CSS selector, visible text, or an accessible name identifying the element.'),
      element: ELEMENT_REF,
    },
    annotations: READS_THE_PAGE,
    render: (data) =>
      json(
        data,
        (data.candidates || [])
          .map(
            (c) =>
              `${c.label} · ${c.score}/100 · ${c.matches === 1 ? 'unique' : `${c.matches} matches`}\n  ${
                c.xpath || c.css
              }\n  ${c.why}`
          )
          .join('\n\n') || 'Nothing on the page matched that hint.'
      ),
  },

  {
    name: 'get_page_object',
    title: 'Page object for a framework',
    description:
      'Exports the selectors collected in the browser as a ready page object. ' +
      'The best selector differs per framework: Playwright can match a role and an accessible name, ' +
      'Selenium cannot and falls back to CSS or XPath for the same element, so always pass the ' +
      'framework you are actually writing for.',
    schema: {
      framework: z
        .enum([
          'playwright-ts',
          'playwright-py',
          'selenium-java',
          'selenium-py',
          'cypress',
          'webdriverio',
          'xpath',
          'css',
          'json',
        ])
        .describe('The test framework the output should be written for.'),
    },
    annotations: READS_THE_PAGE,
    render: (data) => text(data.code || 'Nothing has been collected on this tab yet.'),
  },

  {
    name: 'verify_selectors',
    title: 'Check selectors still match',
    description:
      'Takes a list of selectors and reports, for each, how many elements it matches on the page now. ' +
      'Use it to find selectors that have rotted after a UI change, before a test run does.',
    schema: {
      selectors: z.array(z.string().min(1)).min(1).max(200).describe('CSS or XPath selectors to check.'),
    },
    annotations: READS_THE_PAGE,
    render: (data) =>
      json(
        data,
        (data.results || [])
          .map(
            (r) =>
              `${r.matches === 1 ? 'ok   ' : r.matches === 0 ? 'BROKEN' : 'AMBIG '} ${r.matches} · ${
                r.selector
              }`
          )
          .join('\n')
      ),
  },

  {
    name: 'get_diagnostics',
    title: 'Page health and failures',
    description:
      'Returns Web Vitals, failed and slow network requests, console errors, storage use and the ' +
      'exact browser environment for the active tab. ' +
      'This is measured in the user\'s real session, so it reflects their network, their extensions ' +
      'and their data, which a clean automated browser cannot show you.',
    schema: {},
    annotations: READS_THE_PAGE,
    render: (data) => json(data),
  },

  {
    name: 'get_design_tokens',
    title: 'Colours, type and spacing',
    description:
      'Extracts the design system the page actually uses: palette with contrast audit, type scale, ' +
      'radii, shadows and spacing. Use it to match a new component to an existing product, or to ' +
      'find accessibility problems in the live UI.',
    schema: {
      format: z
        .enum(['json', 'css', 'tailwind', 'scss'])
        .default('json')
        .describe('Output shape. "css" emits custom properties.'),
    },
    annotations: READS_THE_PAGE,
    render: (data) => (data.code ? text(data.code) : json(data)),
  },

  {
    name: 'measure_accessibility',
    title: 'Accessibility check',
    description:
      'Audits the live page for contrast failures, missing accessible names, skipped heading levels ' +
      'and touch targets below the minimum size. Returns the offending elements with selectors.',
    schema: {},
    annotations: READS_THE_PAGE,
    render: (data) =>
      json(
        data,
        (data.issues || [])
          .map((i) => `${i.severity.toUpperCase()} ${i.rule}: ${i.message}\n  ${i.selector}`)
          .join('\n') || 'No accessibility problems were detected.'
      ),
  },

  {
    name: 'inspect_element',
    title: 'Measurements for one element',
    description:
      'Returns the box model, computed typography, colours and spacing for a single element. ' +
      'Use it when a design question needs numbers rather than a picture.',
    schema: {
      selector: z.string().min(1).optional().describe('A CSS selector for the element to measure.'),
      element: ELEMENT_REF,
    },
    annotations: READS_THE_PAGE,
    render: (data) => json(data),
  },

  {
    name: 'scroll_to',
    title: 'Move the viewport',
    description:
      'Scrolls the page. Use it to see the rest of a page: annotate_interactive and the ' +
      'screenshots only cover what is on screen, and its "coverage" field says how much of the ' +
      'page that is. Scroll, then capture again. ' +
      'This moves the camera, not the hands: it cannot click, type or navigate.',
    schema: {
      selector: z.string().min(1).optional().describe('Scroll until this element is centred.'),
      element: ELEMENT_REF,
      to: z
        .enum(['top', 'bottom', 'next', 'previous'])
        .optional()
        .describe('"next" and "previous" move by about one screen.'),
      y: z.number().optional().describe('An absolute scroll position in CSS pixels.'),
    },
    annotations: MOVES_THE_VIEW,
    render: (data) =>
      json(
        data,
        `At ${data.scrollY}px of ${data.pageHeight}px.` +
          (data.atBottom ? ' This is the bottom of the page.' : '') +
          (data.atTop ? ' This is the top of the page.' : '')
      ),
  },

  {
    name: 'await_user_selection',
    title: 'Ask the user to point at it',
    description:
      'Arms the element picker in the browser and waits for the user to click the elements ' +
      'they mean, then returns them with ranked selectors. ' +
      'Use this instead of guessing when a page has several things that match the description ' +
      '("the save button", "that broken card"), or when you cannot find what the user is ' +
      'describing. Asking costs one turn; picking the wrong element costs the whole task.',
    schema: {
      timeoutMs: z
        .number()
        .int()
        .min(5_000)
        .max(600_000)
        .default(180_000)
        .describe('How long to wait for the user. They need time to find the element.'),
    },
    annotations: ASKS_THE_USER,
    render: (data) =>
      json(
        data,
        (data.elements || [])
          .map((e) => `${e.label} (${e.tag}) · ${e.score}/100\n  ${e.selector}`)
          .join('\n\n') || 'The user chose nothing.'
      ),
  },

  {
    name: 'capture_matrix',
    title: 'The page at three widths',
    description:
      'Captures the full page at phone, tablet and desktop widths and returns them side by side ' +
      'in one image. Use it to check a responsive change in a single look, rather than three ' +
      'captures you have to hold in mind at once.',
    schema: {
      widths: z
        .array(z.enum(['mobile', 'tablet', 'desktop']))
        .min(1)
        .max(3)
        .optional()
        .describe('Defaults to all three: 375, 768 and 1440.'),
    },
    annotations: READS_THE_PAGE,
    render: (data) => image(data),
  },
];

export const LOCAL_TOOLS = new Set(TOOLS.filter((t) => t.local).map((t) => t.name));
