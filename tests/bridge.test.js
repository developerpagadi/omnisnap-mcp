/**
 * The bridge, end to end, against a fake extension.
 *
 * These are the tests that would otherwise only run when a real browser is
 * attached, which is to say never during development. The fake speaks the
 * wire protocol from PROTOCOL.md, so anything it proves here is true of the
 * real extension too.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { rmSync, existsSync } from 'node:fs';
import { Bridge } from '../src/bridge/ws.js';
import { config } from '../src/lib/config.js';
import { log } from '../src/lib/logger.js';

// The logger reads its level at import time, so setting the variable inside a
// test is too late. Silence it here, once.
log.setLevel('silent');
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STATE = join(ROOT, 'tests', '.tmp-bridge-state');

let port = 17400;
const nextPort = () => ++port;

/** A bridge on its own port and state dir, so tests cannot interfere. */
async function startBridge({ keepState = false } = {}) {
  process.env.OMNISNAP_STATE_DIR = STATE;
  if (!keepState) rmSync(STATE, { recursive: true, force: true });

  const chosen = nextPort();
  const bridge = new Bridge({ port: chosen });
  const listening = await bridge.start();
  assert.ok(listening.ok, `bridge failed to listen: ${listening.error}`);
  return { bridge, port: chosen, url: `ws://127.0.0.1:${chosen}` };
}

/** Minimal stand-in for the extension. */
function fakeExtension(url, { origin = 'chrome-extension://testextensionid' } = {}) {
  const socket = new WebSocket(url, { origin });
  const inbox = [];
  const waiters = [];

  socket.on('message', (raw) => {
    const frame = JSON.parse(raw.toString());
    const waiter = waiters.shift();
    if (waiter) waiter(frame);
    else inbox.push(frame);
  });

  return {
    socket,
    open: () => new Promise((r, j) => (socket.once('open', r), socket.once('error', j))),
    send: (frame) => socket.send(JSON.stringify({ v: 1, ...frame })),
    next: () =>
      new Promise((resolve, reject) => {
        if (inbox.length) return resolve(inbox.shift());
        const timer = setTimeout(() => reject(new Error('no frame arrived')), 3000);
        waiters.push((f) => {
          clearTimeout(timer);
          resolve(f);
        });
      }),
    close: () => socket.close(),
  };
}

test('an unpaired extension is asked to pair, and the code never crosses the wire', async () => {
  const { bridge, url } = await startBridge();
  const ext = fakeExtension(url);
  await ext.open();

  ext.send({ type: 'hello', client: 'omnisnap-extension', version: '1.4.1' });
  const frame = await ext.next();

  assert.equal(frame.type, 'pair-required');
  assert.equal(bridge.state, 'pairing');

  // The whole defence rests on this: the server tells the AI client the code,
  // and the extension shows the user its own. If the code were sent here, a
  // rogue client could read it back and pair itself without a human.
  assert.ok(!('code' in frame), 'the pairing code must never be sent to the client');
  assert.match(bridge.pendingCode, /^\d{6}$/);

  ext.close();
  await bridge.stop();
});

test('approving with the right code pairs, and calls then work', async () => {
  const { bridge, url } = await startBridge();
  const ext = fakeExtension(url);
  await ext.open();

  ext.send({ type: 'hello', client: 'omnisnap-extension' });
  await ext.next();

  ext.send({ type: 'pair-approve', code: bridge.pendingCode });
  const paired = await ext.next();
  assert.equal(paired.type, 'paired');
  assert.ok(paired.token.length >= 40);
  assert.equal(bridge.state, 'ready');

  // A call now reaches the extension and its answer comes back to the caller.
  const pending = bridge.call('capture_page', { mode: 'full' });
  const call = await ext.next();
  assert.equal(call.type, 'call');
  assert.equal(call.tool, 'capture_page');
  assert.deepEqual(call.args, { mode: 'full' });

  ext.send({ type: 'result', id: call.id, ok: true, data: { width: 1440, height: 900 } });
  assert.deepEqual(await pending, { width: 1440, height: 900 });

  ext.close();
  await bridge.stop();
});

test('a wrong code is refused and does not pair', async () => {
  const { bridge, url } = await startBridge();
  const ext = fakeExtension(url);
  await ext.open();

  ext.send({ type: 'hello', client: 'omnisnap-extension' });
  await ext.next();

  const wrong = bridge.pendingCode === '000000' ? '111111' : '000000';
  ext.send({ type: 'pair-approve', code: wrong });
  const failed = await ext.next();

  assert.equal(failed.type, 'pair-failed');
  assert.equal(failed.reason, 'mismatch');
  assert.notEqual(bridge.state, 'ready');

  ext.close();
  await bridge.stop();
});

test('an unpaired client cannot issue calls', async () => {
  const { bridge, url } = await startBridge();
  const ext = fakeExtension(url);
  await ext.open();

  // Straight to a result frame, skipping the handshake entirely.
  ext.send({ type: 'result', id: 'made-up', ok: true, data: {} });
  const refused = await ext.next();

  assert.equal(refused.type, 'error');
  assert.equal(refused.code, 'NOT_AUTHENTICATED');

  ext.close();
  await bridge.stop();
});

test('a web page origin is refused at the handshake', async () => {
  const { bridge, url } = await startBridge();
  const ext = fakeExtension(url, { origin: 'https://evil.example.com' });

  await assert.rejects(ext.open(), 'a page origin should not be able to open the socket');
  assert.notEqual(bridge.state, 'ready');

  await bridge.stop();
});

