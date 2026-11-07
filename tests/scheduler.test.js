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
  const sleep = p.blocks.find(b => b.kind === 'sleep' && b.date === '2026-11-12' && b.title === 'Sleep between night shifts');
  assert.equal(sleep.startTime, '08:15', 'between two nights: sleep soon after getting home');
  assert.equal(sleep.endTime, '17:15', 'up in time to get ready for the next night');
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

test('project steps respect their window and may slip only to the project deadline', () => {
  const p = plan({ settings: { capOffDay: 60, capRecoveryDay: 60 }, oneoffs: [
    { id: 'a', title: 'Step A', durationMin: 60, after: '2026-11-13', due: '2026-11-13', deadline: '2026-11-15', project: 'p1' },
    { id: 'b', title: 'Step B', durationMin: 60, after: '2026-11-13', due: '2026-11-13', deadline: '2026-11-15', project: 'p1' },
    { id: 'c', title: 'Later step', durationMin: 30, after: '2026-11-20', due: '2026-11-22', project: 'p1' }
  ] });
  const a = p.blocks.find(b => b.title === 'Step A'), b = p.blocks.find(b => b.title === 'Step B');
  assert.equal(a.date, '2026-11-13');
  assert.ok(b.date > '2026-11-13' && b.date <= '2026-11-15', 'B slips past its own window because of the daily limit');
  assert.ok(!p.blocks.find(x => x.title === 'Later step'), 'outside the planning window: planned later');
  assert.equal(a.project, 'p1');
});

test('her sleep pattern: 10:00 after day shifts, afternoon rest after nights, 06:00 on normal off days', () => {
  const p = plan({});
  const day = d => p.days.find(x => x.date === d);
  assert.equal(day('2026-11-10').wake, '05:15', 'day shift: up in time to get ready and travel');
  assert.equal(day('2026-11-11').wake, '10:00', 'morning after a day shift');
  const rest = p.blocks.find(b => b.kind === 'sleep' && b.date === '2026-11-13' && b.title === 'Rest after night shift');
  assert.equal(rest.startTime, '12:30'); assert.equal(rest.endTime, '17:00');
  const night = p.blocks.find(b => b.kind === 'sleep' && b.date === '2026-11-13' && b.title === 'Sleep');
  assert.equal(night.startTime, '22:00');
  assert.equal(day('2026-11-14').wake, '06:00', 'normal off day');
  assert.equal(day('2026-11-13').kind, 'recovery');
  assert.equal(day('2026-11-14').kind, 'off');
});

test('morning routine runs back to back from wake time on normal off days only', () => {
  const only = { off: 'yes', recovery: 'no', day: 'no', night: 'no' };
  const p = plan({ recurring: [
    { id: 'ex', title: 'Exercise', durationMin: 45, per: 'day', times: 1, timeOfDay: 'wake', allow: only },
    { id: 'wa', title: 'Wash', durationMin: 20, per: 'day', times: 1, timeOfDay: 'wake', allow: only },
    { id: 'bf', title: 'Breakfast', durationMin: 30, per: 'day', times: 1, timeOfDay: 'wake', allow: only }
  ] });
  const on14 = p.blocks.filter(b => b.kind === 'task' && b.date === '2026-11-14');
  assert.deepEqual(on14.map(b => b.title + ' ' + b.startTime), ['Exercise 06:00', 'Wash 06:45', 'Breakfast 07:05']);
  assert.ok(!p.blocks.some(b => b.title === 'Exercise' && b.date === '2026-11-13'), 'not on the recovery day');
});

test('work tasks stay clear of shift start and end', () => {
  const mk = mins => plan({ settings: { handoverMin: 45, shiftEndBufferMin: 30 }, recurring: [{ id: 'v', title: 'Docs', durationMin: mins, per: 'week', times: 1, when: 'during', keepWhole: true, allow: { off: 'no', day: 'yes', night: 'no' } }] });
  const ok = mk(600).blocks.find(b => b.title === 'Docs');
  assert.equal(ok.startTime, '07:45');
  assert.ok(S.hm(ok.endTime) <= S.hm('18:30'));
  assert.equal(mk(660).unplaced.length, 1, '11 h does not fit in a 12 h shift minus 75 min');
});

test('opened after wake time: the rest of the routine starts now, in order', () => {
  const only = { off: 'yes', recovery: 'no', day: 'no', night: 'no' };
  const p = plan({ recurring: [
    { id: 'ex', title: 'Exercise', durationMin: 45, per: 'day', times: 1, timeOfDay: 'wake', allow: only },
    { id: 'bf', title: 'Breakfast', durationMin: 30, per: 'day', times: 1, timeOfDay: 'wake', allow: only },
    { id: 'pr', title: 'Project work', durationMin: 30, per: 'day', times: 1, priority: 1, allow: only }
  ] }, { today: '2026-11-14', nowMin: 9 * 60 + 3 });
  const t = p.blocks.filter(b => b.kind === 'task' && b.date === '2026-11-14').map(b => b.title + ' ' + b.startTime);
  assert.deepEqual(t.slice(0, 2), ['Exercise 09:05', 'Breakfast 09:50']);
});

test('routine continues after an item that was already ticked off', () => {
  const only = { off: 'yes', recovery: 'no', day: 'no', night: 'no' };
  const p = plan({ recurring: [
    { id: 'ex', title: 'Exercise', durationMin: 45, per: 'day', times: 1, timeOfDay: 'wake', allow: only },
    { id: 'bf', title: 'Breakfast', durationMin: 30, per: 'day', times: 1, timeOfDay: 'wake', allow: only }
  ], log: { 'ex@D2026-11-14#0': { status: 'done', date: '2026-11-14', start: '09:05', end: '09:50', title: 'Exercise', taskId: 'ex' } } },
  { today: '2026-11-14', nowMin: 9 * 60 + 6 });
  const bf = p.blocks.find(b => b.title === 'Breakfast' && b.date === '2026-11-14');
  assert.equal(bf.startTime, '09:50');
});

