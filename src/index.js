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
      '  --doctor                check the port, pairing and extension',
      '  --version, --help',
      '',
      'Environment:',
      `  OMNISNAP_PORT           bridge port (default ${config.port})`,
      '  OMNISNAP_LOG_LEVEL      silent | error | warn | info | debug',
      `  OMNISNAP_STATE_DIR      where the pairing token lives (default ${config.stateDir})`,
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
    out('Waiting 10s for the extension to connect...');
    const connected = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 10_000);
      probe.on('state', (state) => {
        if (state === 'ready' || state === 'pairing') {
          clearTimeout(timer);
          resolve(state);
        }
      });
    });

    if (connected === 'ready') out('The extension connected and is paired. Everything works.');
    else if (connected === 'pairing')
      out(`The extension connected and is waiting to pair. Its code should be ${probe.pendingCode}.`);
    else {
      out('No extension connected.');
      out('  - Is OmniSnap AI Studio installed and enabled?');
      out('  - Click its icon, then "Connect to AI".');
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
