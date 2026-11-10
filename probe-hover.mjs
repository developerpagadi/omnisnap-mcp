import { Bridge } from './src/bridge/ws.js';
import { log } from './src/lib/logger.js';
log.setLevel('silent');
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

const timed = async (label, fn) => {
  const t0 = Date.now();
  try { const r = await fn(); console.log(`OK    ${label.padEnd(26)} ${String(Date.now()-t0).padStart(6)}ms`); return r; }
  catch (e) { console.log(`FAIL  ${label.padEnd(26)} ${String(Date.now()-t0).padStart(6)}ms  ${e.code||''} ${e.message.slice(0,80)}`); return null; }
};

const tabs = await bridge.call('list_tabs', {});
console.log('active tab:', (tabs.tabs.find(t=>t.active)||{}).url, '\n');

await timed('content script alive', () => bridge.call('inspect_element', { selector: 'body' }));
const map = await timed('annotate_interactive', () => bridge.call('annotate_interactive', {}));
const n = map && map.elements.length ? map.elements[0].n : null;
console.log(`  first element: ${n ? map.elements[0].label : '(none)'}\n`);

if (n) await timed('hover (90s budget)', () => bridge.call('hover', { element: n }, { timeoutMs: 90000 }));
await timed('content script after hover', () => bridge.call('inspect_element', { selector: 'body' }));
await timed('focus_element', () => bridge.call('focus_element', { selector: 'body' }));
await timed('set_viewport mobile', () => bridge.call('set_viewport', { preset: 'mobile' }));
await timed('reset viewport', () => bridge.call('set_viewport', { reset: true }));

await bridge.stop();
process.exit(0);
