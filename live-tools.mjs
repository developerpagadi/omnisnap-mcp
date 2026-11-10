/* Drives every bridge tool against the real, paired extension. */
import { Bridge } from './src/bridge/ws.js';
import { log } from './src/lib/logger.js';
log.setLevel('silent');

const bridge = new Bridge();
const listening = await bridge.start();
if (!listening.ok) { console.log('could not listen:', listening.error || 'port in use'); process.exit(1); }

process.stdout.write('waiting for the extension to reconnect');
const ready = await new Promise((resolve) => {
  const timer = setTimeout(() => resolve(false), 75_000);
  const tick = setInterval(() => process.stdout.write('.'), 2000);
  const watch = (s) => { if (s === 'ready') { clearTimeout(timer); clearInterval(tick); bridge.off('state', watch); resolve(true); } };
  bridge.on('state', watch);
  if (bridge.state === 'ready') watch('ready');
});
console.log(ready ? ' connected\n' : ' TIMED OUT\n');
if (!ready) process.exit(1);

/* A stale service worker answers every call perfectly well, with the previous
   build's behaviour. That reads as a pass and is the most expensive kind of
   wrong answer, so the format is checked first and the run stops if it is the
   old one. */
{
  const probe = await bridge.call('capture_page', { mode: 'viewport' });
  if (probe.mimeType !== 'image/jpeg' || probe.width > 1536) {
    console.log(`STALE BUILD: got ${probe.mimeType} at ${probe.width}px, expected image/jpeg at <=1536px.`);
    console.log('Chrome is running a service worker from before the last edit.');
    console.log('On chrome://extensions, toggle OmniSnap off and on again, then re-run.');
    await bridge.stop();
    process.exit(2);
  }
  console.log(`build check: ${probe.mimeType} at ${probe.width}px — current\n`);
}

const results = [];
async function call(tool, args, describe) {
  const started = Date.now();
  try {
    const data = await bridge.call(tool, args);
    const ms = Date.now() - started;
    console.log(`OK    ${tool.padEnd(22)} ${String(ms).padStart(6)}ms  ${describe(data)}`);
    results.push(true);
    return data;
  } catch (error) {
    console.log(`FAIL  ${tool.padEnd(22)}          ${error.code || ''} ${error.message}`);
    results.push(false);
    return null;
  }
}

const kb = (b64) => Math.round((b64.length * 3) / 4 / 1024) + 'KB';

const tabs = await call('list_tabs', {}, (d) => `${d.tabs.length} tabs, active: ${(d.tabs.find(t => t.active) || {}).title || '-'}`);

const map = await call('annotate_interactive', { include: 'controls' },
  (d) => `${d.elements.length} elements, ${kb(d.capture.base64)} png ${d.capture.width}x${d.capture.height}`);
if (map && map.elements.length) {
  const e = map.elements[0];
  console.log(`         #1 ${e.label}  →  ${e.selector}  (stability ${e.score}, ${e.matches} match)`);
}

const hint = map && map.elements.length ? map.elements[0].label : 'button';
await call('collect_selectors', { hint }, (d) => `"${hint}" → ${d.candidates.length} candidates, best ${d.candidates[0].score}/100`);
await call('get_page_object', { framework: 'playwright-ts' }, (d) => `${d.code.split('\n').length} lines of Playwright`);
await call('verify_selectors', { selectors: ['body', 'button', '#definitely-not-here'] },
  (d) => d.results.map(r => `${r.selector}=${r.matches}`).join(' '));
await call('inspect_element', { selector: 'body' }, (d) => `body ${d.box.width}x${d.box.height}, font ${d.typography.size}px`);
await call('measure_accessibility', {}, (d) => `${d.issues.length} issues: ${[...new Set(d.issues.map(i => i.rule))].join(', ') || 'none'}`);
await call('get_diagnostics', {}, (d) => `${Object.keys(d).length} sections`);
await call('get_design_tokens', { format: 'json' }, (d) => `${(d.brand.colors || []).length} colours`);
await call('get_design_tokens', { format: 'css' }, (d) => `${d.code.split('\n').length} lines of CSS`);
await call('capture_page', { mode: 'viewport' }, (d) => `${kb(d.base64)} ${d.mimeType} ${d.width}x${d.height}`);
await call('capture_element', { selector: 'body' }, (d) => `${kb(d.base64)} ${d.mimeType} ${d.width}x${d.height}`);

// get_design_tokens reuses the capture pipeline's scrape, which used to paint
// capture chrome into the page. The overlay is a real element, so the bridge
// can be asked whether one was left behind.
try {
  const s = await bridge.call('inspect_element', { selector: '[data-omnisnap-ui]' });
  console.log(`\nFAIL  overlay left in the page: ${s.box.width}x${s.box.height}`);
  results.push(false);
} catch {
  console.log('\nOK    no overlay left in the page');
  results.push(true);
}

console.log(`\n${results.filter(Boolean).length}/${results.length} tools answered`);
await bridge.stop();
process.exit(results.every(Boolean) ? 0 : 1);
