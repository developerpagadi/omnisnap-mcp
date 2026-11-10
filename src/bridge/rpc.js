/**
 * Request and response correlation.
 *
 * A WebSocket is a pipe, not a call. Several tool calls can be in flight at
 * once and the replies may arrive in any order, so every request carries an
 * id and waits on its own promise.
 *
 * Three things are easy to get wrong here and all three leak:
 *  - a reply that never comes leaves the promise pending for ever, so every
 *    request has a timer;
 *  - a socket that drops mid-flight must reject what it was carrying, or the
 *    caller hangs until its own timeout, long after the cause is known;
 *  - a settled request must be removed, or a duplicate or late reply
 *    resolves something that has already been answered.
 */
import { randomUUID } from 'node:crypto';
import { BridgeError } from '../lib/errors.js';

export class PendingCalls {
  constructor() {
    this.pending = new Map();
  }

  get size() {
    return this.pending.size;
  }

  /**
   * Registers a call and returns { id, promise }. The caller sends the frame
   * itself, so a send failure can reject through `fail` without racing.
   */
  open(timeoutMs, label = 'call') {
    const id = randomUUID();
    let settle;

    const promise = new Promise((resolve, reject) => {
      settle = { resolve, reject };
    });

    const timer = setTimeout(() => {
      this.fail(
        id,
        new BridgeError('TIMEOUT', `The browser did not answer "${label}" within ${timeoutMs} ms.`)
      );
    }, timeoutMs);

    // An outstanding call must never hold the process open on its own.
    if (typeof timer.unref === 'function') timer.unref();

    this.pending.set(id, { settle, timer, label });
    return { id, promise };
  }

  settle(id, value) {
    const entry = this.pending.get(id);
    if (!entry) return false;
    this.pending.delete(id);
    clearTimeout(entry.timer);
    entry.settle.resolve(value);
    return true;
  }

  fail(id, error) {
    const entry = this.pending.get(id);
    if (!entry) return false;
    this.pending.delete(id);
    clearTimeout(entry.timer);
    entry.settle.reject(error);
    return true;
  }

  /** The socket went away: answer everything it was carrying, at once. */
  failAll(error) {
    const ids = [...this.pending.keys()];
    for (const id of ids) this.fail(id, error);
    return ids.length;
  }
}