test('regular schedule: work Mon–Fri 9–5, weekends free, no recovery days', () => {
  const p = S.buildPlan({ settings: { mode: 'regular', workLabel: 'School', workDays: [1, 2, 3, 4, 5], shifts: { day: { start: '09:00', end: '17:00' } }, commuteMin: 30, prepMin: 60, wakeTime: '07:00' },
    shifts: { '2026-11-11': 'off' }, recurring: [{ id: 'g', title: 'Gym', durationMin: 45, per: 'week', times: 2, keepWhole: true }], oneoffs: [], log: {} }, { today: '2026-11-09', days: 7 });
  const school = p.blocks.filter(b => b.kind === 'shift').map(b => b.date);
  assert.deepEqual(school, ['2026-11-09', '2026-11-10', '2026-11-12', '2026-11-13'], 'Wednesday marked as a day off');
  assert.equal(p.blocks.find(b => b.kind === 'shift').title, 'School');
  assert.equal(p.blocks.find(b => b.kind === 'commute').title, 'Travel to school');
  assert.equal(p.days.find(d => d.date === '2026-11-10').wake, '07:30');
  assert.equal(p.days.find(d => d.date === '2026-11-14').kind, 'off', 'Saturday is a normal day off');
  assert.equal(p.days.find(d => d.date === '2026-11-14').wake, '07:00');
});

test('free mode: every day is your own', () => {
  const p = S.buildPlan({ settings: { mode: 'free', wakeTime: '07:30' }, shifts: {}, recurring: [{ id: 'r', title: 'Read', durationMin: 30, per: 'day', times: 1 }], oneoffs: [], log: {} }, { today: '2026-11-09', days: 7 });
  assert.equal(p.blocks.filter(b => b.kind === 'shift').length, 0);
  assert.equal(p.blocks.filter(b => b.title === 'Read').length, 7);
  assert.ok(p.days.every(d => d.kind === 'off'));
});

test('life areas: fixed-time area is blocked out with travel, and can be skipped', () => {
  const roles = [{ id: 'choir', name: 'Choir rehearsal', type: 'fixed', days: [6], start: '15:00', end: '17:00', commuteMin: 30, allow: { off: 'yes', recovery: 'yes', day: 'no', night: 'no' } }];
  const p = plan({ roles });
  const c = p.blocks.find(b => b.kind === 'commit');
  assert.equal(c.date, '2026-11-14'); assert.equal(c.startTime, '15:00'); assert.equal(c.title, 'Choir rehearsal');
  assert.ok(p.blocks.find(b => b.kind === 'commute' && b.title === 'Travel to Choir rehearsal' && b.startTime === '14:30'));
  const skipped = plan({ roles: [Object.assign({}, roles[0], { skip: ['2026-11-14'] })] });
  assert.ok(!skipped.blocks.some(b => b.kind === 'commit'));
});

test('life areas: an early class moves wake-up earlier', () => {
  const p = plan({ settings: { wakeTime: '08:00', prepMin: 60 }, roles: [{ id: 'cl', name: 'Classes', type: 'fixed', days: [6], start: '08:00', end: '10:00', commuteMin: 30 }] });
  assert.equal(p.days.find(d => d.date === '2026-11-14').wake, '06:30');
});

test('life areas: tasks can happen during a fixed area', () => {
  const p = plan({ roles: [{ id: 'pt', name: 'Part-time job', type: 'fixed', days: [5, 6], start: '10:00', end: '14:00' }],
    recurring: [{ id: 'r', title: 'Client report', durationMin: 60, per: 'week', times: 1, when: 'during', role: 'pt' }] });
  const t = p.blocks.find(b => b.title === 'Client report');
  const block = p.blocks.find(b => b.kind === 'commit' && b.date === t.date);
  assert.ok(t.s >= block.s && t.e <= block.e);
  assert.equal(t.role, 'pt');
});

test('life areas: flexible area tops up to its weekly hours, counting its own tasks', () => {
  const roles = [{ id: 'occ', name: 'Obaa Cyber Corps', type: 'flexible', weeklyHours: 4, session: 60, allow: { off: 'yes', recovery: 'yes', day: 'no', night: 'no' } }];
  const p = plan({ roles, recurring: [{ id: 'shoot', title: 'Shoot content', durationMin: 90, per: 'week', times: 1, keepWhole: true, role: 'occ', allow: { off: 'yes', recovery: 'yes', day: 'no', night: 'no' } }] });
  const area = p.blocks.filter(b => b.kind === 'task' && b.role === 'occ');
  const total = area.reduce((a, b) => a + b.minutes, 0);
  assert.equal(total, 240, '90 min of its own task + 150 min of general sessions');
  assert.ok(p.blocks.some(b => b.title === 'Obaa Cyber Corps time'));
  assert.ok(area.every(b => ['2026-11-13', '2026-11-14', '2026-11-15'].includes(b.date)), 'only on off days');
});

test('life areas: a finished area session is not planned again', () => {
  const roles = [{ id: 'fr', name: 'Freelance', type: 'flexible', weeklyHours: 1, session: 60 }];
  const log = { 'role:fr@W2026-11-09#0': { status: 'done', date: '2026-11-09', start: '20:00', end: '21:00', title: 'Freelance time', taskId: 'role:fr', role: 'fr' } };
  const p = plan({ roles, log });
  assert.equal(p.blocks.filter(b => b.title === 'Freelance time' && !b.done).length, 0);
});
