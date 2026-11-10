/**
 * The MCP server.
 *
 * Tools, resources and prompts are registered from the declarative catalogue,
 * so this file is a loop rather than a pile of handlers.
 *
 * Most MCP servers ship tools only. Resources let a client attach a capture
 * as context without the model spending a tool call to fetch it, and prompts
 * become slash commands in the client, which is what turns a pile of
 * capabilities into something that feels like a product.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { TOOLS } from './tools/index.js';
import { readFileSync } from 'node:fs';
import { Bridge } from './bridge/ws.js';
import { config } from './lib/config.js';
import { log } from './lib/logger.js';
import { BridgeError, NOT_PAIRED, PAIRING_PENDING, toToolError, STORE_URL } from './lib/errors.js';
import { SELECTOR_GUIDE, DIAGNOSTICS_GUIDE } from './guides.js';

/**
 * Read from package.json rather than written here.
 *
 * A second copy of the version drifts the first time someone bumps one and
 * not the other, and the symptom is a server that reports an old version to
 * every client it ever talks to — which looks like a stale install and sends
 * people to reinstall something that was already current.
 */
export const VERSION = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
).version;

/**
 * Every failure a tool can have, turned into something an agent can act on.
 * The two cases worth special handling are the ones a user can fix, and in
 * both the reply is the remedy rather than the diagnosis.
 */
function explain(error, bridge) {
  if (error instanceof BridgeError) {
    if (error.code === 'NOT_PAIRED') {
      return { isError: true, content: [{ type: 'text', text: NOT_PAIRED }], structuredContent: { ok: false, code: 'NOT_PAIRED' } };
    }
    if (error.code === 'PAIRING_PENDING') {
      const code = bridge.pendingCode;
      return {
        isError: true,
        content: [{ type: 'text', text: code ? PAIRING_PENDING(code) : NOT_PAIRED }],
        structuredContent: { ok: false, code: 'PAIRING_PENDING' },
      };
    }
  }
  return toToolError(error);
}

function statusReport(bridge, listening) {
  if (!listening.ok) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: listening.inUse
            ? `The bridge could not claim port ${config.port}: something else is already listening.\n\n` +
              'Either another copy of omnisnap-mcp is running, or an unrelated process owns the port. ' +
              'Close the other copy, or set OMNISNAP_PORT to a free port in both the MCP client config ' +
              'and the extension.'
            : `The bridge could not start: ${listening.error}`,
        },
      ],
      structuredContent: { ok: false, code: 'BRIDGE_UNAVAILABLE' },
    };
  }

  if (bridge.state === 'pairing') {
    return { content: [{ type: 'text', text: PAIRING_PENDING(bridge.pendingCode) }], structuredContent: { ok: false, state: 'pairing' } };
  }

  if (bridge.state !== 'ready') {
    return { content: [{ type: 'text', text: NOT_PAIRED }], structuredContent: { ok: false, state: 'disconnected' } };
  }

  return {
    content: [
      {
        type: 'text',
        text:
          `OmniSnap is connected.\n` +
          `  extension: ${bridge.client ? `${bridge.client.name} ${bridge.client.version}` : 'paired'}\n` +
          `  bridge:    ${config.host}:${config.port}\n\n` +
          'Every OmniSnap tool is available.',
      },
    ],
    structuredContent: { ok: true, state: 'ready', client: bridge.client },
  };
}

