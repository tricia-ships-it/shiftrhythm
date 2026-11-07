'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../js/scheduler.js');
const R = require('../js/rewards.js');

const tasks = ['a', 'b', 'c'].map(id => ({ id, title: 'Task ' + id, durationMin: 20, per: 'day', times: 1 }));
const done = (d, ids) => Object.fromEntries(ids.map((id, i) => [id + '@D' + d + '#0', { status: 'done', date: d, start: '1' + i + ':00', end: '1' + i + ':20', title: 'Task ' + id, taskId: id }]));
const mk = log => ({ settings: {}, shifts: {}, recurring: tasks, oneoffs: [], log, rewards: { start: '2026-11-09', coins: 0, through: '2026-11-08', days: {}, snap: {}, auto: true } });

test('coins, perfect days, auto freeze and missed days', () => {
  const st = mk(Object.assign({}, done('2026-11-09', ['a', 'b']), done('2026-11-10', ['a', 'b', 'c']), done('2026-11-11', ['a']), done('2026-11-13', ['a', 'b'])));
  const ev = R.evaluate(st, '2026-11-14');
  const d = st.rewards.days;
  assert.equal(d['2026-11-09'].s, 'win');      // 2 of 3: majority
  assert.equal(d['2026-11-10'].s, 'perfect');  // 3 of 3
  assert.equal(d['2026-11-11'].s, 'frozen');   // 1 of 3, had 3 coins
  assert.equal(d['2026-11-12'].s, 'missed');   // 0 of 3, no coins left
  assert.equal(d['2026-11-13'].s, 'win');
  assert.equal(st.rewards.coins, 1);
  assert.deepEqual(ev.map(e => e.type), ['frozen', 'missed']);
  assert.equal(st.rewards.through, '2026-11-13');
  assert.deepEqual(R.evaluate(st, '2026-11-14'), [], 'each day is settled once');
});

test('streak survives frozen and rest days, breaks on missed', () => {
  const st = mk(Object.assign({}, done('2026-11-09', ['a', 'b']), done('2026-11-10', ['a', 'b', 'c']), done('2026-11-11', ['a']), done('2026-11-12', ['a', 'b'])));
  R.evaluate(st, '2026-11-13');
  const plan = S.buildPlan(st, { today: '2026-11-13', nowMin: 600 });
  const s = R.status(st, plan, '2026-11-13');
  assert.equal(s.streakBefore, 3, 'win, perfect, (frozen), win');
  assert.equal(s.today.planned, 3);
  assert.equal(s.today.need, 2);
});

test('half is not a majority; nothing planned is a rest day', () => {
  const two = [{ id: 'a', title: 'A', durationMin: 20, per: 'day', times: 1 }, { id: 'b', title: 'B', durationMin: 20, per: 'day', times: 1 }];
  const st = { settings: {}, shifts: {}, recurring: two, oneoffs: [], log: done('2026-11-09', ['a']), rewards: { start: '2026-11-09', coins: 0, through: '2026-11-08', days: {}, snap: {}, auto: true } };
  R.evaluate(st, '2026-11-10');
  assert.equal(st.rewards.days['2026-11-09'].s, 'missed');
  const rest = { settings: {}, shifts: {}, recurring: [], oneoffs: [], log: {}, rewards: { start: '2026-11-09', coins: 0, through: '2026-11-08', days: {}, snap: {}, auto: true } };
  R.evaluate(rest, '2026-11-10');
  assert.equal(rest.rewards.days['2026-11-09'].s, 'rest');
});

test('7 days in a row pays a bonus', () => {
  let log = {};
  for (let i = 0; i < 7; i++) Object.assign(log, done(S.addDays('2026-11-09', i), ['a', 'b']));
  const st = mk(log);
  const ev = R.evaluate(st, '2026-11-16');
  assert.equal(st.rewards.coins, 7 + 3);
  assert.equal(ev.find(e => e.type === 'milestone').streak, 7);
  assert.equal(st.rewards.best, 7);
});

test('today counts tasks that slipped off the plan during the day', () => {
  const st = mk({});
  st.rewards.snap['2026-11-14'] = ['a@D2026-11-14#0', 'b@D2026-11-14#0', 'c@D2026-11-14#0', 'gone@D2026-11-14#0'];
  const plan = S.buildPlan(st, { today: '2026-11-14', nowMin: 600 });
  assert.equal(R.status(st, plan, '2026-11-14').today.planned, 4);
});
