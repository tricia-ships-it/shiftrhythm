'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Y = require('../js/sync.js');

test('encrypts and decrypts; the envelope never contains the plan in clear text', async () => {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await Y.deriveKey('my long sync passphrase', salt);
  const state = { recurring: [{ id: 'a', title: 'Secret choir plan' }], log: {}, oneoffs: [], updatedAt: 1 };
  const text = await Y.seal(key, salt, state, 'Phone');
  assert.ok(!text.includes('Secret choir plan'));
  const back = await Y.unseal(key, JSON.parse(text));
  assert.deepEqual(back, state);
  const wrong = await Y.deriveKey('another passphrase!!', salt);
  await assert.rejects(Y.unseal(wrong, JSON.parse(text)));
});

test('tampered data is rejected', async () => {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await Y.deriveKey('my long sync passphrase', salt);
  const env = JSON.parse(await Y.seal(key, salt, { a: 1 }, 'x'));
  const bytes = Buffer.from(env.data, 'base64'); bytes[3] ^= 1; env.data = bytes.toString('base64');
  await assert.rejects(Y.unseal(key, env));
});

test('merge keeps work finished on either device and new tasks from both', () => {
  const phone = { updatedAt: 200, recurring: [{ id: 'r1', title: 'Gym v2' }], oneoffs: [{ id: 'o1', title: 'Call venue', done: false }, { id: 'o2', title: 'From phone' }],
    log: { 'r1@D2026-11-14#0': { status: 'done' } }, shifts: { '2026-11-20': 'day' } };
  const laptop = { updatedAt: 100, recurring: [{ id: 'r1', title: 'Gym' }, { id: 'r2', title: 'Read' }], oneoffs: [{ id: 'o1', title: 'Call venue', done: true }],
    log: { 'r2@D2026-11-14#0': { status: 'done' } }, shifts: { '2026-11-20': 'night' } };
  const m = Y.merge(laptop, phone);
  assert.equal(m.recurring.find(r => r.id === 'r1').title, 'Gym v2', 'newer copy wins on the same task');
  assert.ok(m.recurring.find(r => r.id === 'r2'), 'task added on the laptop kept');
  assert.ok(m.oneoffs.find(o => o.id === 'o2'), 'task added on the phone kept');
  assert.ok(m.oneoffs.find(o => o.id === 'o1').done, 'done on either device stays done');
  assert.equal(Object.keys(m.log).length, 2, 'ticks from both devices kept');
  assert.equal(m.shifts['2026-11-20'], 'day', 'newer roster wins');
  assert.equal(m.updatedAt, 200);
});

test('GitHub token is encrypted at rest and bound to its purpose', async () => {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await Y.deriveKey('a long and unusual passphrase', salt, 100000);
  const enc = await Y.sealToken(key, 'github_pat_SECRET123456789012345');
  assert.ok(!JSON.stringify(enc).includes('SECRET'));
  assert.equal(await Y.openToken(key, enc), 'github_pat_SECRET123456789012345');
  // a token blob can't be swapped in as plan data (different associated data)
  await assert.rejects(Y.unseal(key, { iv: enc.iv, data: enc.ct }));
});

test('synced files are checked before use', () => {
  assert.ok(!Y.validEnvelope(null));
  assert.ok(!Y.validEnvelope({ app: 'ShiftRhythm', v: 1, salt: 'AAAA', iv: 'AAAA', data: 'x' }), 'wrong salt/iv sizes');
  assert.ok(!Y.validEnvelope({ app: 'ShiftRhythm', v: 1, iter: 10, salt: Buffer.alloc(16).toString('base64'), iv: Buffer.alloc(12).toString('base64'), data: 'x' }), 'iteration count too low');
  assert.ok(Y.validEnvelope({ app: 'ShiftRhythm', v: 1, iter: 600000, salt: Buffer.alloc(16).toString('base64'), iv: Buffer.alloc(12).toString('base64'), data: 'x' }));
});

test('weak passphrases are refused for a new sync space', () => {
  assert.ok(Y.passProblem('short'));
  assert.ok(Y.passProblem('123456789012345'));
  assert.ok(Y.passProblem('aaaaaaaaaaaaaaa'));
  assert.ok(Y.passProblem('Password1234567'));
  assert.equal(Y.passProblem('choir songs at dawn'), '');
  assert.equal(Y.ITER, 600000);
});

test('merge ignores inherited keys', () => {
  const evil = JSON.parse('{"updatedAt":1,"log":{"__proto__":{"status":"done"}},"recurring":[],"oneoffs":[],"roles":[]}');
  const m = Y.merge({ updatedAt: 2, log: {}, recurring: [], oneoffs: [], roles: [] }, evil);
  assert.equal(Object.getPrototypeOf(m.log), Object.prototype);
  assert.equal(({}).status, undefined);
});
