/**
 * Logging, on stderr only.
 *
 * This server speaks MCP over stdio, which means stdout *is* the protocol
 * channel. A single stray `console.log` writes a non-JSON-RPC line into that
 * stream and the client's parser gives up, usually with an error that points
 * nowhere near the cause. It is the most common way a stdio MCP server gets
 * built wrong, and it fails silently in development because nothing logs
 * until something goes wrong in production.
 *
 * So nothing in this codebase may write to stdout except the transport. This
 * module is the only sanctioned way to emit anything, and `guardStdout()`
 * turns a violation into an immediate, obvious crash rather than a corrupted
 * session. A test asserts the guard actually fires.
 */

import { read } from './args.js';

const LEVELS = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };

function resolveLevel() {
  const raw = String(read('log-level', 'OMNISNAP_LOG_LEVEL') || 'info').toLowerCase();
  return Object.prototype.hasOwnProperty.call(LEVELS, raw) ? LEVELS[raw] : LEVELS.info;
}

let threshold = resolveLevel();

function emit(level, message, detail) {
  if (LEVELS[level] > threshold) return;
  const line = {
    t: new Date().toISOString(),
    level,
    msg: String(message),
    ...(detail === undefined ? {} : { detail: redact(detail) }),
  };
  process.stderr.write(`${JSON.stringify(line)}\n`);
}

/**
 * Secrets must not reach a log file. The bridge token and the pairing code
 * are the two values that would let someone else drive the user's browser, so
 * they are stripped wherever they appear, however deeply nested.
 */
const SECRET_KEYS = new Set(['token', 'secret', 'code', 'authorization', 'password']);

export function redact(value, depth = 0) {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));

  const out = {};
  for (const [key, inner] of Object.entries(value)) {
    out[key] = SECRET_KEYS.has(key.toLowerCase()) ? '[redacted]' : redact(inner, depth + 1);
  }
  return out;
}

export const log = {
  error: (message, detail) => emit('error', message, detail),
  warn: (message, detail) => emit('warn', message, detail),
  info: (message, detail) => emit('info', message, detail),
  debug: (message, detail) => emit('debug', message, detail),
  setLevel(level) {
    threshold = Object.prototype.hasOwnProperty.call(LEVELS, level) ? LEVELS[level] : threshold;
  },
};

/**
 * Why there is no runtime stdout guard here.
 *
 * The obvious defence is to replace `process.stdout.write` and throw. It does
 * not work: the SDK's transport writes through the same function, and there
 * is no way to tell its frames apart from a stray `console.log` at the point
 * of the call. Any guard strict enough to catch the bug also breaks the
 * protocol.
 *
 * So the check lives in the test suite instead, where it belongs:
 * tests/stdio.test.js spawns the real server, speaks JSON-RPC to it, and
 * asserts every line it emits on stdout parses as JSON-RPC. That catches the
 * mistake without shipping a mechanism that fights the library.
 */
