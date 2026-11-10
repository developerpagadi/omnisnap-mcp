/**
 * Errors the model will read.
 *
 * An MCP tool error is not a stack trace for a developer; it is a sentence an
 * agent has to act on. "ECONNREFUSED" tells it nothing. "The extension is not
 * paired, here is how to pair it" tells it exactly what to say to the user,
 * and that difference decides whether the first run ends in a fix or a
 * shrug.
 *
 * So every failure carries a code the agent can branch on and a message
 * written for a reader, and the not-paired case carries the whole remedy.
 */

export class BridgeError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = 'BridgeError';
    this.code = code;
    this.detail = detail;
  }
}

export const STORE_URL =
  'https://chromewebstore.google.com/detail/fjjfegkonlkleomaeopmakhlejjiljga';

export const NOT_PAIRED = [
  'The OmniSnap browser extension is not connected to this server.',
  '',
  'Ask the user to do this once:',
  `  1. Install OmniSnap AI Studio: ${STORE_URL}`,
  '  2. Click the OmniSnap toolbar icon, then turn on "Connect to AI".',
  '  3. Call omnisnap_status again for the pairing code, and have them type',
  '     it into the extension.',
  '',
  'Then call omnisnap_status to confirm, and retry.',
].join('\n');

export const PAIRING_PENDING = (code) =>
  [
    'The extension is waiting to be paired.',
    '',
    `Tell the user the code is ${code}, and ask them to type it into the`,
    'extension, which is asking for it now.',
    '',
    'The code must reach them from you and from nowhere else. If the',
    'extension claims to already know it, something else is listening on',
    'the bridge port and they should not continue.',
    '',
    'Then retry.',
  ].join('\n');

/**
 * Turns anything thrown into the shape an MCP tool handler returns. The model
 * sees prose; the code stays available for it to branch on.
 */
export function toToolError(error) {
  const code = error instanceof BridgeError ? error.code : 'INTERNAL';
  const message =
    error instanceof BridgeError
      ? error.message
      : `OmniSnap hit an unexpected problem: ${String((error && error.message) || error)}`;

  return {
    isError: true,
    content: [{ type: 'text', text: message }],
    structuredContent: { ok: false, code },
  };
}
