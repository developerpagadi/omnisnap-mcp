/**
 * Drives every tool against a real Chrome, and reports what worked.
 *
 * The test suite runs against stubs, which is the right trade for most
 * things and useless for the rest: a stub cannot tell you that
 * `chrome.tabs.captureVisibleTab` never returns while the DevTools protocol
 * is attached, or that a service worker failed to register at all. Those only
 * show up against the browser.
 *
 *   node scripts/verify-live.mjs [outputDirectory]
 *
 * The extension must be installed, enabled, paired, and showing an ordinary
 * web page. It refuses to run against a build older than EXPECTED, because a
 * stale service worker answers every call perfectly well with the previous
 * build's behaviour, which reads as a pass and is the most expensive kind of
 * wrong answer.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Bridge } from '../src/bridge/ws.js';
import { log } from '../src/lib/logger.js';

const EXPECTED = '2.0.0';
const OUT = process.argv[2] || '/tmp/omnisnap-verify';
mkdirSync(OUT, { recursive: true });
log.setLevel('silent');

const bridge = new Bridge();
const listening = await bridge.start();
if (!listening.ok) {
  console.log('Port busy. Close any other omnisnap-mcp and try again.');
  process.exit(1);
}

process.stdout.write('waiting for the extension');
const connected = await new Promise((resolve) => {
  const giveUp = setTimeout(() => resolve(false), 80_000);
  const dot = setInterval(() => process.stdout.write('.'), 2000);
  const watch = (state) => {
    if (state !== 'ready') return;
    clearTimeout(giveUp);
    clearInterval(dot);
    bridge.off('state', watch);
    resolve(true);
  };
  bridge.on('state', watch);
  if (bridge.state === 'ready') watch('ready');
});
console.log(connected ? ' connected\n' : ' timed out\n');
if (!connected) process.exit(1);

const running = (bridge.client || {}).version;
if (running !== EXPECTED) {
  console.log(`Stale build: Chrome runs ${running}, this expects ${EXPECTED}.`);
  console.log('On chrome://extensions, toggle OmniSnap off and on again. The reload');
  console.log('arrow does not reliably replace a worker holding an open socket.');
  await bridge.stop();
  process.exit(2);
}
console.log(`extension ${running}\n`);

let passed = 0;
let failed = 0;
const check = (ok, what) => {
  ok ? passed++ : failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
};
const kb = (base64) => `${Math.round((base64.length * 3) / 4 / 1024)}KB`;
const save = (name, base64) => writeFileSync(join(OUT, name), Buffer.from(base64, 'base64'));
const attempt = async (what, run) => {
  try {
    return await run();
  } catch (error) {
    check(false, `${what}: ${error.code || ''} ${error.message}`);
    return null;
  }
};

/* ── reading ── */

const tabs = await attempt('list_tabs', () => bridge.call('list_tabs', {}));
if (tabs) console.log(`    active tab: ${(tabs.tabs.find((t) => t.active) || {}).url}\n`);

const map = await attempt('annotate_interactive', () =>
  bridge.call('annotate_interactive', { include: 'all' })
);
if (map) {
  const shot = map.capture;
  save('annotated.jpg', shot.base64);
  check(shot.mimeType === 'image/jpeg', `images are JPEG (${shot.mimeType})`);
  check(shot.width <= 1536, `long edge capped at 1536 (${shot.width})`);
  check(Number(kb(shot.base64).replace('KB', '')) < 500, `under 500KB (${kb(shot.base64)})`);
  check(!!map.coverage, 'coverage is reported');
  if (map.coverage) {
    console.log(
      `    showing ${map.coverage.percentShown}% of ${map.coverage.pageHeight}px, more below: ${map.coverage.moreBelow}`
    );
  }
}

const first = map && map.elements.length ? map.elements[0] : null;
if (first) {
  const spec = await attempt('inspect_element by number', () =>
    bridge.call('inspect_element', { element: first.n })
  );
  check(!!spec && spec.box.width > 0, `element ${first.n} addressable by number`);
}

await attempt('a bad number', async () => {
  try {
    await bridge.call('inspect_element', { element: 999 });
    check(false, 'a number past the end of the map should be refused');
  } catch (error) {
    check(error.code === 'NO_SUCH_ELEMENT', `a bad number is refused (${error.code})`);
  }
});

const page = await attempt('read_page', () => bridge.call('read_page', {}));
if (page) {
  check(page.text.length > 50, `read_page returned ${page.text.length} characters`);
  check(page.headings.length > 0, `and ${page.headings.length} headings`);
}

const watched = await attempt('watch_page', () => bridge.call('watch_page', { seconds: 4 }));
if (watched) {
  check(watched.watchedMs === 4000, `watch_page watched ${watched.watchedMs}ms`);
  console.log(
    `    ${watched.errors.length} errors, ${watched.failedRequests.length} failed requests, ${watched.layoutShifts.length} shifts`
  );
}