export function createServer() {
  const server = new McpServer(
    { name: 'omnisnap', version: VERSION },
    {
      instructions:
        'OmniSnap reads the user\'s real, logged-in browser through a paired Chrome extension.\n\n' +
        'Reach for it when a question is about a page that actually exists: what it looks like now, ' +
        'which selectors a test should use, why it is slow, or what its design system is. ' +
        'It reads pages; it does not drive them, so it will not click or navigate.\n\n' +
        'Before acting on a page, call annotate_interactive: it returns a numbered screenshot plus a ' +
        'selector for each number, which is far more reliable than inferring a selector from markup. ' +
        'If a tool reports the extension is not paired, relay its instructions to the user verbatim.',
    }
  );

  const bridge = new Bridge();
  let listening = { ok: false, error: 'not started' };

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.schema,
        annotations: tool.annotations,
      },
      async (args) => {
        try {
          if (tool.name === 'omnisnap_status') return statusReport(bridge, listening);
          const data = await bridge.call(tool.name, args || {});
          return tool.render ? tool.render(data || {}) : toToolError(new BridgeError('EMPTY', 'No data.'));
        } catch (error) {
          log.warn('tool failed', { tool: tool.name, error: String(error && error.message) });
          return explain(error, bridge);
        }
      }
    );
  }

  /* ── resources ──
     Attachable context. A client can hand the model the latest capture
     without spending a tool call, which matters when the user already knows
     what they want to talk about. */

  server.registerResource(
    'latest-capture',
    'omnisnap://capture/latest',
    {
      title: 'Latest capture',
      description: 'The most recent screenshot taken in the browser, with its metadata.',
      mimeType: 'application/json',
    },
    async (uri) => {
      try {
        const data = await bridge.call('get_latest_capture', {});
        return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(data, null, 2) }] };
      } catch (error) {
        return { contents: [{ uri: uri.href, mimeType: 'text/plain', text: String(error.message) }] };
      }
    }
  );

  /*
   * The reasoning, not just the data. A model that receives scores without
   * knowing what they mean will override them; one that has read this will
   * not. These need no browser, so they are the one part of the surface that
   * works before pairing.
   */
  server.registerResource(
    'selector-guide',
    'omnisnap://guide/selectors',
    {
      title: 'How to choose a selector that survives',
      description:
        'The ranking OmniSnap applies and why, what makes a selector fragile, and how the right ' +
        'choice differs between Playwright, Selenium and Cypress. Read this before writing tests.',
      mimeType: 'text/markdown',
    },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: SELECTOR_GUIDE }] })
  );

  server.registerResource(
    'diagnostics-guide',
    'omnisnap://guide/diagnostics',
    {
      title: 'How to read OmniSnap diagnostics',
      description:
        'What the vitals thresholds mean, and the two mistakes that produce confidently wrong ' +
        'defect reports. Read this before writing one up.',
      mimeType: 'text/markdown',
    },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: DIAGNOSTICS_GUIDE }] })
  );

  server.registerResource(
    'bridge-help',
    'omnisnap://help/pairing',
    {
      title: 'How to pair OmniSnap',
      description: 'Install and pairing steps for the browser extension.',
      mimeType: 'text/markdown',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'text/markdown',
          text: `# Pairing OmniSnap\n\n1. Install the extension: ${STORE_URL}\n2. Click the OmniSnap icon, then turn on **Connect to AI**.\n3. Call \`omnisnap_status\` for the six-digit code, and type it into the\n   extension when it asks.\n\nThe code travels from this server to you and from you to the user. If the\nextension already shows a code of its own, something else is listening on the\nbridge port and pairing should not continue.\n\nThe bridge listens on ${config.host}:${config.port}.\n`,
        },
      ],
    })
  );

  /* ── prompts ──
     These surface as slash commands. Cheap to add and the thing that makes
     the server feel like a tool rather than an API. */

  const prompt = (name, title, description, argsSchema, build) =>
    server.registerPrompt(name, { title, description, argsSchema }, build);

  prompt(
    'write-test',
    'Write a test for this page',
    'Collects stable selectors from the open page and writes a test against them.',
    { framework: z.string().describe('playwright-ts, selenium-py, cypress, and so on.'), flow: z.string().describe('The user journey to cover.') },
    ({ framework, flow }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              `Write a ${framework} test covering: ${flow}\n\n` +
              'First call annotate_interactive to see the page and get numbered selectors. ' +
              'Then call get_page_object with this framework. ' +
              'Read omnisnap://guide/selectors first if you have not already. ' +
              'Use only selectors OmniSnap returned, and prefer the highest-scoring one for each element. ' +
              'If any selector reports more than one match, say so rather than using it.',
          },
        },
      ],
    })
  );

  prompt(
    'file-bug',
    'File a bug from this page',
    'Turns the live page and its diagnostics into a defect report.',
    { summary: z.string().describe('What looks wrong.') },
    ({ summary }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              `Write a defect report for: ${summary}\n\n` +
              'Call capture_page and get_diagnostics first. Ground every claim in what they return: ' +
              'cite the actual failed requests, console errors and vitals. ' +
              'Read omnisnap://guide/diagnostics first: it covers the two mistakes that produce ' +
              'confidently wrong reports. Do not invent a root cause the evidence does not support. ' +
              'Include the exact browser and viewport from the diagnostics.',
          },
        },
      ],
    })
  );

  prompt(
    'audit-accessibility',
    'Audit this page for accessibility',
    'Checks the live page against WCAG AA and reports what to fix.',
    {},
    () => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              'Call measure_accessibility and capture_page on the open tab. ' +
              'Report every issue with its selector, ordered by severity, and give a concrete fix for ' +
              'each. Where contrast fails, give the measured ratio and a passing colour.',
          },
        },
      ],
    })
  );

  prompt(
    'extract-design-system',
    'Extract this page\'s design system',
    'Pulls the palette, type scale and spacing out of the live page.',
    { format: z.string().describe('json, css, tailwind or scss.') },
    ({ format }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              `Call get_design_tokens with format "${format}" on the open tab, then present the result. ` +
              'Name each colour by the job it does in the interface rather than by its hue, and flag ' +
              'any pair that fails contrast.',
          },
        },
      ],
    })
  );

  return {
    server,
    bridge,
    async start() {
      listening = await bridge.start();
      if (!listening.ok) {
        // A server that cannot bind is still useful: omnisnap_status explains
        // exactly what went wrong, which beats failing to start at all.
        log.warn('continuing without a bridge', listening);
      }
      return listening;
    },
    async stop() {
      await bridge.stop();
    },
  };
}
