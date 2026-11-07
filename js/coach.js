/*
 * Rhythm Coach: how to approach today, worked out on your device.
 * No AI service and no network: it reads your plan (shifts, sleep, tasks, projects, streak)
 * and applies simple rules about energy, priorities and recovery.
 *
 * coach(input) -> [{ icon, text }]  (at most 5, most important first)
 *   input.plan      a plan from SR.scheduler.buildPlan
 *   input.today     'YYYY-MM-DD'
 *   input.nowMin    minutes since midnight
 *   input.projects  [{ title, deadline, status, next: { title } }]  (optional)
 *   input.need      tasks still needed for today's coin (optional)
 *   input.workWord  'shift' / 'work' ... (optional)
 */
(function (root) {
  'use strict';
  var DAY = 1440;
  function fmt(m) { m = ((Math.round(m) % DAY) + DAY) % DAY; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); }
  function dur(m) { var h = Math.floor(m / 60), r = m % 60; return h ? h + ' h' + (r ? ' ' + r + ' min' : '') : r + ' min'; }
  function firstWord(t) { return String(t || '').split(' · ')[0]; }

  function coach(input) {
    var plan = input.plan, t = input.today, S = plan.settings || {};
    var dayIdx = Math.round((Date.UTC(+t.slice(0, 4), +t.slice(5, 7) - 1, +t.slice(8)) - Date.UTC(+plan.base.slice(0, 4), +plan.base.slice(5, 7) - 1, +plan.base.slice(8))) / 864e5);
    var now = dayIdx * DAY + input.nowMin, dayEnd = (dayIdx + 1) * DAY;
    var day = plan.days.filter(function (d) { return d.date === t; })[0] || { kind: 'off', type: 'off' };
    var blocks = plan.blocks;
    var todays = blocks.filter(function (b) { return b.e > dayIdx * DAY && b.s < dayEnd; });
    var left = todays.filter(function (b) { return b.kind === 'task' && !b.done && b.e > now && b.date === t; });
    var leftMin = left.reduce(function (a, b) { return a + b.minutes; }, 0);
    var shift = todays.filter(function (b) { return b.kind === 'shift'; })[0];
    var nextSleep = blocks.filter(function (b) { return (b.kind === 'sleep' || b.kind === 'nap') && b.s >= now; })[0];
    var restNow = blocks.filter(function (b) { return b.kind === 'sleep' && b.s <= now && now < b.e; })[0];
    var adjustedRest = todays.filter(function (b) { return b.kind === 'sleep' && b.adjusted; })[0];
    var tips = [];
    function add(icon, text, weight) { tips.push({ icon: icon, text: text, w: weight }); }
    var ww = input.workWord || 'shift';

    // 1. Energy and recovery.
    if (restNow) add('😴', 'You should be resting until ' + fmt(restNow.e) + '. Everything else can wait; it’s already planned around this.', 100);
    else if (day.kind === 'recovery' && day.type === 'off') {
      var rest = todays.filter(function (b) { return b.kind === 'sleep' && b.title !== 'Sleep' && b.e > now; })[0];
      if (rest) add('🌙', 'Recovery day after your night shift. Before your rest at ' + fmt(rest.s) + ', stick to light things; save anything that needs deep focus for after ' + fmt(rest.e) + '.', 90);
      else add('🌙', 'Recovery day. Go gently: short sessions, real breaks, and an early night so tomorrow starts fresh.', 70);
    }
    if (adjustedRest && adjustedRest.e <= now + 60) add('⏰', 'You rested later than planned, so today’s tasks moved later. Keep to tonight’s bedtime anyway, so tomorrow isn’t thrown off too.', 80);
    if (day.type === 'night' && shift && shift.s > now) {
      var nap = todays.filter(function (b) { return b.kind === 'nap' && b.e > now; })[0];
      add('🌃', 'Night ' + ww + ' from ' + fmt(shift.s) + '.' + (nap ? ' Protect your nap ' + fmt(nap.s) + '–' + fmt(nap.e) + '.' : '') + ' Eat a proper meal before you leave, and go easy on caffeine in the last hours of the ' + ww + ' so you can sleep after.', 85);
    }
    if (day.type === 'day' && shift && now < shift.e) {
      var after = left.filter(function (b) { return b.s >= shift.e; }).reduce(function (a, b) { return a + b.minutes; }, 0);
      add('💼', (now < shift.s ? 'Long day ahead. ' : '') + 'After your ' + ww + ' ends at ' + fmt(shift.e) + ', ' + (after ? 'you have ' + dur(after) + ' of personal tasks. Keep them light and stop if you’re drained.' : 'nothing else is planned. Rest is the plan.'), 60);
    }

    // 2. What to do first: the most demanding thing still ahead, while energy is best.
    var focus = left.filter(function (b) { return !b.routine && !b.during; });
    // before a recovery rest, deep work belongs after it
    var restAhead = day.kind === 'recovery' ? todays.filter(function (b) { return b.kind === 'sleep' && b.title !== 'Sleep' && b.s > now; })[0] : null;
    if (restAhead) focus = focus.filter(function (b) { return b.s >= restAhead.e; });
    var hardest = null;
    if (focus.length && !restNow) {
      // a task split into focus sessions counts as its whole length
      var total = {};
      focus.forEach(function (b) { total[b.key] = (total[b.key] || 0) + b.minutes; });
      function score(b) { return (b.project ? 2 : 0) + (b.overdue ? 3 : 0) + total[b.key] / 60; }
      hardest = focus.slice().sort(function (a, b) { return score(b) - score(a) || a.s - b.s; })[0];
      if (total[hardest.key] >= (restAhead ? 60 : 30) || hardest.project || hardest.overdue)
        add('🎯', (restAhead ? 'After your rest, start with the hardest thing: ' : 'Do the hard thing first: ') + firstWord(hardest.title) + ' at ' + fmt(hardest.s) + '. Phone away, one tab open.', 75);
    }

    // 3. Projects that need today's step.
    (input.projects || []).filter(function (p) { return p.status === 'behind' && p.next; }).slice(0, 1).forEach(function (p) {
      var step = left.filter(function (b) { return b.title === p.next.title; })[0];
      add('📈', p.title + ' is a little behind. ' + (step ? 'Today’s step, ' + p.next.title + ' at ' + fmt(step.s) + ', is the one to protect.' : 'Fit in its next step, ' + p.next.title + ', when you can.'), 78);
    });

    // 4. Load: too much or too little.
    // awake time until the main sleep, not counting rests and naps on the way
    var mainSleep = blocks.filter(function (b) { return b.kind === 'sleep' && b.title === 'Sleep' && b.s >= now; })[0];
    var until = mainSleep ? Math.min(mainSleep.s, dayEnd + 360) : (nextSleep ? Math.min(nextSleep.s, dayEnd + 360) : dayEnd);
    var awakeLeft = Math.max(0, until - now);
    blocks.forEach(function (b) {
      if ((b.kind === 'sleep' || b.kind === 'nap' || b.kind === 'shift' || b.kind === 'commute') && b.e > now && b.s < until && !(b.kind === 'shift' && left.some(function (x) { return x.during; })))
        awakeLeft -= Math.min(b.e, until) - Math.max(b.s, now);
    });
    awakeLeft = Math.max(30, awakeLeft);
    if (left.length >= 3 && leftMin > 0.6 * awakeLeft) {
      var spare = function (b) { return !(hardest && b.key === hardest.key) && !b.project; };
      var drop = left.filter(function (b) { return b.source === 'area' && spare(b); }).concat(left.filter(function (b) { return b.source === 'recurring' && !b.routine && spare(b); }))[0];
      add('⚖️', 'Full day: ' + dur(leftMin) + ' of tasks in about ' + dur(Math.round(awakeLeft / 5) * 5) + ' of free time.' + (drop ? ' If your energy dips, skip ' + firstWord(drop.title) + '; it will be planned again.' : ' If your energy dips, skip what can wait; it will be planned again.'), 72);
    } else if (!left.length && !restNow && awakeLeft > 120 && !(shift && now < shift.e)) {
      add('🌿', 'Nothing left on today’s list. Rest, or get a head start on something coming up. Both count.', 40);
    }

    // 5. Streak nudge in the evening.
    if (input.need > 0 && input.nowMin >= 17 * 60 && left.length) {
      var quick = left.slice().sort(function (a, b) { return a.minutes - b.minutes; })[0];
      add('🔥', input.need + ' more task' + (input.need > 1 ? 's' : '') + ' for today’s coin. Quickest: ' + firstWord(quick.title) + ' (' + dur(quick.minutes) + ').', 65);
    }

    // 6. Wind-down before sleep.
    var bed = blocks.filter(function (b) { return b.kind === 'sleep' && b.s > now && b.s - now < 180 && b.title === 'Sleep'; })[0];
    if (bed) add('🛏️', 'Bedtime ' + fmt(bed.s) + '. Screens down and lights low 30 minutes before.', 50);

    if (!tips.length) add('✨', 'Your day is planned around your sleep and commitments. Follow the chimes and take your breaks.', 10);
    return tips.sort(function (a, b) { return b.w - a.w; }).slice(0, 5).map(function (x) { return { icon: x.icon, text: x.text }; });
  }

  var API = { coach: coach };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else { root.SR = root.SR || {}; root.SR.coach = API; }
})(this);
