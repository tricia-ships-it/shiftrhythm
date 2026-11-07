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
