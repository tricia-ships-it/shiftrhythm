// When the day drifts: actual rest, busy time, work started early or finished late.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm'), fs = require('node:fs');
const S = require('../js/scheduler.js');
global.SR = global.SR || {};
global.SR.scheduler = S;
vm.runInThisContext(fs.readFileSync(__dirname + '/../js/store.js', 'utf8'));
const St = SR.store;

const shifts = { '2026-11-09': 'day', '2026-11-10': 'day', '2026-11-11': 'night', '2026-11-12': 'night', '2026-11-13': 'off', '2026-11-14': 'off', '2026-11-15': 'off' };
const reading = { id: 'read', title: 'Read', durationMin: 30, per: 'day', times: 1, allow: { off: 'yes', recovery: 'yes', day: 'yes', night: 'yes' } };
function state(extra) { return Object.assign({ settings: {}, shifts, recurring: [reading], oneoffs: [], log: {}, roles: [] }, extra); }
const overlaps = (a, b) => a.s < b.e && b.s < a.e;

test('after a night shift: fell asleep at 15:00 instead of 12:30, so the day moves after 19:30', () => {
  const before = S.buildPlan(state(), { today: '2026-11-13', nowMin: 15 * 60, days: 1 });
  const planned = before.blocks.find(b => b.kind === 'sleep' && b.title === 'Rest after night shift');
  assert.ok(planned, 'a rest after the night shift is planned');
  const p = S.buildPlan(state({ adjust: { '2026-11-13': { rest: [900, 1170] } } }), { today: '2026-11-13', nowMin: 15 * 60, days: 1 });
  const rest = p.blocks.find(b => b.kind === 'sleep' && b.title === 'Rest');
  assert.equal(rest.startTime, '15:00');
  assert.equal(rest.endTime, '19:30');
  assert.ok(!p.blocks.some(b => b.kind === 'sleep' && b !== rest && b.e > rest.s && b.s < rest.s), 'the planned rest stops where the real one starts');
  const tasks = p.blocks.filter(b => b.kind === 'task' && b.date === '2026-11-13');
  assert.ok(tasks.length >= 1, 'today still has its reading');
  tasks.forEach(t => assert.ok(t.s >= rest.e, t.title + ' is after the rest'));
});

test('busy until 12:00 keeps tasks out of that time', () => {
  const p = S.buildPlan(state({ adjust: { '2026-11-14': { busy: [[540, 720, 'Busy']] } } }), { today: '2026-11-14', nowMin: 9 * 60, days: 1 });
  const busy = p.blocks.find(b => b.kind === 'busy');
  assert.equal(busy.startTime, '09:00'); assert.equal(busy.endTime, '12:00');
  p.blocks.filter(b => b.kind === 'task').forEach(t => assert.ok(!overlaps(t, busy), t.title + ' does not clash'));
});

test('arrived early: work starts at 06:40 and work tasks can begin straight away', () => {
  const work = { id: 'vapt', title: 'VAPT session', durationMin: 30, per: 'day', times: 1, when: 'during', allow: { off: 'no', day: 'yes', night: 'yes' } };
  const st = state({ recurring: [work], settings: { handoverMin: 45 }, adjust: { '2026-11-09': { shift: { start: 400 } } } });
  const p = S.buildPlan(st, { today: '2026-11-09', nowMin: 400, days: 1 });
  const shift = p.blocks.find(b => b.kind === 'shift' && b.date === '2026-11-09');
  assert.equal(shift.startTime, '06:40');
  const t = p.blocks.find(b => b.kind === 'task' && b.title === 'VAPT session');
  assert.equal(t.startTime, '06:40', 'no settling-in wait when you chose to start early');
});

test('stayed late: travel home moves after the new finish time', () => {
  const p = S.buildPlan(state({ adjust: { '2026-11-09': { shift: { end: 1230 } } } }), { today: '2026-11-09', nowMin: 19 * 60, days: 1 });
  const shift = p.blocks.find(b => b.kind === 'shift' && b.date === '2026-11-09');
  assert.equal(shift.endTime, '20:30');
  const home = p.blocks.find(b => b.kind === 'commute' && b.title === 'Travel home' && b.date === '2026-11-09');
  assert.equal(home.startTime, '20:30');
});

test('a night shift that ran late is counted from its own start date', () => {
  const p = S.buildPlan(state({ adjust: { '2026-11-11': { shift: { end: 1440 + 480 } } } }), { today: '2026-11-11', nowMin: 20 * 60, days: 2 });
  const night = p.blocks.find(b => b.kind === 'shift' && b.date === '2026-11-11');
  assert.equal(night.endTime, '08:00'); assert.equal(night.endDate, '2026-11-12');
});

test('day changes are validated when loaded or synced', () => {
  const s = St.clean({ adjust: {
    '2026-11-13': { rest: [900, 1170], busy: [[540, 720, 'Traffic'], [800, 700], 'x'], shift: { start: -5, end: 1230 } },
    'not-a-date': { rest: [1, 2] },
    '2026-11-14': { rest: [1200, 900] },
    '__proto__': { rest: [1, 2] }
  } });
  assert.deepEqual(s.adjust['2026-11-13'], { rest: [900, 1170], busy: [[540, 720, 'Traffic']], shift: { end: 1230 } });
  assert.equal(Object.keys(s.adjust).length, 1);
  assert.equal(({}).rest, undefined);
});

test('old day changes are pruned', () => {
  const s = St.clean({ adjust: { '2026-11-01': { rest: [900, 1000] }, '2026-11-13': { rest: [900, 1000] } } });
  St.prune(s, '2026-11-13');
  assert.deepEqual(Object.keys(s.adjust), ['2026-11-13']);
});

test('suggested activities for every persona are valid tasks', () => {
  const ctx = { SR: { scheduler: S, store: St, app: null } };
  ctx.this = ctx;
  vm.runInNewContext(fs.readFileSync(__dirname + '/../js/areas.js', 'utf8').replace('})(this);', '})(ctx);'), { ctx, Object, JSON, Math, String, Array, Number });
  const IDEAS = ctx.SR.areas.IDEAS;
  ctx.SR.areas.PERSONAS.forEach(p => assert.ok(IDEAS[p.id], 'suggestions for ' + p.id));
  Object.keys(IDEAS).forEach(k => IDEAS[k].forEach(i => {
    const t = St.cleanTask(Object.assign({ id: 'x' }, i), false);
    assert.ok(t && t.title === i.title && t.durationMin === i.durationMin && t.per === i.per, k + ': ' + i.title);
  }));
});
