'use strict';
// Untrusted input: imported backups, synced files and calendar export.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm'), fs = require('node:fs');
global.SR = { scheduler: require('../js/scheduler.js') };
global.localStorage = { getItem() { return null; }, setItem() {} };
vm.runInThisContext(fs.readFileSync(__dirname + '/../js/store.js', 'utf8'));
vm.runInThisContext(fs.readFileSync(__dirname + '/../js/ics.js', 'utf8'));
const St = SR.store;

test('imports cannot pollute prototypes or smuggle reserved ids', () => {
  const raw = JSON.parse('{"setupDone":true,"log":{"__proto__":{"status":"done"},"constructor":{"status":"done"},"ok@D2026-11-09#0":{"status":"done","date":"2026-11-09"}},' +
    '"shifts":{"__proto__":"day","2026-11-09":"day"},"recurring":[{"id":"__proto__","title":"x","role":"__proto__"}],"roles":[{"id":"__proto__","name":"Evil"}],' +
    '"rewards":{"start":"2026-11-01","days":{"__proto__":{"s":"win"}},"snap":{"2026-11-01":["__proto__","a@D2026-11-01#0"]}}}');
  const s = St.clean(raw);
  assert.deepEqual(Object.keys(s.log), ['ok@D2026-11-09#0']);
  assert.deepEqual(Object.keys(s.shifts), ['2026-11-09']);
  assert.notEqual(s.recurring[0].id, '__proto__');
  assert.equal(s.recurring[0].role, '');
  assert.notEqual(s.roles[0].id, '__proto__');
  assert.deepEqual(Object.keys(s.rewards.days), []);
  assert.equal(({}).status, undefined);
  assert.equal(Object.getPrototypeOf(s.log), Object.prototype);
});

test('imports clamp sizes and types', () => {
  const s = St.clean({ recurring: [{ title: 'x'.repeat(5000), durationMin: 1e12, times: 999, per: 'year', priority: 'high' }], settings: { focusMin: -5, theme: '<script>' } });
  assert.equal(s.recurring[0].title.length, 120);
  assert.equal(s.recurring[0].durationMin, 720);
  assert.equal(s.recurring[0].times, 14);
  assert.equal(s.recurring[0].per, 'week');
  assert.equal(s.settings.theme, 'auto');
});

test('calendar export cannot be tricked into extra lines', () => {
  const plan = { blocks: [{ kind: 'task', id: 'task:x', date: '2026-11-09', endDate: '2026-11-09', startTime: '09:00', endTime: '09:30', title: 'Hi\rEND:VEVENT\rBEGIN:VEVENT\nSUMMARY:pwned x', part: '' }] };
  const ics = SR.ics.build(plan, ['task'], 0);
  const lines = ics.split('\r\n');
  assert.equal(lines.filter(l => l === 'BEGIN:VEVENT').length, 1, 'still exactly one event');
  assert.ok(!lines.some(l => l.startsWith('SUMMARY:pwned')), 'no injected property line');
  assert.ok(!/\r(?!\n)/.test(ics) && !/[^\r]\n/.test(ics), 'no bare CR or LF');
});

test('encrypted backups use 600,000 rounds and older backups still open', async () => {
  const st = St.blank(); st.recurring.push(St.cleanTask({ title: 'Secret', durationMin: 30 }, false));
  const txt = await St.exportBackup(st, 'a long passphrase here');
  const outer = JSON.parse(txt);
  assert.equal(outer.iter, 600000);
  assert.ok(!txt.includes('Secret'));
  const back = await St.importBackup(txt, 'a long passphrase here');
  assert.equal(back.recurring[0].title, 'Secret');
  await assert.rejects(St.importBackup(txt, 'wrong passphrase!!'));
  outer.iter = 10; await assert.rejects(St.importBackup(JSON.stringify(outer), 'a long passphrase here'));
});
