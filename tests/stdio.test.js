/**
 * Stdout belongs to the protocol.
 *
 * This server speaks MCP over stdio, so one stray `console.log` anywhere in
 * the codebase writes a non-JSON-RPC line into the stream and the client's
 * parser gives up with an error that points nowhere near the cause. It is the
 * single most common way a stdio MCP server gets built wrong, and it is
 * invisible in development because nothing logs until something goes wrong.
 *
 * src/lib/logger.js explains why a runtime guard cannot work. This is the
 * check that replaces it: spawn the real binary, speak real JSON-RPC to it,
 * and assert every line it emits parses.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Runs the server, sends frames, returns everything it said on both streams. */
function session(frames, { env = {}, settleMs = 1500 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(ROOT, 'src', 'index.js')], {
      env: {
        ...process.env,
        OMNISNAP_LOG_LEVEL: 'debug',
        // A port of its own, so a developer's running server cannot make the
        // suite fail, and two test files cannot collide.
        OMNISNAP_PORT: String(18800 + Math.floor(Math.random() * 400)),
        OMNISNAP_STATE_DIR: join(ROOT, 'tests', '.tmp-state'),
        ...env,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));

    for (const frame of frames) child.stdin.write(`${JSON.stringify(frame)}\n`);

    setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => resolve({ stdout, stderr }), 250);
    }, settleMs);
  });
}

const INITIALIZE = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test', version: '0' },
  },
};

test('every line on stdout is valid JSON-RPC', async () => {
  const { stdout } = await session([INITIALIZE, { jsonrpc: '2.0', id: 2, method: 'tools/list' }]);
  const lines = stdout.split('\n').filter((l) => l.trim());

  assert.ok(lines.length > 0, 'the server said nothing on stdout');

  for (const line of lines) {
    let parsed;
    assert.doesNotThrow(() => {
      parsed = JSON.parse(line);
    }, `non-JSON on stdout, which corrupts the protocol: ${line.slice(0, 120)}`);
    assert.equal(parsed.jsonrpc, '2.0', `line was JSON but not JSON-RPC: ${line.slice(0, 120)}`);
  }
});

test('logging goes to stderr, where it cannot corrupt anything', async () => {
  const { stderr } = await session([INITIALIZE]);
  assert.match(stderr, /omnisnap-mcp ready/, 'expected the startup line on stderr');

  for (const line of stderr.split('\n').filter((l) => l.trim())) {
    assert.doesNotThrow(() => JSON.parse(line), `log line was not structured JSON: ${line.slice(0, 80)}`);
  }
});

test('the server answers initialize and advertises what it has', async () => {
  const { stdout } = await session([INITIALIZE]);
  const reply = stdout
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l))
    .find((m) => m.id === 1);

  assert.ok(reply, 'no reply to initialize');
  assert.equal(reply.result.serverInfo.name, 'omnisnap');
  assert.ok(reply.result.capabilities.tools, 'tools were not advertised');
  assert.ok(reply.result.capabilities.resources, 'resources were not advertised');
  assert.ok(reply.result.capabilities.prompts, 'prompts were not advertised');
  assert.match(reply.result.instructions, /logged-in browser/);
});

test('the whole tool surface is reachable and documented', async () => {
  const { stdout } = await session([INITIALIZE, { jsonrpc: '2.0', id: 2, method: 'tools/list' }]);
  const reply = stdout
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l))
    .find((m) => m.id === 2);

  assert.ok(reply, 'no reply to tools/list');
  const names = reply.result.tools.map((t) => t.name);

  for (const expected of [
    'omnisnap_status',
    'capture_page',
    'annotate_interactive',
    'collect_selectors',
    'get_page_object',
    'verify_selectors',
    'get_diagnostics',
    'get_design_tokens',
    'measure_accessibility',
  ]) {
    assert.ok(names.includes(expected), `${expected} was missing from tools/list`);
  }

  // A model chooses a tool by reading its description. A thin one is a bug.
  for (const tool of reply.result.tools) {
    assert.ok(
      tool.description && tool.description.length > 60,
      `${tool.name} needs a description a model can choose from`
    );
  }
});

/*
 * Without annotations the spec defaults to readOnlyHint false and
 * destructiveHint true, so a client puts a confirmation dialog in front of
 * every call. Every tool here only reads; a prompt before each capture would
 * make the server tedious enough to uninstall.
 */
