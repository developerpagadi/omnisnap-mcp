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
const EXPECTED = '1.9.3';
const running = (bridge.client || {}).version;
console.log(`extension ${running}`);
if (running !== EXPECTED) {
  console.log(`\nSTALE BUILD — Chrome runs ${running}, disk is ${EXPECTED}.`);
  console.log('chrome://extensions -> toggle OmniSnap OFF then ON.');
  console.log('That also detaches any debugger attachment left over from a hung call.');
  await bridge.stop();
  process.exit(2);
}
console.log();

let pass = 0, fail = 0;
const check = (c, m) => { c ? pass++ : fail++; console.log(`${c ? 'OK  ' : 'FAIL'} ${m}`); };
const kb = (b) => Math.round((b.length * 3) / 4 / 1024) + 'KB';
const run = async (label, fn) => { try { return await fn(); } catch (e) { check(false, `${label} — ${e.code || ''} ${e.message}`); return null; } };

// ── read_page ──
const page = await run('read_page', () => bridge.call('read_page', {}));
if (page) {
  check(page.text.length > 50, `read_page returned ${page.text.length} chars (vs 88KB as a picture)`);
  check(page.headings.length > 0, `and ${page.headings.length} headings as an outline`);
  console.log(`     "${page.text.replace(/\s+/g,' ').slice(0, 90)}..."`);
}

// ── watch_page ──
const seen = await run('watch_page', () => bridge.call('watch_page', { seconds: 4 }));
if (seen) {
  check(seen.watchedMs === 4000, `watch_page watched ${seen.watchedMs}ms`);
  console.log(`     ${seen.errors.length} errors, ${seen.failedRequests.length} failed requests, ${seen.layoutShifts.length} shifts (total ${seen.totalShift})`);
  for (const e of seen.errors.slice(0,3)) console.log(`       [${e.level} @${e.at}ms] ${e.text.slice(0,90)}`);
}

// ── hover / focus ──
const map = await run('annotate', () => bridge.call('annotate_interactive', { include: 'all' }));
if (map && map.elements.length) {
  const target = map.elements.find(e => /sign|menu|nav|about|contact/i.test(e.label)) || map.elements[0];
  const hov = await run('hover', () => bridge.call('hover', { element: target.n }));
  if (hov) { check(!!hov.base64, `hover on "${target.label}" returned ${kb(hov.base64)}`); writeFileSync(OUT.replace('.jpg','-hover.jpg'), Buffer.from(hov.base64,'base64')); }
  const foc = await run('focus_element', () => bridge.call('focus_element', { element: target.n }));
  if (foc) check(!!foc.base64, `focus_element returned ${kb(foc.base64)}`);
}

// ── viewport + dark mode, always handed back ──
try {
  const phone = await bridge.call('set_viewport', { preset: 'mobile' });
  check(phone.emulating === true, `set_viewport held ${phone.width}x${phone.height}`);
  const atPhone = await bridge.call('annotate_interactive', {});
  check(atPhone.capture.width <= 800, `tools now answer about the phone (${atPhone.capture.width}px image)`);
  writeFileSync(OUT.replace('.jpg','-mobile.jpg'), Buffer.from(atPhone.capture.base64,'base64'));

  const dark = await bridge.call('set_color_scheme', { scheme: 'dark' });
  check(dark.emulating === true, 'set_color_scheme held dark');
  const atDark = await bridge.call('capture_page', { mode: 'viewport' });
  writeFileSync(OUT.replace('.jpg','-dark.jpg'), Buffer.from(atDark.base64,'base64'));
  check(!!atDark.base64, `dark capture ${kb(atDark.base64)}`);
} catch (e) { check(false, `emulation — ${e.code||''} ${e.message}`); }

const back = await run('reset', () => bridge.call('set_viewport', { reset: true }));
check(back && back.emulating === false, 'the page was handed back at its real size');
await bridge.call('set_color_scheme', { scheme: 'auto' }).catch(()=>{});

console.log(`\n${pass} passed, ${fail} failed`);
await bridge.stop();
process.exit(fail ? 1 : 0);
