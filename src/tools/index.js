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

export const TOOLS = [
  {
    name: 'omnisnap_status',
    title: 'Bridge status',
    description:
      'Reports whether the OmniSnap browser extension is paired with this server, and which tab is active. ' +
      'Call this first when any other OmniSnap tool fails, and to get pairing instructions.',
    schema: {},
    local: true,
  },

  {
    name: 'list_tabs',
    title: 'List open tabs',
    description:
      'Lists the open browser tabs OmniSnap can act on, with their titles and URLs. ' +
      'Use it to find the right tab before capturing or collecting selectors.',
    schema: {},
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
    render: (data) => image(data),
  },

  {
    name: 'capture_element',
    title: 'Capture one element',
    description:
      'Screenshots a single element, given a CSS selector. Cheaper and far easier to reason about ' +
      'than a full page when the question is about one component.',
    schema: {
      selector: z.string().min(1).describe('A CSS selector for the element to capture.'),
    },
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
        .describe('A CSS selector, visible text, or an accessible name identifying the element.'),
    },
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
    render: (data) => (data.code ? text(data.code) : json(data)),
  },

  {
    name: 'measure_accessibility',
    title: 'Accessibility check',
    description:
      'Audits the live page for contrast failures, missing accessible names, skipped heading levels ' +
      'and touch targets below the minimum size. Returns the offending elements with selectors.',
    schema: {},
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
      selector: z.string().min(1).describe('A CSS selector for the element to measure.'),
    },
    render: (data) => json(data),
  },
];

export const LOCAL_TOOLS = new Set(TOOLS.filter((t) => t.local).map((t) => t.name));
