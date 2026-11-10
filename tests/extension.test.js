/**
 * The real extension against the real server.
 *
 * tests/bridge.test.js proves the server behaves, using a fake extension that
 * this repository also wrote. That is a test of the protocol as understood by
 * one author, which is exactly the kind of agreement that holds right up until
 * it matters: the pairing flow in the extension was, at one point, generating
 * its own code and comparing it with nothing.
 *
 * So this loads `lib/mcpbridge.js` out of the extension checkout and runs it,
 * unmodified, against a real Bridge. If the two halves drift, this fails
 * rather than a user's first pairing attempt.
 *
 * It skips when the extension is not checked out beside this repository,
 * because most people installing this package will not have it.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket as WS } from 'ws';
import { existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Bridge } from '../src/bridge/ws.js';
import { log } from '../src/lib/logger.js';

log.setLevel('silent');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXTENSION = join(
  ROOT,
  '..',
  'chrome-extension',
  'omnisnap-ai-studio',
  'lib',
  'mcpbridge.js'
);
const STATE = join(ROOT, 'tests', '.tmp-extension-state');

/**
 * Enough of the extension platform for the bridge to run under Node.
 *
 * Only the surfaces mcpbridge.js actually touches are here. A fuller fake
 * would be a second implementation of Chrome and would start passing for
 * reasons that have nothing to do with the extension.
 */
function fakeChrome({ port }) {
  const local = { mcpEnabled: true, mcpPort: port };
  const read = (keys) =>
    Object.fromEntries(
      (Array.isArray(keys) ? keys : [keys]).filter((k) => k in local).map((k) => [k, local[k]])
    );

  return {
    storage: {
      local: {
        get: async (keys) => read(keys),
        set: async (next) => Object.assign(local, next),
        remove: async (key) => {
          delete local[key];
        },
      },
      session: { set: async () => {} },
    },
    permissions: { request: async () => true, remove: async () => true },
    alarms: { create: () => {}, clear: async () => {} },
    runtime: {
      getManifest: () => ({ version: '1.6.0' }),
      sendMessage: async () => {},
    },
    __state: local,
  };
}

/** `ws` needs the origin passed as an option; the browser sets it itself. */
class ExtensionSocket extends WS {
  constructor(url) {
    super(url, { origin: 'chrome-extension://conformancetestextensionid' });
  }
}

let port = 17600;

async function harness() {
  process.env.OMNISNAP_STATE_DIR = STATE;
  rmSync(STATE, { recursive: true, force: true });

  const chosen = ++port;
  const bridge = new Bridge({ port: chosen });
  const listening = await bridge.start();
  assert.ok(listening.ok, `bridge failed to listen: ${listening.error}`);

  globalThis.chrome = fakeChrome({ port: chosen });
  globalThis.WebSocket = ExtensionSocket;

  const { McpBridge } = await import(`${pathToFileURL(EXTENSION).href}?t=${chosen}`);
  return { bridge, chosen, McpBridge };
}

/** Resolves the first time the extension reports one of `states`. */
const settles = (client, states) =>
  new Promise((resolve) => {
    const stop = client.onChange((snapshot) => {
      if (states.includes(snapshot.state)) {
        stop();
        resolve(snapshot);
      }
    });
  });

describe('the shipped extension against the shipped server', { skip: !existsSync(EXTENSION) }, () => {
  test('a first connection is asked to pair, and the code is not on the wire', async (t) => {
    const { bridge, McpBridge } = await harness();
    t.after(() => bridge.stop());

    const client = new McpBridge({ dispatch: async () => ({}) });
    const waiting = settles(client, ['pairing']);
    await client.connect();
    await waiting;

    assert.equal(bridge.state, 'pairing');
    assert.match(bridge.pendingCode, /^\d{6}$/);
    // The extension cannot have learned it, so it must not claim to have one.
    assert.equal(client.code, null);

    await client.disable();
  });

  test('the code the user types pairs the extension, and a wrong one does not', async (t) => {
    const { bridge, McpBridge } = await harness();
    t.after(() => bridge.stop());

    const client = new McpBridge({ dispatch: async () => ({}) });
    const waiting = settles(client, ['pairing']);
    await client.connect();
    await waiting;

    const wrong = String((Number(bridge.pendingCode) + 1) % 1000000).padStart(6, '0');
    const failed = settles(client, ['pair-failed']);
    client.approve(wrong);
    assert.equal((await failed).state, 'pair-failed');

    const ready = settles(client, ['ready']);
    client.approve(bridge.pendingCode);
    await ready;

    assert.equal(bridge.state, 'ready');
    assert.ok(chrome.__state.mcpToken, 'the extension stored the token it was given');

    await client.disable();
  });

  test('a tool call reaches the extension and its answer comes back', async (t) => {
    const { bridge, McpBridge } = await harness();
    t.after(() => bridge.stop());

    const seen = [];
    const client = new McpBridge({
      dispatch: async (tool, args) => {
        seen.push({ tool, args });
        return { tabs: [{ id: 1, title: 'Example', url: 'https://example.com', active: true }] };
      },
    });

    await client.connect();
    await settles(client, ['pairing']);
    const ready = settles(client, ['ready']);
    client.approve(bridge.pendingCode);
    await ready;

    const result = await bridge.call('list_tabs', {});
    assert.deepEqual(seen, [{ tool: 'list_tabs', args: {} }]);
    assert.equal(result.tabs[0].url, 'https://example.com');

    await client.disable();
  });

  test('an error from the extension arrives as a message, not a stack trace', async (t) => {
    const { bridge, McpBridge } = await harness();
    t.after(() => bridge.stop());

    const client = new McpBridge({
      dispatch: async () => {
        const error = new Error('No element on the page matched "#missing".');
        error.code = 'NO_MATCH';
        throw error;
      },
    });

    await client.connect();
    await settles(client, ['pairing']);
    const ready = settles(client, ['ready']);
    client.approve(bridge.pendingCode);
    await ready;

    await assert.rejects(bridge.call('inspect_element', { selector: '#missing' }), (error) => {
      assert.equal(error.code, 'NO_MATCH');
      assert.match(error.message, /#missing/);
      assert.doesNotMatch(error.message, /at .*\(/, 'a stack trace reached the model');
      return true;
    });

    await client.disable();
  });

  test('a stored token pairs silently the next time', async (t) => {
    const { bridge, McpBridge } = await harness();
    t.after(() => bridge.stop());

    const first = new McpBridge({ dispatch: async () => ({}) });
    await first.connect();
    await settles(first, ['pairing']);
    const ready = settles(first, ['ready']);
    first.approve(bridge.pendingCode);
    await ready;

    // The same extension, restarted: the service worker was evicted and came
    // back with nothing but what it had written to storage.
    const second = new McpBridge({ dispatch: async () => ({}) });
    const straightThrough = settles(second, ['ready', 'pairing']);
    await second.connect();

    assert.equal((await straightThrough).state, 'ready', 'it was asked to pair again');
    await second.disable();
  });
});