await attempt('get_diagnostics', async () => {
  const d = await bridge.call('get_diagnostics', {});
  check(!!d.timing, 'diagnostics include the performance timing');
});

/* ── moving the camera ── */

const top = await attempt('scroll_to top', () => bridge.call('scroll_to', { to: 'top' }));
const next = await attempt('scroll_to next', () => bridge.call('scroll_to', { to: 'next' }));
if (top && next) check(next.scrollY > top.scrollY, `scroll_to moved the page (${top.scrollY} to ${next.scrollY})`);

const bottom = await attempt('scroll_to bottom', () => bridge.call('scroll_to', { to: 'bottom' }));
if (bottom) check(bottom.atBottom === true, `scroll_to bottom reaches the end (${bottom.scrollY})`);
await bridge.call('scroll_to', { to: 'top' }).catch(() => {});

if (first) {
  const hovered = await attempt('hover', () => bridge.call('hover', { element: first.n }));
  if (hovered) {
    save('hover.jpg', hovered.base64);
    check(!!hovered.base64, `hover returned ${kb(hovered.base64)}`);
  }

  const focused = await attempt('focus_element', () => bridge.call('focus_element', { element: first.n }));
  if (focused) {
    save('focus.jpg', focused.base64);
    check(!!focused.base64, `focus_element returned ${kb(focused.base64)}`);
  }
}

const phone = await attempt('set_viewport', () => bridge.call('set_viewport', { preset: 'mobile' }));
if (phone) {
  check(phone.emulating === true, `set_viewport held ${phone.width}x${phone.height}`);
  const atPhone = await attempt('capture at 375', () => bridge.call('capture_page', { mode: 'viewport' }));
  if (atPhone) {
    save('mobile.jpg', atPhone.base64);
    check(atPhone.width <= 800, `tools now answer about the phone (${atPhone.width}px)`);
  }
}

const dark = await attempt('set_color_scheme', () => bridge.call('set_color_scheme', { scheme: 'dark' }));
if (dark) {
  const atDark = await attempt('capture in dark', () => bridge.call('capture_page', { mode: 'viewport' }));
  if (atDark) {
    save('dark.jpg', atDark.base64);
    check(!!atDark.base64, `dark capture ${kb(atDark.base64)}`);
  }
}

// Always hand the page back, whatever happened above.
const released = await attempt('reset', () => bridge.call('set_viewport', { reset: true }));
check(released && released.emulating === false, 'the page was handed back at its real size');
await bridge.call('set_color_scheme', { scheme: 'auto' }).catch(() => {});

/* ── the newer tools ── */

const design = await attempt('get_design_tokens markdown', () =>
  bridge.call('get_design_tokens', { format: 'markdown' })
);
if (design) {
  check(design.code.startsWith('# Design system'), 'markdown returns a committable document');
  check(/Extracted from/.test(design.code), 'that records where it came from and when');
}

const audit = await attempt('audit_page', () => bridge.call('audit_page', {}));
if (audit) {
  check(Array.isArray(audit.issues), `audit_page ran, ${audit.issues.length} findings`);
  check(!!audit.checked.coverage, 'and says how much of the page it could see');
  const rules = [...new Set(audit.issues.map((i) => i.rule))];
  if (rules.length) console.log(`    ${rules.join(', ')}`);
  for (const issue of audit.issues.slice(0, 4)) {
    console.log(`    ${issue.severity} ${issue.rule}: ${issue.message.slice(0, 80)}`);
  }
}

const base = await attempt('diff_capture baseline', () => bridge.call('diff_capture', {}));
if (base) check(base.baseline === true, 'diff_capture takes a baseline first');
const again = await attempt('diff_capture compare', () => bridge.call('diff_capture', {}));
if (again) {
  check(again.baseline === undefined, 'and compares on the second call');
  console.log(`    ${again.regions ? again.regions.length : 0} regions, ${again.changedPercent ?? 0}% of the frame`);
  if (again.base64) save('diff.jpg', again.base64);
}

/* ── the page is left as it was found ── */

try {
  const stray = await bridge.call('inspect_element', { selector: '[data-omnisnap-ui]' });
  check(false, `an overlay was left in the page (${stray.box.width}x${stray.box.height})`);
} catch {
  check(true, 'no overlay left in the page');
}

console.log(`\n${passed} passed, ${failed} failed`);
console.log(`images in ${OUT}`);
console.log('\nNot covered here, because both need a person at the keyboard:');
console.log('  propose_action       the approval card has to be approved');
console.log('  await_user_selection the picker has to be clicked');
console.log('  capture_matrix       slow, and it replaces the stored capture');

await bridge.stop();
process.exit(failed ? 1 : 0);
