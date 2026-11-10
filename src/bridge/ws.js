/**
 * The bridge.
 *
 * One WebSocket on loopback, one extension on the other end, and a small
 * framed protocol between them. PROTOCOL.md is the normative description;
 * this is the implementation and the place the security decisions live.
 *
 * Defences, in the order an attacker meets them:
 *  1. The listener binds 127.0.0.1, so nothing off the machine can reach it.
 *  2. The Origin header must be a browser extension, which no web page can
 *     forge, so a malicious site cannot open this socket at all.
 *  3. Frames are size-capped before parsing, so a hostile client cannot
 *     exhaust memory with one message.
 *  4. Unpaired clients may send exactly two frame types, so an unauthorised
 *     connection cannot issue calls while it negotiates.
 *  5. Tokens are compared in constant time.
 *
 * Only one extension is connected at a time. A second connection displaces
 * the first rather than joining it: two browsers answering the same call is
 * a correctness problem, not a feature.
 */
import { EventEmitter } from 'node:events';
import { WebSocketServer } from 'ws';
import { config } from '../lib/config.js';
import { log } from '../lib/logger.js';
import { BridgeError } from '../lib/errors.js';
import { PendingCalls } from './rpc.js';
import { Pairing, loadToken, saveToken, safeEqual, originAllowed } from './pairing.js';

const PROTOCOL_VERSION = 1;
const HEARTBEAT_MS = 20_000;

export class Bridge extends EventEmitter {
  /**
   * Port and host are injected rather than read from the module-level config,
   * because config captures the environment once at import time. Reaching
   * through to it would make two bridges in one process impossible to point
   * at different ports, which is exactly what the test suite needs and what a
   * future second-browser setup would need too.
   */
  constructor({ port = config.port, host = config.host } = {}) {
    super();
    this.port = port;
    this.host = host;
    this.wss = null;
    this.socket = null;
    this.calls = new PendingCalls();
    this.token = loadToken();
    this.pairing = null;
    this.client = null;
    this.heartbeat = null;
  }

  get connected() {
    return !!this.socket && this.socket.readyState === 1 && this.authed === true;
  }

  get state() {
    if (this.connected) return 'ready';
    if (this.pairing && this.pairing.live) return 'pairing';
    return 'disconnected';
  }

  /** Never throws: a bridge that cannot listen must not stop the MCP server. */
  async start() {
    if (this.wss) return { ok: true, port: this.port };

    return new Promise((resolve) => {
      const wss = new WebSocketServer({
        host: this.host,
        port: this.port,
        maxPayload: config.maxFrameBytes,
        verifyClient: ({ origin }, done) => {
          if (originAllowed(origin)) return done(true);
          log.warn('rejected a connection from a disallowed origin', { origin });
          done(false, 403, 'Forbidden');
        },
      });

      wss.on('connection', (socket) => this.#adopt(socket));

      wss.on('error', (error) => {
        const inUse = error && error.code === 'EADDRINUSE';
        log.error(inUse ? 'bridge port is already in use' : 'bridge failed', {
          port: this.port,
          error: String(error && error.message),
        });
        this.wss = null;
        resolve({ ok: false, inUse, error: String(error && error.message) });
      });

      wss.on('listening', () => {
        this.wss = wss;
        log.info('bridge listening', { host: this.host, port: this.port });
        resolve({ ok: true, port: this.port });
      });
    });
  }

  async stop() {
    clearInterval(this.heartbeat);
    this.heartbeat = null;
    this.calls.failAll(new BridgeError('SHUTDOWN', 'The OmniSnap bridge is shutting down.'));
    // `wss.close()` waits for every client to go away on its own, so a
    // socket that is slow to acknowledge the close hangs shutdown for ever.
    // Terminating first makes stopping deterministic, which matters most in
    // tests and when a client crashed without closing cleanly.
    if (this.wss) {
      for (const client of this.wss.clients) {
        try {
          client.terminate();
        } catch {
          /* already gone */
        }
      }
    }
    this.socket = null;
    this.authed = false;

    await new Promise((resolve) => {
      if (!this.wss) return resolve();
      const timer = setTimeout(resolve, 2000);
      this.wss.close(() => {
        clearTimeout(timer);
        resolve();
      });
    });
    this.wss = null;
  }

  #adopt(socket) {
    if (this.socket && this.socket.readyState === 1) {
      log.info('a second extension connected; replacing the first');
      try {
        this.socket.close(1012, 'replaced by a newer connection');
      } catch {
        /* ignore */
      }
    }

    this.socket = socket;
    this.authed = false;
    this.client = null;
    socket.isAlive = true;

    socket.on('pong', () => {
      socket.isAlive = true;
    });
    socket.on('message', (raw) => this.#receive(socket, raw));
    socket.on('error', (error) => log.warn('socket error', { error: String(error && error.message) }));
    socket.on('close', (code) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.authed = false;
      this.client = null;
      const dropped = this.calls.failAll(
        new BridgeError('DISCONNECTED', 'The browser disconnected before answering.')
      );
      log.info('extension disconnected', { code, droppedCalls: dropped });
      this.emit('state', this.state);
    });

    this.#startHeartbeat();
  }

