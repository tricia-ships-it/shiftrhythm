// Run with:  node --test tests/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../js/scheduler.js');

// Mon 9 Nov 2026 .. Sun 15 Nov 2026
const shifts = {
  '2026-11-09': 'day', '2026-11-10': 'day',
  '2026-11-11': 'night', '2026-11-12': 'night',
  '2026-11-13': 'off', '2026-11-14': 'off', '2026-11-15': 'off'
};
const base = { settings: {}, shifts, recurring: [], oneoffs: [], log: {} };
const plan = (extra, opts) => S.buildPlan(Object.assign({}, base, extra), Object.assign({ today: '2026-11-09', days: 7 }, opts));
const tasksOn = (p, d, title) => p.blocks.filter(b => b.kind === 'task' && b.date === d && (!title || b.title === title));
const overlaps = (a, b) => a.s < b.e && b.s < a.e;

test('date helpers', () => {
  assert.equal(S.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(S.weekday('2026-11-09'), 1);
  assert.equal(S.weekStart('2026-11-15', 1), '2026-11-09');
  assert.equal(S.hm('19:30'), 1170);
  assert.equal(S.hm('25:00'), null);
});

test('horizon runs to the end of next week', () => {
  const h = S.horizonFor('2026-11-07', {}); // Saturday
  assert.equal(h.end, '2026-11-15');
  assert.equal(h.days, 9);
});

test('night shift crosses midnight and sleep follows it', () => {
  const p = plan({});
  const night = p.blocks.find(b => b.kind === 'shift' && b.date === '2026-11-11');
  assert.equal(night.startTime, '19:00');
  assert.equal(night.endTime, '07:00');
  assert.equal(night.endDate, '2026-11-12');
  const sleep = p.blocks.find(b => b.kind === 'sleep' && b.date === '2026-11-12' && b.startTime === '07:45');
  assert.ok(sleep, 'sleep after night shift starts after the commute home');
  assert.ok(p.blocks.find(b => b.kind === 'nap' && b.date === '2026-11-11'), 'nap before the first night shift');
  assert.ok(!p.blocks.find(b => b.kind === 'nap' && b.date === '2026-11-12'), 'no nap before the second night in a row');
});

test('no task ever overlaps a shift, travel, sleep or another task', () => {
  const p = plan({
    recurring: [
      { id: 'w', title: 'Workout', durationMin: 45, per: 'week', times: 4, keepWhole: true },
      { id: 's', title: 'Singing', durationMin: 10, per: 'day', times: 1 },
      { id: 'c', title: 'Content', durationMin: 90, per: 'week', times: 2 }
    ],
    oneoffs: [{ id: 'x', title: 'Email MP', durationMin: 20 }]
  });
  const fixed = p.blocks.filter(b => ['shift', 'commute', 'sleep', 'nap', 'prep'].includes(b.kind));
  const tasks = p.blocks.filter(b => b.kind === 'task' || b.kind === 'break');
  for (const t of tasks) {
    for (const f of fixed) assert.ok(!overlaps(t, f), `${t.title} ${t.date} ${t.startTime} overlaps ${f.title}`);
    for (const u of tasks) if (u !== t) assert.ok(!overlaps(t, u), `${t.title} overlaps ${u.title}`);
  }
  assert.equal(p.unplaced.length, 0, JSON.stringify(p.unplaced));
});

test('focus rhythm splits long tasks with breaks between parts', () => {
  const p = plan({ settings: { focusMin: 30, breakMin: 15 }, recurring: [{ id: 'c', title: 'Edit video', durationMin: 90, per: 'week', times: 1, allow: { off: 'yes', day: 'no', night: 'no' } }] });
  const parts = p.blocks.filter(b => b.title === 'Edit video');
  assert.equal(parts.length, 3);
  assert.deepEqual(parts.map(b => b.minutes), [30, 30, 30]);
  assert.equal(parts[1].s - parts[0].e, 15);
  assert.equal(parts[0].part, '1/3');
});

test('keep-whole tasks are not split', () => {
  const p = plan({ recurring: [{ id: 'r', title: 'Choir rehearsal', durationMin: 120, per: 'week', times: 1, keepWhole: true, allow: { off: 'yes', day: 'no', night: 'no' } }] });
  const parts = p.blocks.filter(b => b.title === 'Choir rehearsal');
  assert.equal(parts.length, 1);
  assert.equal(parts[0].minutes, 120);
});

test('allow rules: off days only, and shift days only at weekends', () => {
  const choir = { id: 'r', title: 'Choir', durationMin: 60, per: 'day', times: 1, keepWhole: true, allow: { off: 'yes', day: 'weekend', night: 'no' } };
  const p = plan({ recurring: [choir], shifts: Object.assign({}, shifts, { '2026-11-14': 'day' }) });
  const days = p.blocks.filter(b => b.title === 'Choir').map(b => b.date).sort();
  assert.deepEqual(days, ['2026-11-13', '2026-11-14', '2026-11-15']); // Fri off, Sat weekend day shift, Sun off
});

test('weekly quota is spread across the week', () => {
  const p = plan({ recurring: [{ id: 'w', title: 'Workout', durationMin: 30, per: 'week', times: 3 }] });
  const days = new Set(p.blocks.filter(b => b.title === 'Workout').map(b => b.date));
  assert.equal(days.size, 3);
});

test('during-shift work tasks land inside the shift after handover', () => {
  const p = plan({ recurring: [{ id: 'v', title: 'VAPT session', durationMin: 60, per: 'week', times: 1, when: 'during' }] });
  const parts = p.blocks.filter(b => b.title === 'VAPT session');
  assert.ok(parts.length >= 1);
  const shift = p.blocks.find(b => b.kind === 'shift' && b.date === parts[0].date);
  assert.ok(parts.every(b => b.s >= shift.s + 30 && b.e <= shift.e));
  assert.ok(parts[0].during);
});

test('daily cap on shift days pushes work to off days', () => {
  const p = plan({ settings: { capShiftDay: 30 }, recurring: [{ id: 'a', title: 'Study', durationMin: 60, per: 'week', times: 2 }] });
  const days = p.blocks.filter(b => b.title === 'Study').map(b => b.date);
  for (const d of days) assert.equal(shifts[d], 'off');
});

test('done instances are not planned again and still show', () => {
  const key = 'w@W2026-11-09#0';
  const p = plan({
    recurring: [{ id: 'w', title: 'Workout', durationMin: 30, per: 'week', times: 1 }],
    log: { [key]: { status: 'done', date: '2026-11-09', start: '05:00', end: '05:30', title: 'Workout', taskId: 'w' } }
  });
  const ws = p.blocks.filter(b => b.title === 'Workout');
  assert.equal(ws.length, 1);
  assert.ok(ws[0].done);
});

test('today only uses time after now', () => {
  const p = plan({ recurring: [{ id: 's', title: 'Singing', durationMin: 10, per: 'day', times: 1 }] }, { today: '2026-11-13', nowMin: 15 * 60 + 2 });
  const t = tasksOn(p, '2026-11-13', 'Singing')[0];
  assert.ok(S.hm(t.startTime) >= 15 * 60 + 5);
});

test('fixed time is kept, and flagged when it clashes', () => {
  const p = plan({ oneoffs: [
    { id: 'a', title: 'Team call', durationMin: 30, date: '2026-11-13', fixedTime: '18:00' },
    { id: 'b', title: 'Clash', durationMin: 30, date: '2026-11-09', fixedTime: '12:00' }
  ] });
  const a = p.blocks.find(b => b.title === 'Team call');
  assert.equal(a.startTime, '18:00');
  assert.ok(!a.conflict);
  const b = p.blocks.find(b => b.title === 'Clash');
  assert.ok(b.conflict, 'during a day shift');
});

test('impossible tasks are reported with a reason', () => {
  const p = plan({ recurring: [{ id: 'z', title: 'Night-only thing', durationMin: 30, per: 'week', times: 1, allow: { off: 'no', day: 'no', night: 'weekend' } }] });
  assert.equal(p.unplaced.length, 1);
  assert.match(p.unplaced[0].reason, /No allowed days/);
});

test('monthly tasks are spread over the month', () => {
  const p = S.buildPlan(Object.assign({}, base, { recurring: [{ id: 'm', title: 'Outreach planning', durationMin: 60, per: 'month', times: 2 }] }), { today: '2026-11-01', days: 30 });
  const ds = p.blocks.filter(b => b.title === 'Outreach planning').map(b => b.date);
  assert.equal(new Set(ds).size, 2);
  assert.ok(S.diffDays(ds[0], ds[ds.length - 1]) >= 10);
});

test('getting-ready time before a shift is protected', () => {
  const p = plan({ recurring: [{ id: 's', title: 'Singing', durationMin: 10, per: 'day', times: 1 }] });
  const prep = p.blocks.find(b => b.kind === 'prep' && b.date === '2026-11-10');
  assert.equal(prep.startTime, '05:15');
  assert.equal(prep.endTime, '06:15');
  const sing = tasksOn(p, '2026-11-10', 'Singing')[0];
  assert.ok(!overlaps(sing, prep));
});
