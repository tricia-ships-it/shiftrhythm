'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../js/smart.js');
const today = '2026-11-07'; // Saturday
const one = (t) => S.parseOne(t, today, {});

test('deadline, total time and type from a sentence', () => {
  const p = one('Plan the Builders Circle November event by 28 Nov, about 8 hours');
  assert.equal(p.title, 'Plan the Builders Circle November event');
  assert.equal(p.due, '2026-11-28');
  assert.equal(p.totalMin, 480);
  assert.equal(p.type, 'event');
  assert.ok(p.isProject);
});

test('date formats', () => {
  assert.equal(one('Submit report by 15/12').due, '2026-12-15');
  assert.equal(one('Submit report by December 20th').due, '2026-12-20');
  assert.equal(one('Call mum tomorrow').date, '2026-11-08');
  assert.equal(one('Book flights by next Friday').due, '2026-11-13');
  assert.equal(one('Finish slides by end of the month').due, '2026-11-30');
  assert.equal(one('Pay rent in 3 days').date, '2026-11-10');
  assert.equal(one('Send report by the 2nd').due, '2026-12-02');
});

test('durations', () => {
  assert.equal(one('Edit the video, takes 1h30').durationMin, 90);
  assert.equal(one('Reply to emails, half an hour').durationMin, 30);
  assert.equal(one('Study for the exam by Dec 20, 10 hours total').totalMin, 600);
  assert.equal(one('Write the exam notes, 45 min').durationMin, 45);
});

test('time, work tasks and priority', () => {
  const p = one('Call the venue tomorrow at 3pm, urgent');
  assert.equal(p.fixedTime, '15:00');
  assert.equal(p.priority, 1);
  assert.equal(p.title, 'Call the venue');
  assert.equal(one('Start the data protection documentation for work by 15/12').when, 'during');
  assert.equal(one('Roll out another VAPT session by end of the month').when, 'during');
});

test('quick actions are not turned into projects', () => {
  const p = one('Send Kofi the slides by Monday');
  assert.ok(!p.isProject);
  assert.equal(p.due, '2026-11-09');
});

test('recurring phrases', () => {
  assert.deepEqual(one('Gym 3 times a week for 45 minutes').recurrence, { per: 'week', times: 3, weekdays: [] });
  assert.deepEqual(one('Choir rehearsal every Saturday and Sunday, 1 hour').recurrence.weekdays, [6, 0]);
  assert.equal(one('Pray for 15 minutes every day').recurrence.per, 'day');
});

test('several tasks in one dictation', () => {
  const ps = S.parse('Send Kofi the slides by Monday. Also book a dentist appointment next week', today, {});
  assert.equal(ps.length, 2);
  assert.equal(ps[1].title, 'Book a dentist appointment');
});

test('breakdown spreads steps before the deadline, in order, with slack', () => {
  const p = one('Plan the Builders Circle November event by 28 Nov, about 8 hours');
  const b = S.breakdown(p, { today });
  assert.ok(b.steps.length >= 5);
  assert.equal(b.finishBy, '2026-11-26'); // 3 weeks out: finish 2 days early
  let prev = '0000';
  for (const s of b.steps) {
    assert.ok(s.after >= today && s.due <= b.finishBy && s.after <= s.due);
    assert.ok(s.after >= prev); prev = s.after;
  }
  assert.ok(Math.abs(b.totalMin - 480) <= 40);
});

test('big steps are split into sessions', () => {
  const p = one('Study for the exam by Dec 20, 20 hours total');
  const b = S.breakdown(p, { today, maxSession: 120 });
  assert.ok(b.steps.every(s => s.minutes <= 125));
  assert.ok(b.steps.some(s => /\(\d+\/\d+\)/.test(s.title)));
});