test('only the tool that moves the page says it changes anything', async () => {
  const { stdout } = await session([INITIALIZE, { jsonrpc: '2.0', id: 2, method: 'tools/list' }]);
  const reply = stdout
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l))
    .find((m) => m.id === 2);

  /* Every tool here reads, with one deliberate exception: scroll_to moves the
     viewport, and the user watches their page move. Claiming read-only for it
     would buy a few skipped prompts by being untrue, and the whole argument
     for pairing this to a real logged-in browser is that it does not do that.

     Nothing else may join it without a line here, because an agent handed a
     silently-acting tool in someone's live session is the failure this
     product exists to avoid. */
  const MOVES = new Set([
    'scroll_to',
    // All of these change how the page is shown, not what it contains. The
    // user sees the result, so none of them may claim to be a pure read.
    'set_viewport',
    'set_color_scheme',
    'hover',
    'focus_element',
  ]);

  /* propose_action can click and type, so it is declared for what it is:
     not read-only, not idempotent, and destructive. The safety is that the
     user approves it in the page, which no annotation can express, so the
     annotation tells the truth and lets the client prompt. */
  const ACTS = new Set(['propose_action']);

  for (const tool of reply.result.tools) {
    assert.ok(tool.annotations, `${tool.name} has no annotations, so it defaults to destructive`);
    if (ACTS.has(tool.name)) {
      assert.equal(tool.annotations.readOnlyHint, false, `${tool.name} acts on the page`);
      assert.equal(tool.annotations.destructiveHint, true, `${tool.name} may not be undoable`);
      assert.equal(tool.annotations.idempotentHint, false, `${tool.name} is not safe to repeat`);
    } else if (MOVES.has(tool.name)) {
      assert.equal(tool.annotations.readOnlyHint, false, `${tool.name} does change something`);
      assert.equal(tool.annotations.destructiveHint, false, `${tool.name} destroys nothing`);
      assert.equal(tool.annotations.idempotentHint, true, `${tool.name} is safe to repeat`);
    } else {
      assert.equal(tool.annotations.readOnlyHint, true, `${tool.name} must be marked read-only`);
    }
  }

  for (const name of [...MOVES, ...ACTS]) {
    assert.ok(
      reply.result.tools.some((t) => t.name === name),
      `the exception list names ${name}, which does not exist`
    );
  }

  // The one place the browser answers back rather than being asked.
  const ask = reply.result.tools.find((t) => t.name === 'await_user_selection');
  assert.equal(ask.annotations.readOnlyHint, true, 'asking the user changes nothing');

  const status = reply.result.tools.find((t) => t.name === 'omnisnap_status');
  assert.equal(status.annotations.openWorldHint, false, 'status only reads local state');

  const capture = reply.result.tools.find((t) => t.name === 'capture_page');
  assert.equal(capture.annotations.openWorldHint, true, 'the live web changes underneath you');
});

test('an unpaired status call returns the remedy, not a stack trace', async () => {
  const { stdout } = await session([
    INITIALIZE,
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'omnisnap_status', arguments: {} } },
  ]);

  const reply = stdout
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l))
    .find((m) => m.id === 2);

  assert.ok(reply, 'no reply to the status call');
  const body = JSON.stringify(reply.result);
  assert.match(body, /not connected|not paired/i);
  assert.match(body, /chromewebstore\.google\.com/, 'the reply must carry the install link');
  assert.doesNotMatch(body, /at .*\.js:\d+/, 'a stack trace reached the model');
});

test('a port already in use is explained rather than fatal', async () => {
  // Two servers, same port: the second must still start and say why.
  const port = String(19500 + Math.floor(Math.random() * 200));
  const first = spawn(process.execPath, [join(ROOT, 'src', 'index.js')], {
    env: { ...process.env, OMNISNAP_PORT: port, OMNISNAP_LOG_LEVEL: 'silent' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  await new Promise((r) => setTimeout(r, 700));

  const { stdout } = await session(
    [INITIALIZE, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'omnisnap_status', arguments: {} } }],
    { env: { OMNISNAP_PORT: port } }
  );
  first.kill('SIGTERM');

  const reply = stdout
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l))
    .find((m) => m.id === 2);

  assert.ok(reply, 'the second server did not answer at all');
  assert.match(JSON.stringify(reply.result), /already listening|in use/i);
});

test('the version it reports is the version it is', async () => {
  const declared = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;

  const { stdout } = await session([INITIALIZE]);
  const initialised = stdout
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l))
    .find((m) => m.id === 1);

  // Two copies of a version drift the first time one is bumped and not the
  // other, and the symptom is a server telling every client it is older than
  // it is, which reads as a stale install nobody can fix by reinstalling.
  assert.equal(
    initialised.result.serverInfo.version,
    declared,
    'the version advertised over the protocol must match package.json'
  );
});

test('options can be given as flags, as environment, or left alone', async () => {
  const read = async (args, env) => {
    // A real script, started the way a client starts the server. With `-e`
    // there is no script path, so node claims `--port` as its own option and
    // the test proves nothing about how anyone actually runs this.
    const probe = spawn(process.execPath, [join(ROOT, 'tests', 'config-probe.js'), ...args], {
      cwd: ROOT,
      env: { ...process.env, ...env },
    });
    let out = '';
    let err = '';
    probe.stdout.on('data', (d) => (out += d));
    probe.stderr.on('data', (d) => (err += d));
    // 'close', not 'exit': exit fires when the process ends, close when its
    // pipes have drained, and the answer is on a pipe.
    await new Promise((resolve) => probe.on('close', resolve));
    assert.ok(out, `the probe printed nothing. stderr: ${err.slice(0, 300)}`);
    return JSON.parse(out);
  };

  const plain = await read([], {});
  assert.equal(plain.port, 8787, 'the default stands when nothing is given');
  assert.equal(plain.maxConcurrentCalls, 6);

  /* Both forms, because people write both and a config file that silently
     ignores half of what you put in it is worse than one that has no
     options at all. */
  const spaced = await read(['--port', '9001'], {});
  assert.equal(spaced.port, 9001, '--port 9001');

  const equals = await read(['--port=9002'], {});
  assert.equal(equals.port, 9002, '--port=9002');

  const fromEnv = await read([], { OMNISNAP_PORT: '9003' });
  assert.equal(fromEnv.port, 9003, 'OMNISNAP_PORT=9003');

  /* A flag is the more deliberate of the two: it is in the client config in
     front of you, where the environment may have come from a shell profile
     written months ago. */
  const both = await read(['--port=9004'], { OMNISNAP_PORT: '9005' });
  assert.equal(both.port, 9004, 'a flag wins over the environment');

  const limits = await read(['--max-concurrent-calls=2', '--call-timeout=5000'], {});
  assert.equal(limits.maxConcurrentCalls, 2);
  assert.equal(limits.callTimeoutMs, 5000);
});