  /**
   * A half-open socket looks connected and answers nothing, which is how a
   * tool call ends up waiting out its whole timeout for a browser that was
   * closed ten minutes ago. The ping is what turns that into an immediate,
   * accurate error.
   */
  #startHeartbeat() {
    if (this.heartbeat) return;
    this.heartbeat = setInterval(() => {
      const socket = this.socket;
      if (!socket) return;
      if (socket.isAlive === false) {
        log.info('heartbeat missed; dropping a stale connection');
        return socket.terminate();
      }
      socket.isAlive = false;
      try {
        socket.ping();
      } catch {
        /* the close handler will deal with it */
      }
    }, HEARTBEAT_MS);
    if (typeof this.heartbeat.unref === 'function') this.heartbeat.unref();
  }

  #send(socket, frame) {
    if (!socket || socket.readyState !== 1) return false;
    try {
      socket.send(JSON.stringify({ v: PROTOCOL_VERSION, ...frame }));
      return true;
    } catch (error) {
      log.warn('could not send a frame', { error: String(error && error.message) });
      return false;
    }
  }

  #receive(socket, raw) {
    let frame;
    try {
      frame = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8'));
    } catch {
      return this.#send(socket, { type: 'error', code: 'BAD_FRAME', message: 'Frame was not JSON.' });
    }

    if (!frame || typeof frame.type !== 'string') {
      return this.#send(socket, { type: 'error', code: 'BAD_FRAME', message: 'Frame had no type.' });
    }

    // Before authentication only the handshake is reachable. Anything else
    // is either a bug or an attempt, and both deserve the same silence.
    if (!this.authed && frame.type !== 'hello' && frame.type !== 'pair-approve') {
      return this.#send(socket, {
        type: 'error',
        code: 'NOT_AUTHENTICATED',
        message: 'Say hello and complete pairing first.',
      });
    }

    switch (frame.type) {
      case 'hello':
        return this.#hello(socket, frame);
      case 'pair-approve':
        return this.#approve(socket, frame);
      case 'result':
        return this.#result(frame);
      case 'ping':
        return this.#send(socket, { type: 'pong' });
      case 'pong':
        return undefined;
      default:
        return this.#send(socket, {
          type: 'error',
          code: 'UNKNOWN_TYPE',
          message: `Unknown frame type "${frame.type}".`,
        });
    }
  }

  #hello(socket, frame) {
    this.client = {
      name: String(frame.client || 'unknown').slice(0, 64),
      version: String(frame.version || '').slice(0, 32),
    };

    if (this.token && frame.token && safeEqual(frame.token, this.token)) {
      this.authed = true;
      this.pairing = null;
      log.info('extension authenticated', this.client);
      this.#send(socket, { type: 'ready' });
      this.emit('state', this.state);
      return;
    }

    this.pairing = new Pairing();
    log.info('pairing required; code issued');
    this.#send(socket, { type: 'pair-required', ttlMs: config.pairingTtlMs });
    this.emit('state', this.state);
  }

  /**
   * The extension sends the code the *user* approved in its own UI. The
   * server never sends the code over this socket — if it did, a rogue client
   * could simply read it back and pair itself. The code travels to the user
   * by the other route, through the AI client, and the user is the one who
   * compares them.
   */
  #approve(socket, frame) {
    if (!this.pairing) {
      return this.#send(socket, {
        type: 'error',
        code: 'NO_PAIRING',
        message: 'There is no pairing in progress.',
      });
    }

    const result = this.pairing.approve(frame.code);
    if (!result.ok) {
      log.warn('pairing rejected', { reason: result.reason });
      if (result.reason !== 'mismatch') this.pairing = null;
      return this.#send(socket, {
        type: 'pair-failed',
        reason: result.reason,
        remaining: result.remaining,
      });
    }

    this.token = result.token;
    saveToken(result.token);
    this.authed = true;
    this.pairing = null;
    log.info('extension paired');
    this.#send(socket, { type: 'paired', token: result.token });
    this.emit('state', this.state);
  }

  #result(frame) {
    if (typeof frame.id !== 'string') return;
    if (frame.ok === false) {
      const error = frame.error || {};
      return this.calls.fail(
        frame.id,
        new BridgeError(
          String(error.code || 'EXTENSION_ERROR'),
          String(error.message || 'The extension could not complete the request.')
        )
      );
    }
    this.calls.settle(frame.id, frame.data);
  }

  /** The pairing code, for the AI to relay. Present only while pairing. */
  get pendingCode() {
    return this.pairing && this.pairing.live ? this.pairing.code : null;
  }

  /**
   * Asks the extension to do something and waits for its answer.
   *
   * The call is registered before the frame goes out, so a send that fails
   * rejects through the same path as a timeout and there is one way for a
   * caller to fail rather than two.
   */
  async call(tool, args = {}, { timeoutMs } = {}) {
    if (!this.connected) {
      throw new BridgeError(
        this.state === 'pairing' ? 'PAIRING_PENDING' : 'NOT_PAIRED',
        this.state === 'pairing'
          ? 'The extension is connected but not yet paired.'
          : 'The extension is not connected.'
      );
    }

    const budget =
      timeoutMs || (tool.startsWith('capture') ? config.captureTimeoutMs : config.callTimeoutMs);
    const { id, promise } = this.calls.open(budget, tool);

    const sent = this.#send(this.socket, { type: 'call', id, tool, args });
    if (!sent) {
      this.calls.fail(id, new BridgeError('SEND_FAILED', 'Could not reach the browser.'));
    }

    return promise;
  }
}