test('an error from the extension reaches the caller as an error', async () => {
  const { bridge, url } = await startBridge();
  const ext = fakeExtension(url);
  await ext.open();
  ext.send({ type: 'hello', client: 'omnisnap-extension' });
  await ext.next();
  ext.send({ type: 'pair-approve', code: bridge.pendingCode });
  await ext.next();

  const pending = bridge.call('capture_page', {});
  const call = await ext.next();
  ext.send({
    type: 'result',
    id: call.id,
    ok: false,
    error: { code: 'TAB_BLOCKED', message: 'Chrome blocks captures on this page.' },
  });

  await assert.rejects(pending, (error) => {
    assert.equal(error.code, 'TAB_BLOCKED');
    assert.match(error.message, /Chrome blocks captures/);
    return true;
  });

  ext.close();
  await bridge.stop();
});

test('a disconnect fails the calls it was carrying, straight away', async () => {
  const { bridge, url } = await startBridge();
  const ext = fakeExtension(url);
  await ext.open();
  ext.send({ type: 'hello', client: 'omnisnap-extension' });
  await ext.next();
  ext.send({ type: 'pair-approve', code: bridge.pendingCode });
  await ext.next();

  const pending = bridge.call('get_diagnostics', {});
  await ext.next();
  ext.close();

  // Without this, the caller waits out its whole timeout for a browser that
  // is demonstrably gone.
  await assert.rejects(pending, (error) => {
    assert.equal(error.code, 'DISCONNECTED');
    return true;
  });

  await bridge.stop();
});

test('a call made with nobody connected fails immediately and says why', async () => {
  const { bridge } = await startBridge();
  await assert.rejects(bridge.call('capture_page', {}), (error) => {
    assert.equal(error.code, 'NOT_PAIRED');
    return true;
  });
  await bridge.stop();
});

test('a second extension replaces the first rather than joining it', async () => {
  const { bridge, url } = await startBridge();

  const first = fakeExtension(url);
  await first.open();
  first.send({ type: 'hello', client: 'first' });
  await first.next();
  first.send({ type: 'pair-approve', code: bridge.pendingCode });
  await first.next();

  const closed = new Promise((r) => first.socket.once('close', r));
  const second = fakeExtension(url);
  await second.open();

  // Two browsers answering one call is a correctness problem, not a feature.
  await closed;
  assert.ok(true, 'the first connection was displaced');

  second.close();
  await bridge.stop();
});

/*
 * config read OMNISNAP_STATE_DIR once at import, so redirecting it in a test
 * did nothing and the suite wrote real pairing tokens into the developer's
 * home directory. Reading it on access fixed that; this keeps it fixed.
 */
test('the suite never writes to the real home directory', async () => {
  const { bridge, url } = await startBridge();
  const ext = fakeExtension(url);
  await ext.open();
  ext.send({ type: 'hello', client: 'omnisnap-extension' });
  await ext.next();
  ext.send({ type: 'pair-approve', code: bridge.pendingCode });
  await ext.next();

  const { readState } = await import('../src/lib/config.js');
  assert.ok(readState().token, 'the token should land in the redirected state dir');
  assert.ok(existsSync(join(STATE, 'bridge.json')), 'and specifically in the temp dir');

  ext.close();
  await bridge.stop();
});

test('a paired token survives a restart, so pairing is a one-time act', async () => {
  const { bridge, url } = await startBridge();
  const ext = fakeExtension(url);
  await ext.open();
  ext.send({ type: 'hello', client: 'omnisnap-extension' });
  await ext.next();
  ext.send({ type: 'pair-approve', code: bridge.pendingCode });
  const { token } = await ext.next();
  ext.close();
  await bridge.stop();

  // Same state dir, new listener: the stored token must still be honoured.
  const revived = new Bridge({ port: nextPort() });
  const up = await revived.start();
  assert.ok(up.ok);

  const again = fakeExtension(`ws://127.0.0.1:${up.port}`);
  await again.open();
  again.send({ type: 'hello', client: 'omnisnap-extension', token });
  const ready = await again.next();

  assert.equal(ready.type, 'ready', 'a stored token should authenticate without pairing again');
  assert.equal(revived.state, 'ready');

  again.close();
  await revived.stop();
  rmSync(STATE, { recursive: true, force: true });
});

test('a fan-out is refused before it becomes a queue of timeouts', async (t) => {
  const { bridge, url } = await startBridge();
  t.after(() => bridge.stop());

  const ext = fakeExtension(url);
  await ext.open();
  ext.send({ type: 'hello', client: 'omnisnap-extension', version: '1.9.2' });
  await ext.next();
  ext.send({ type: 'pair-approve', code: bridge.pendingCode });
  await ext.next();

  // The extension is connected but deliberately answers nothing, which is the
  // shape of a browser busy with the first request.
  const inFlight = [];
  for (let i = 0; i < config.maxConcurrentCalls; i++) {
    inFlight.push(bridge.call('list_tabs', {}).catch(() => 'settled'));
  }

  await assert.rejects(bridge.call('list_tabs', {}), (error) => {
    assert.equal(error.code, 'TOO_MANY_CALLS');
    // The model has to be able to act on it: wait, do not retry harder.
    assert.match(error.message, /wait for the ones you have/i);
    return true;
  });

  assert.equal(
    bridge.calls.size,
    config.maxConcurrentCalls,
    'the refused call must not occupy a slot of its own'
  );

  bridge.calls.failAll(new Error('test over'));
  await Promise.all(inFlight);
});
