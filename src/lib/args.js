/**
 * A command-line flag, an environment variable, or neither.
 *
 * Both, rather than one, because MCP clients differ in what they make easy.
 * Every client lets you pass `args`; not all let you set `env`, and in those
 * that do it is a second block of JSON people forget. A flag in the args
 * array is the path of least resistance, so the options have to be reachable
 * that way, and the environment stays for shells and containers.
 *
 * It lives apart from config.js because the logger needs it too, and the
 * logger cannot import config: config logs when it fails to write state.
 */

/** Accepts `--port 8787` and `--port=8787`, because people write both. */
export function flag(name) {
  const argv = process.argv;
  const exact = `--${name}`;

  // From 1, not 2. Normally argv[1] is the script path, but it is not there
  // when the process is started in ways that have no script path, and a
  // filesystem path is never going to collide with "--port".
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === exact) {
      const next = argv[i + 1];
      return next !== undefined && !next.startsWith('--') ? next : 'true';
    }
    if (argv[i].startsWith(`${exact}=`)) return argv[i].slice(exact.length + 1);
  }
  return undefined;
}

/** A flag wins over the environment: it is the more deliberate of the two. */
export function read(name, variable) {
  const fromFlag = flag(name);
  return fromFlag === undefined ? process.env[variable] : fromFlag;
}
