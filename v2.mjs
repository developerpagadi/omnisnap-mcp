import { writeFileSync } from 'node:fs';
import { Bridge } from './src/bridge/ws.js';
import { log } from './src/lib/logger.js';
log.setLevel('silent');
const OUT = process.argv[2];
const bridge = new Bridge();
const l = await bridge.start();
if (!l.ok) { console.log('port busy'); process.exit(1); }
process.stdout.write('connecting');
const ok = await new Promise((res) => {
  const t = setTimeout(() => res(false), 80000);
  const tick = setInterval(() => process.stdout.write('.'), 2000);
  const w = (s) => { if (s === 'ready') { clearTimeout(t); clearInterval(tick); bridge.off('state', w); res(true); } };
  bridge.on('state', w); if (bridge.state === 'ready') w('ready');
});
console.log(ok ? ' ok\n' : ' timed out\n'); if (!ok) process.exit(1);

/* The extension names its version in the handshake, so staleness is a fact
   to read rather than something to infer from behaviour three times over. */
const EXPECTED = '1.7.0';
const running = (bridge.client || {}).version || 'unknown';
console.log(`extension reports version ${running}, expected ${EXPECTED}`);
if (running !== EXPECTED) {
  console.log(`\nSTALE BUILD. Chrome is running ${running}; the folder on disk is ${EXPECTED}.`);
  console.log('chrome://extensions -> toggle OmniSnap OFF, then ON. The reload arrow does not');
  console.log('always replace a service worker that is holding an open socket.');
  await bridge.stop();
  process.exit(2);
}
console.log();

const kb = (b) => Math.round((b.length * 3) / 4 / 1024) + 'KB';
let pass = 0, fail = 0;
const check = (c, m) => { c ? pass++ : fail++; console.log(`${c ? 'OK  ' : 'FAIL'} ${m}`); };

const map = await bridge.call('annotate_interactive', { include: 'all' });
const c = map.capture;
console.log(`image ${c.mimeType} ${c.width}x${c.height} ${kb(c.base64)}\n`);
check(c.mimeType === 'image/jpeg', `images are JPEG, not PNG (${c.mimeType})`);
check(c.width <= 1536, `edge capped at 1536 (${c.width})`);
check(kb(c.base64).replace('KB','') < 500, `under 500KB (${kb(c.base64)})`);
writeFileSync(OUT, Buffer.from(c.base64, 'base64'));

check(!!map.coverage, 'coverage is reported');
if (map.coverage) console.log(`     showing ${map.coverage.percentShown}% of ${map.coverage.pageHeight}px, more below: ${map.coverage.moreBelow}`);

const n = map.elements.length ? map.elements[0].n : null;
if (n) {
  const spec = await bridge.call('inspect_element', { element: n });
  check(!!spec && spec.box.width > 0, `element ${n} addressable by number (${spec.tag} ${Math.round(spec.box.width)}px)`);
}
try { await bridge.call('inspect_element', { element: 999 }); check(false, 'a bad number is refused'); }
catch (e) { check(e.code === 'NO_SUCH_ELEMENT', `a bad number is refused (${e.code})`); }

const before = await bridge.call('scroll_to', { to: 'top' });
const after = await bridge.call('scroll_to', { to: 'next' });
check(after.scrollY > before.scrollY, `scroll_to moved the page (${before.scrollY} -> ${after.scrollY} of ${after.pageHeight})`);
const bottom = await bridge.call('scroll_to', { to: 'bottom' });
check(bottom.atBottom === true, `scroll_to bottom reaches the end (${bottom.scrollY})`);
await bridge.call('scroll_to', { to: 'top' });

await bridge.call('get_design_tokens', { format: 'json' });
try { const o = await bridge.call('inspect_element', { selector: '[data-omnisnap-ui]' }); check(false, `overlay left behind ${o.box.width}x${o.box.height}`); }
catch { check(true, 'get_design_tokens leaves no overlay in the page'); }

console.log(`\n${pass} passed, ${fail} failed`);
await bridge.stop();
process.exit(fail ? 1 : 0);
