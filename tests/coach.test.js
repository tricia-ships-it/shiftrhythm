// Rhythm Coach: advice worked out on the device from the plan.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../js/scheduler.js');
const { coach } = require('../js/coach.js');

const shifts = { '2026-11-09': 'day', '2026-11-10': 'day', '2026-11-11': 'night', '2026-11-12': 'night', '2026-11-13': 'off', '2026-11-14': 'off', '2026-11-15': 'off' };
const all = { off: 'yes', recovery: 'yes', day: 'yes', night: 'yes' };
const recurring = [
  { id: 'read', title: 'Read', durationMin: 30, per: 'day', times: 1, allow: all },
  { id: 'gym', title: 'Workout', durationMin: 45, per: 'day', times: 1, allow: all, keepWhole: true },
  { id: 'write', title: 'Write the data protection policy', durationMin: 90, per: 'day', times: 1, allow: all }
];
const st = extra => Object.assign({ settings: {}, shifts, recurring, oneoffs: [], log: {}, roles: [] }, extra);
const text = tips => tips.map(t => t.text).join('\n');

test('recovery day after nights: protect the rest, light things first', () => {
  const plan = S.buildPlan(st(), { today: '2026-11-13', nowMin: 10 * 60 });
  const tips = coach({ plan, today: '2026-11-13', nowMin: 10 * 60 });
  assert.match(text(tips), /Recovery day after your night shift/);
  assert.ok(tips.length >= 1 && tips.length <= 5);
});

test('while resting: tells you to rest, nothing else first', () => {
  const plan = S.buildPlan(st({ adjust: { '2026-11-13': { rest: [900, 1170] } } }), { today: '2026-11-13', nowMin: 15 * 60 + 5 });
  const tips = coach({ plan, today: '2026-11-13', nowMin: 15 * 60 + 5 });
  assert.match(tips[0].text, /resting until 19:30/);
});

test('free day: points at the hardest task first', () => {
  const plan = S.buildPlan(st(), { today: '2026-11-14', nowMin: 7 * 60 });
  const tips = coach({ plan, today: '2026-11-14', nowMin: 7 * 60 });
  assert.match(text(tips), /Do the hard thing first: Write the data protection policy/);
});

test('night shift tonight: nap and caffeine advice', () => {
  const plan = S.buildPlan(st(), { today: '2026-11-11', nowMin: 10 * 60 });
  const tips = coach({ plan, today: '2026-11-11', nowMin: 10 * 60, workWord: 'shift' });
  assert.match(text(tips), /Night shift from 19:00/);
});

test('evening streak nudge names the quickest task', () => {
  const plan = S.buildPlan(st(), { today: '2026-11-14', nowMin: 18 * 60 });
  const tips = coach({ plan, today: '2026-11-14', nowMin: 18 * 60, need: 1 });
  const left = plan.blocks.filter(b => b.kind === 'task' && b.date === '2026-11-14' && b.e > plan.blocks[0].s);
  if (left.length) assert.match(text(tips), /more task for today.s coin/);
});

test('behind project: today’s step is the one to protect', () => {
  const plan = S.buildPlan(st({ oneoffs: [{ id: 's1', title: 'Draft the venue list', durationMin: 60, date: '2026-11-14', project: 'p1', projectTitle: 'Builders Circle event', allow: all }] }), { today: '2026-11-14', nowMin: 7 * 60 });
  const tips = coach({ plan, today: '2026-11-14', nowMin: 7 * 60, projects: [{ title: 'Builders Circle event', status: 'behind', next: { title: 'Draft the venue list' } }] });
  assert.match(text(tips), /Builders Circle event is a little behind/);
});

test('no Claude or network references in the app code', () => {
  const fs = require('node:fs');
  ['coach.js', 'capture.js', 'smart.js'].forEach(f => {
    const src = fs.readFileSync(__dirname + '/../js/' + f, 'utf8');
    assert.ok(!/Ask Claude|with Claude|Claude refined/.test(src), f);
    assert.ok(!/fetch\(|XMLHttpRequest/.test(src), f + ' makes no network requests');
  });
});
