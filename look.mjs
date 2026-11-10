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
console.log(ok ? ' ok\n' : ' timed out\n');
if (!ok) process.exit(1);

const tabs = await bridge.call('list_tabs', {});
const active = tabs.tabs.find((t) => t.active);
console.log('ACTIVE TAB:', active ? active.url : '(none)');
console.log();

const map = await bridge.call('annotate_interactive', { include: 'all' });
writeFileSync(OUT, Buffer.from(map.capture.base64, 'base64'));
console.log(`image  ${map.capture.mimeType} ${map.capture.width}x${map.capture.height} -> ${OUT}`);
console.log(`build  ${map.capture.mimeType === 'image/jpeg' && map.capture.width <= 1536 ? 'CURRENT' : 'STALE (pre-22:14) — fine for looking, not for sign-off'}`);
console.log();

console.log('NUMBERED ELEMENTS');
for (const e of map.elements.slice(0, 14)) {
  console.log(`${String(e.n).padStart(2)}. ${(e.label || e.tag).slice(0, 34).padEnd(34)} ${String(e.score).padStart(3)}/100  ${e.matches === 1 ? 'unique' : e.matches + ' matches'}  ${e.selector}`);
}
console.log();

const a11y = await bridge.call('measure_accessibility', {});
console.log(`ACCESSIBILITY  ${a11y.issues.length} issues`);
for (const [rule, n] of Object.entries(a11y.issues.reduce((m, i) => ({ ...m, [i.rule]: (m[i.rule] || 0) + 1 }), {}))) console.log(`  ${rule}: ${n}`);
for (const i of a11y.issues.slice(0, 5)) console.log(`  - ${i.rule}: ${i.message}\n      ${i.selector}`);
console.log();

const d = await bridge.call('get_diagnostics', {});
console.log('DIAGNOSTICS');
console.log('  vitals   ', JSON.stringify(d.vitals || d.webVitals || {}).slice(0, 220));
if (d.network) console.log('  network  ', JSON.stringify({ failed: (d.network.failed || []).length, slow: (d.network.slow || []).length, total: d.network.total }).slice(0, 200));
if (d.console) console.log('  console  ', JSON.stringify({ errors: (d.console.errors || []).length, warnings: (d.console.warnings || []).length }));
console.log('  sections ', Object.keys(d).join(', '));
console.log();

const tok = await bridge.call('get_design_tokens', { format: 'json' });
const cols = (tok.brand.colors || []).slice(0, 10).map((c) => c.hex || c).join(' ');
console.log('DESIGN TOKENS');
console.log('  colours  ', (tok.brand.colors || []).length, '→', cols);
if (tok.brand.type) console.log('  type     ', JSON.stringify(tok.brand.type).slice(0, 200));
if (tok.contrast) console.log('  contrast ', JSON.stringify(tok.contrast).slice(0, 200));

await bridge.stop();
process.exit(0);
