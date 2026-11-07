/*
 * ShiftRhythm streaks, coins and streak freezes.
 *
 *  - A day COUNTS when you finish more than half of the tasks planned for it.
 *    It earns 1 coin, or 2 when you finish everything.
 *  - A day with nothing planned is a REST day: no coin, and the streak carries on.
 *  - A day that doesn't count is FROZEN automatically if you have enough coins
 *    (3 by default), which keeps the streak alive. Otherwise it's MISSED and the
 *    streak starts again.
 *  - Bonus coins at 7, 14, 30, 60 and 100 days in a row.
 *
 * Each day's list of planned tasks is remembered as the day goes on, so tasks that
 * slipped off the plan late in the day still count as planned.
 */
(function (root) {
  'use strict';
  var Sch = (typeof module !== 'undefined' && module.exports) ? require('./scheduler.js') : root.SR.scheduler;
  var FREEZE_COST = 3;
  var MILESTONES = { 7: 3, 14: 5, 30: 10, 60: 15, 100: 25 };
  var COUNTS = { win: true, perfect: true };

  function blank(today) { return { start: today, coins: 0, through: Sch.addDays(today, -1), days: {}, snap: {}, auto: true, best: 0 }; }
  function ensure(state, today) {
    if (!state.rewards || !state.rewards.start) state.rewards = blank(today);
    var r = state.rewards;
    r.days = r.days || {}; r.snap = r.snap || {}; if (r.auto === undefined) r.auto = true;
    return r;
  }

  function keysOn(plan, date) {
    var keys = {}, done = {};
    plan.blocks.forEach(function (b) {
      if (b.kind !== 'task' || b.date !== date || !b.key) return;
      keys[b.key] = true; if (b.done) done[b.key] = true;
    });
    plan.unplaced.forEach(function (u) { if (u.key && u.key.indexOf('@D' + date) > 0) keys[u.key] = true; }); // today's daily tasks that no longer fit
    return { keys: keys, done: done };
  }

  // Remember everything planned for today (call after each replan).
  function snapshot(state, plan, today) {
    var r = ensure(state, today);
    var k = keysOn(plan, today), list = r.snap[today] || [];
    Object.keys(k.keys).forEach(function (x) { if (list.indexOf(x) < 0) list.push(x); });
    r.snap[today] = list.slice(0, 200);
  }

  function doneCount(state, keys) {
    var n = 0, log = state.log || {};
    keys.forEach(function (k) {
      if (log[k] && log[k].status === 'done') n++;
      else if (k.indexOf('o:') === 0) { var id = k.slice(2); if ((state.oneoffs || []).some(function (o) { return o.id === id && o.done; })) n++; }
    });
    return n;
  }
  function plannedFor(state, date) {
    var r = state.rewards, keys = (r.snap[date] || []).slice();
    if (!keys.length) {
      // the app wasn't opened that day: rebuild what that day's plan would have been
      var p = Sch.buildPlan(state, { today: date, nowMin: 0, days: 1 });
      keys = Object.keys(keysOn(p, date).keys);
    }
    // skipped tasks don't count either way
    return keys.filter(function (k) { var L = (state.log || {})[k]; return !(L && L.status === 'skipped'); });
  }
  function score(state, date) {
    var keys = plannedFor(state, date), done = doneCount(state, keys);
    var status = !keys.length ? 'rest' : done === keys.length ? 'perfect' : done * 2 > keys.length ? 'win' : 'short';
    return { planned: keys.length, done: done, status: status, need: Math.max(0, Math.floor(keys.length / 2) + 1 - done) };
  }

  function streakBefore(r, date) {
    var n = 0, d = Sch.addDays(date, -1);
    while (d >= r.start) {
      var s = (r.days[d] || {}).s;
      if (COUNTS[s]) n++;
      else if (s !== 'rest' && s !== 'frozen') break;
      d = Sch.addDays(d, -1);
    }
    return n;
  }

  // Settle every finished day since the last check. Returns what happened, for messages.
  function evaluate(state, today) {
    var r = ensure(state, today), events = [];
    var d = Sch.addDays(r.through, 1);
    if (d < r.start) d = r.start;
    var guard = 0;
    while (d < today && guard++ < 120) {
      var sc = score(state, d), rec = { s: sc.status, p: sc.planned, n: sc.done, c: 0 };
      if (sc.status === 'short') {
        if (r.auto && r.coins >= FREEZE_COST) { r.coins -= FREEZE_COST; rec.s = 'frozen'; rec.c = -FREEZE_COST; events.push({ type: 'frozen', date: d }); }
        else { rec.s = 'missed'; events.push({ type: 'missed', date: d }); }
      } else if (COUNTS[sc.status]) {
        rec.c = sc.status === 'perfect' ? 2 : 1;
        r.days[d] = rec;
        var st = streakBefore(r, Sch.addDays(d, 1));
        if (MILESTONES[st]) { rec.c += MILESTONES[st]; events.push({ type: 'milestone', date: d, streak: st, coins: MILESTONES[st] }); }
        r.coins += rec.c;
        if (st > (r.best || 0)) r.best = st;
      }
      r.days[d] = rec;
      r.through = d;
      d = Sch.addDays(d, 1);
    }
    // tidy: keep 14 days of snapshots and 400 days of results
    var cut = Sch.addDays(today, -14), cut2 = Sch.addDays(today, -400);
    Object.keys(r.snap).forEach(function (k) { if (k < cut) delete r.snap[k]; });
    Object.keys(r.days).forEach(function (k) { if (k < cut2) delete r.days[k]; });
    return events;
  }

  // Everything the screen needs, including today's live progress.
  function status(state, plan, today) {
    var r = ensure(state, today);
    var keys = (r.snap[today] || []).slice();
    var k = keysOn(plan, today);
    Object.keys(k.keys).forEach(function (x) { if (keys.indexOf(x) < 0) keys.push(x); });
    keys = keys.filter(function (x) { var L = (state.log || {})[x]; return !(L && L.status === 'skipped'); });
    var done = doneCount(state, keys);
    var t = { planned: keys.length, done: done, status: !keys.length ? 'rest' : done === keys.length ? 'perfect' : done * 2 > keys.length ? 'win' : 'open', need: Math.max(0, Math.floor(keys.length / 2) + 1 - done) };
    var before = streakBefore(r, today);
    var todayCoins = t.status === 'perfect' ? 2 : t.status === 'win' ? 1 : 0;
    var hist = [];
    for (var i = 13; i >= 1; i--) { var d = Sch.addDays(today, -i); hist.push({ date: d, s: d < r.start ? 'none' : (r.days[d] || {}).s || 'none' }); }
    hist.push({ date: today, s: t.status === 'perfect' || t.status === 'win' ? t.status : 'today' });
    return {
      coins: r.coins, coinsWithToday: r.coins + todayCoins, todayCoins: todayCoins,
      streak: before + (todayCoins ? 1 : 0), streakBefore: before, best: Math.max(r.best || 0, before + (todayCoins ? 1 : 0)),
      today: t, history: hist, freezeCost: FREEZE_COST, auto: r.auto, canFreeze: r.coins >= FREEZE_COST
    };
  }

  var API = { snapshot: snapshot, evaluate: evaluate, status: status, ensure: ensure, FREEZE_COST: FREEZE_COST, MILESTONES: MILESTONES };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else { root.SR = root.SR || {}; root.SR.rewards = API; }
})(this);
