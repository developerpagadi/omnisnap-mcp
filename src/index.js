#!/usr/bin/env node
/**
 * Entry point.
 *
 * Keeps itself small on purpose: wire the server to stdio, start the bridge,
 * and make sure the process dies cleanly. Everything interesting is a module.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer, VERSION } from './server.js';
import { log } from './lib/logger.js';
import { config } from './lib/config.js';

if (process.argv.includes('--version') || process.argv.includes('-v')) {
  process.stderr.write(`omnisnap-mcp ${VERSION}\n`);
  process.exit(0);
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stderr.write(
    [
      `omnisnap-mcp ${VERSION}`,
      '',
      'An MCP server that reads your real, logged-in browser through the',
      'OmniSnap Chrome extension.',
      '',
      'It speaks MCP over stdio and is launched by an AI client, not by hand.',
      '',
      'Client configuration:',
      '  { "mcpServers": { "omnisnap": { "command": "npx", "args": ["-y", "omnisnap-mcp"] } } }',
      '',
      'Commands:',
      '  --doctor                     check the port, pairing and extension',
      '  --version, --help',
      '',
      'Options. Every one is also an environment variable, because clients',
      'differ in which they make easy; a flag wins over the environment.',
      '',
      `  --port <n>                   bridge port (default ${config.port})`,
      '                               OMNISNAP_PORT',
      `  --state-dir <path>           where the pairing token lives`,
      `                               (default ${config.stateDir})`,
      '                               OMNISNAP_STATE_DIR',
      `  --call-timeout <ms>          per tool call (default ${config.callTimeoutMs})`,
      '                               OMNISNAP_CALL_TIMEOUT_MS',
      `  --capture-timeout <ms>       screenshots get longer (default ${config.captureTimeoutMs})`,
      '                               OMNISNAP_CAPTURE_TIMEOUT_MS',
      `  --max-concurrent-calls <n>   in flight at once (default ${config.maxConcurrentCalls})`,
      '                               OMNISNAP_MAX_CONCURRENT_CALLS',
      `  --max-image-bytes <n>        refuse a capture above this (default ${config.maxImageBytes})`,
      '                               OMNISNAP_MAX_IMAGE_BYTES',
      `  --pairing-ttl <ms>           how long a pairing code lasts (default ${config.pairingTtlMs})`,
      '                               OMNISNAP_PAIRING_TTL_MS',
      '  --log-level <level>          silent | error | warn | info | debug',
      '                               OMNISNAP_LOG_LEVEL',
      '',
      'Logs go to stderr. Stdout carries the protocol, and one stray write to',
      'it corrupts the session.',
      '',
    ].join('\n')
  );
  process.exit(0);
}

/**
 * `npx omnisnap-mcp --doctor`
 *
 * When this server misbehaves it does so inside an AI client, where the only
 * symptom is a tool that quietly fails and stderr nobody reads. Almost every
 * such report is one of three things: the port is taken, the extension was
 * never installed, or it was installed but never paired. This answers which,
 * from a terminal, in a second.
 */
if (process.argv.includes('--doctor')) {
  // The report is the output; the bridge's own logging would interleave with it.
  log.setLevel('silent');
  const { Bridge } = await import('./bridge/ws.js');
  const out = (line) => process.stderr.write(`${line}\n`);

  out(`omnisnap-mcp ${VERSION}`);
  out(`node        ${process.version}`);
  out(`state dir   ${config.stateDir}`);

  const { loadToken } = await import('./bridge/pairing.js');
  out(`pairing     ${loadToken() ? 'a token is stored' : 'not paired yet'}`);

  const probe = new Bridge();
  const listening = await probe.start();

  if (listening.ok) {
    out(`port ${config.port}   free, and now listening`);
    out('');

    /** Resolves on the first of `states`, or false if the wait runs out. */
    const until = (states, ms) =>
      new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), ms);
        const watch = (state) => {
          if (!states.includes(state)) return;
          clearTimeout(timer);
          probe.off('state', watch);
          resolve(state);
        };
        probe.on('state', watch);
        if (states.includes(probe.state)) watch(probe.state);
      });

    // Long enough to cross the extension's reconnect backoff, which caps at a
    // minute. Ten seconds only ever worked if the switch was flipped first.
    out('Waiting up to 70s for the extension to connect.');
    out('In Chrome: click the OmniSnap icon, then turn on "Connect to AI".');
    let connected = await until(['ready', 'pairing'], 70_000);

    if (connected === 'pairing') {
      out('');
      out('  The extension is connected and waiting to pair.');
      out('');
      out(`      Type this code into the extension:   ${probe.pendingCode}`);
      out('');
      // The extension cannot know this code, and must never claim to. If it
      // is already showing one, it is talking to something that is not this
      // server, and typing anything would hand that program the browser.
      out('  The extension asks for it; it does not show one of its own. If it');
      out('  is already showing a code, stop: something else holds the port.');
      out('');
      connected = await until(['ready'], config.pairingTtlMs);
      if (!connected) out('Pairing was not completed in time. Run --doctor again for a fresh code.');
    }

    if (connected === 'ready') {
      out('');
      out('Paired. The extension answers on this port, and your AI client will');
      out('find it the same way. Nothing else to do.');
    } else if (!connected) {
      out('');
      out('No extension connected.');
      out('  - Is OmniSnap AI Studio installed and enabled?');
      out('  - Does its popup have a "Connect to AI" switch? Versions before');
      out('    1.6.0 have no bridge and cannot connect.');
      out('  - Click the OmniSnap icon, then turn that switch on.');
      out(`  - If you changed OMNISNAP_PORT, the extension needs the same value (${config.port}).`);
    }
  } else if (listening.inUse) {
    out(`port ${config.port}   ALREADY IN USE`);
    out('');
    out('Another copy of omnisnap-mcp is probably running. That is usually fine: your AI');
    out('client starts one for you. Close other copies, or set OMNISNAP_PORT in both the');
    out('client config and the extension.');
  } else {
    out(`port ${config.port}   could not bind: ${listening.error}`);
  }

  await probe.stop();
  process.exit(0);
}

const app = createServer();

/**
 * A crash must not leave an orphaned listener holding the bridge port: the
 * next run would fail to bind and the user would see a confusing "port in
 * use" instead of a working tool.
 */
let closing = false;
async function shutdown(reason, code = 0) {
  if (closing) return;
  closing = true;
  log.info('shutting down', { reason });
  try {
    await app.stop();
  } catch {
    /* going away regardless */
  }
  process.exit(code);
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => shutdown(signal));
}

// The client closing its end of stdio is the normal way this process ends.
process.stdin.on('close', () => shutdown('stdin closed'));

process.on('uncaughtException', (error) => {
  log.error('uncaught exception', { error: String(error && error.stack) });
  shutdown('uncaught exception', 1);
});

process.on('unhandledRejection', (reason) => {
  log.error('unhandled rejection', { reason: String(reason) });
});

await app.start();
await app.server.connect(new StdioServerTransport());
log.info('omnisnap-mcp ready', { version: VERSION });
