/**
 * Configuration and on-disk state.
 *
 * Everything is local. There is no account, no remote config and no
 * telemetry, which is the same promise the extension makes and the reason
 * people are willing to pair a tool that can read their logged-in pages.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { log } from './logger.js';
import { read } from './args.js';

const num = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const config = {
  /**
   * Fixed by default because the extension has to find it without being told.
   * A browser extension cannot read a file to discover a random port, so the
   * port is the rendezvous. Override only if something else owns 8787.
   */
  port: num(read('port', 'OMNISNAP_PORT'), 8787),

  /**
   * Loopback, always. Binding to 0.0.0.0 would put a socket that can drive
   * someone's authenticated browser on their local network.
   */
  host: '127.0.0.1',

  /** How long a single tool call may take before the caller gets an error. */
  callTimeoutMs: num(read('call-timeout', 'OMNISNAP_CALL_TIMEOUT_MS'), 30_000),

  /** A capture of a tall page is slow; it gets its own, longer budget. */
  captureTimeoutMs: num(read('capture-timeout', 'OMNISNAP_CAPTURE_TIMEOUT_MS'), 120_000),

  /** Pairing codes expire quickly: a stale one is a window for mischief. */
  pairingTtlMs: num(read('pairing-ttl', 'OMNISNAP_PAIRING_TTL_MS'), 120_000),

  /** Images are base64 in the response; past this they are a liability. */
  maxImageBytes: num(read('max-image-bytes', 'OMNISNAP_MAX_IMAGE_BYTES'), 8 * 1024 * 1024),

  /** Any single frame from the extension. Bounds memory on a hostile client. */
  maxFrameBytes: num(read('max-frame-bytes', 'OMNISNAP_MAX_FRAME_BYTES'), 24 * 1024 * 1024),

  /**
   * How many tool calls may be in flight at once.
   *
   * There is one browser at the other end of this socket, and a good deal of
   * what it does is serialised anyway: Chrome allows two screenshots a
   * second, and a prompt waiting on a human is not something you can have two
   * of. An agent that fans out twenty calls does not get its answers twenty
   * times faster. It gets a queue, every entry of which is burning its own
   * thirty-second timeout, and the last ones time out having never been
   * reached.
   *
   * Refusing early says that plainly, in a message the model can act on,
   * instead of returning a timeout that reads like a broken extension.
   */
  maxConcurrentCalls: num(read('max-concurrent-calls', 'OMNISNAP_MAX_CONCURRENT_CALLS'), 6),

  /**
   * A getter, not a value.
   *
   * Everything else here is read once at import and that is fine, because
   * nothing changes it afterwards. This one does change: the test suite
   * points it at a temporary directory, and when it was captured at import
   * the tests wrote real pairing tokens into the developer's home directory
   * instead. Reading it on access costs nothing and makes the redirect work.
   */
  get stateDir() {
    return read('state-dir', 'OMNISNAP_STATE_DIR') || join(homedir(), '.omnisnap');
  },
};

const statePath = () => join(config.stateDir, 'bridge.json');

/**
 * The paired token lives here. It is the one secret in the system: whoever
 * holds it can ask the extension to act. The file is written 0600 so it is
 * not readable by other accounts on a shared machine.
 */
export function readState() {
  try {
    const raw = readFileSync(statePath(), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function writeState(next) {
  try {
    mkdirSync(config.stateDir, { recursive: true, mode: 0o700 });
    const file = statePath();
    writeFileSync(file, JSON.stringify(next, null, 2), { mode: 0o600 });
    chmodSync(file, 0o600);
    return true;
  } catch (error) {
    // Losing the token costs one re-pair; failing the call would cost the
    // session. Degrade rather than throw.
    log.warn('could not persist bridge state', { error: String(error && error.message) });
    return false;
  }
}
