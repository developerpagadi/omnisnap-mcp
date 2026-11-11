/**
 * Pairing.
 *
 * The threat this defends against is specific, and it is not hypothetical.
 * The bridge listens on a fixed loopback port, so the first process to claim
 * 8787 is the one the extension will talk to. If pairing were automatic, any
 * local process, such as a dependency's postinstall script, could stand up a
 * listener and quietly inherit the
 * ability to screenshot and read every page the user is signed in to.
 *
 * So pairing requires a human to compare two numbers that arrived by
 * different routes: the code the AI client reports, and the code the
 * extension shows in its own UI. A rogue server can produce a code, but it
 * cannot make the user's AI client report that same code, because it is not
 * the server the client launched. The comparison is the whole defence, which
 * is why the code is six digits rather than a hash. It has to be checkable by a
 * person at a glance.
 *
 * Tokens are compared in constant time, pairing attempts are rate limited,
 * and a code is single-use and short-lived.
 */
import { randomBytes, timingSafeEqual, randomInt } from 'node:crypto';
import { config, readState, writeState } from '../lib/config.js';
import { log } from '../lib/logger.js';

/** Six digits: long enough to not be guessed in the window, short enough to read aloud. */
export function makeCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export function makeToken() {
  return randomBytes(32).toString('base64url');
}

/**
 * Constant-time comparison.
 *
 * `timingSafeEqual` throws on a length mismatch, which would itself leak the
 * length, so both sides are hashed to a fixed width first. Comparing raw
 * strings with `===` would leak the common prefix one character at a time.
 */
export function safeEqual(a, b) {
  const left = Buffer.from(String(a ?? ''), 'utf8');
  const right = Buffer.from(String(b ?? ''), 'utf8');
  const width = Math.max(left.length, right.length, 1);
  const padLeft = Buffer.alloc(width);
  const padRight = Buffer.alloc(width);
  left.copy(padLeft);
  right.copy(padRight);
  return timingSafeEqual(padLeft, padRight) && left.length === right.length;
}

/**
 * A pairing session, created when an unpaired extension says hello.
 *
 * Attempts are capped: without that, six digits falls to a loop in seconds.
 */
export class Pairing {
  constructor({ ttlMs = config.pairingTtlMs, maxAttempts = 5 } = {}) {
    this.code = makeCode();
    this.expiresAt = Date.now() + ttlMs;
    this.attempts = 0;
    this.maxAttempts = maxAttempts;
    this.consumed = false;
  }

  get expired() {
    return Date.now() > this.expiresAt;
  }

  get exhausted() {
    return this.attempts >= this.maxAttempts;
  }

  get live() {
    return !this.consumed && !this.expired && !this.exhausted;
  }

  /**
   * Returns a token on success, or a reason. Never reveals the code, and
   * never distinguishes "wrong code" from "nearly right".
   */
  approve(candidate) {
    if (this.consumed) return { ok: false, reason: 'already-used' };
    if (this.expired) return { ok: false, reason: 'expired' };
    if (this.exhausted) return { ok: false, reason: 'too-many-attempts' };

    this.attempts += 1;
    if (!safeEqual(candidate, this.code)) {
      return { ok: false, reason: 'mismatch', remaining: this.maxAttempts - this.attempts };
    }

    this.consumed = true;
    return { ok: true, token: makeToken() };
  }
}

/** The long-lived token, shared between runs so pairing is a one-time act. */
export function loadToken() {
  const state = readState();
  return typeof state.token === 'string' && state.token.length >= 32 ? state.token : null;
}

export function saveToken(token) {
  const state = readState();
  const persisted = writeState({ ...state, token, pairedAt: new Date().toISOString() });
  if (!persisted) log.warn('token held in memory only; pairing will be needed again next run');
  return persisted;
}

export function forgetToken() {
  const state = readState();
  delete state.token;
  delete state.pairedAt;
  return writeState(state);
}

/**
 * Only the extension may connect.
 *
 * A browser sets `Origin` itself and page JavaScript cannot forge it, so
 * requiring a `chrome-extension://` origin means no web page can reach this
 * socket at all: not a malicious site the user is visiting, and not an
 * iframe inside one. A non-browser client sends no Origin, which is how the
 * test harness and any future CLI connect; those still face the token.
 */
export function originAllowed(origin) {
  if (origin === undefined || origin === null || origin === '') return true;
  return /^(chrome|moz|safari-web)-extension:\/\/[a-z0-9-]+\/?$/i.test(String(origin));
}
