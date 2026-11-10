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
      'Environment:',
      `  OMNISNAP_PORT           bridge port (default ${config.port})`,
      '  OMNISNAP_LOG_LEVEL      silent | error | warn | info | debug',
      `  OMNISNAP_STATE_DIR      where the pairing token lives (default ${config.stateDir})`,
      '',
    ].join('\n')
  );
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
