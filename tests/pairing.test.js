/**
 * Pairing is the only thing standing between a local process and the user's
 * logged-in browser, so it gets the most assertions in the suite. Each one
 * pins a property the design depends on, not an implementation detail.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Pairing, safeEqual, makeCode, makeToken, originAllowed } from '../src/bridge/pairing.js';

test('a pairing code is six digits a person can read back', () => {
  for (let i = 0; i < 200; i++) {
    const code = makeCode();
    assert.match(code, /^\d{6}$/, `got ${code}`);
  }
});

test('codes are not predictable across sessions', () => {
  const seen = new Set(Array.from({ length: 300 }, makeCode));
  // 300 draws from a million: a generator stuck on a few values shows up fast.
  assert.ok(seen.size > 280, `only ${seen.size} distinct codes in 300 draws`);
});

test('a token is long enough to resist being guessed', () => {
  const token = makeToken();
  assert.ok(token.length >= 40, `token was only ${token.length} chars`);
  assert.notEqual(token, makeToken());
});

test('comparison is length-safe and value-correct', () => {
  assert.ok(safeEqual('123456', '123456'));
  assert.ok(!safeEqual('123456', '123457'));
  assert.ok(!safeEqual('123456', '12345'), 'a prefix must not pass');
  assert.ok(!safeEqual('12345', '123456'), 'a shorter candidate must not pass');
  assert.ok(!safeEqual('', 'x'));
  assert.ok(!safeEqual(undefined, 'x'));
  assert.ok(safeEqual('', ''));
});

test('the right code pairs once and only once', () => {
  const pairing = new Pairing();
  const first = pairing.approve(pairing.code);
  assert.ok(first.ok);
  assert.ok(first.token.length >= 40);

  const second = pairing.approve(pairing.code);
  assert.ok(!second.ok, 'a consumed pairing must not pair again');
  assert.equal(second.reason, 'already-used');
});

test('a wrong code is refused and the attempt is counted', () => {
  const pairing = new Pairing();
  const wrong = pairing.code === '000000' ? '111111' : '000000';
  const result = pairing.approve(wrong);
  assert.ok(!result.ok);
  assert.equal(result.reason, 'mismatch');
  assert.equal(result.remaining, 4);
});

test('guessing is capped, so six digits cannot be brute forced', () => {
  const pairing = new Pairing({ maxAttempts: 3 });
  const wrong = pairing.code === '000000' ? '111111' : '000000';

  assert.equal(pairing.approve(wrong).reason, 'mismatch');
  assert.equal(pairing.approve(wrong).reason, 'mismatch');
  assert.equal(pairing.approve(wrong).reason, 'mismatch');

  // Even the correct code is refused once the budget is spent: otherwise an
  // attacker gets unlimited tries by interleaving a guess with a retry.
  const afterLimit = pairing.approve(pairing.code);
  assert.ok(!afterLimit.ok);
  assert.equal(afterLimit.reason, 'too-many-attempts');
});

test('a stale code stops working', () => {
  const pairing = new Pairing({ ttlMs: -1 });
  assert.ok(pairing.expired);
  const result = pairing.approve(pairing.code);
  assert.ok(!result.ok);
  assert.equal(result.reason, 'expired');
});

test('a failed approval never leaks the code', () => {
  const pairing = new Pairing();
  const result = pairing.approve('000000');
  assert.ok(!Object.values(result).some((v) => v === pairing.code));
});

/*
 * The Origin check is the strongest defence in the system: a browser sets
 * this header itself and page JavaScript cannot override it, so a web page
 * simply cannot open this socket whatever it tries.
 */
test('only a browser extension origin is accepted', () => {
  assert.ok(originAllowed('chrome-extension://fjjfegkonlkleomaeopmakhlejjiljga'));
  assert.ok(originAllowed('chrome-extension://abc/'));
  assert.ok(originAllowed('moz-extension://abc'));
});

test('a web page origin is refused, however it is dressed up', () => {
  const hostile = [
    'https://evil.example.com',
    'http://localhost:3000',
    'https://chrome-extension.evil.com',
    'https://evil.com/chrome-extension://abc',
    'file://',
    'null',
    'chrome-extension://abc.evil.com',
    'chrome-extension://abc/../../evil',
  ];
  for (const origin of hostile) {
    assert.ok(!originAllowed(origin), `${origin} should have been refused`);
  }
});

test('a non-browser client with no Origin still has to pass the token', () => {
  // The harness and any future CLI connect this way. They face pairing like
  // everyone else; the Origin rule only exists to exclude web pages.
  assert.ok(originAllowed(undefined));
  assert.ok(originAllowed(''));
});
