/*
 * ShiftRhythm scheduling engine.
 *
 * Pure functions, no DOM, no network. Given the user's settings, shift calendar,
 * recurring tasks, one-off tasks and completion log, it builds a plan:
 *   1. lays down shifts, travel time, sleep and pre-night-shift naps,
 *   2. works out the free time left in each day (and the quiet time inside shifts),
 *   3. expands recurring tasks into instances (per day / week / month),
 *   4. places every instance in focus sessions separated by breaks,
 *   5. reports anything that could not fit, and why.
 *
 * Times are handled as "absolute minutes" from 00:00 of the day before the
 * planning window, so night shifts that cross midnight are just longer intervals.
 * Calendar maths uses UTC dates so daylight-saving changes cannot shift days.
 */
(function (root) {
  'use strict';

  var DAY = 1440;

  // ---------- small helpers ----------
  function hm(s) {
    if (typeof s !== 'string' || !/^\d{1,2}:\d{2}$/.test(s)) return null;
    var p = s.split(':');
    var h = Number(p[0]), m = Number(p[1]);
    if (h > 23 || m > 59) return null;
    return h * 60 + m;
  }
  function fmt(min) {
    min = ((min % DAY) + DAY) % DAY;
    return String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0');
  }
  function toDate(iso) {
    var p = iso.split('-').map(Number);
    return new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  }
  function isoOf(dt) { return dt.toISOString().slice(0, 10); }
  function addDays(iso, n) { var d = toDate(iso); d.setUTCDate(d.getUTCDate() + n); return isoOf(d); }
  function weekday(iso) { return toDate(iso).getUTCDay(); } // 0 = Sunday
  function diffDays(a, b) { return Math.round((toDate(b) - toDate(a)) / 86400000); }
  function weekStart(iso, startsOn) {
    var back = (weekday(iso) - startsOn + 7) % 7;
    return addDays(iso, -back);
  }
  function monthKey(iso) { return iso.slice(0, 7); }
  function monthDates(iso) {
    var out = [], d = iso.slice(0, 8) + '01';
    while (d.slice(0, 7) === iso.slice(0, 7)) { out.push(d); d = addDays(d, 1); }
    return out;
  }
  function isIso(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }

  // Remove [s, e) from a sorted list of free windows.
  function subtract(windows, s, e) {
    var out = [];
    for (var i = 0; i < windows.length; i++) {
      var w = windows[i];
      if (e <= w.s || s >= w.e) { out.push(w); continue; }
      if (s > w.s) out.push({ s: w.s, e: s });
      if (e < w.e) out.push({ s: e, e: w.e });
    }
    return out;
  }
  function endOfWindowAt(windows, t) {
    for (var i = 0; i < windows.length; i++) if (windows[i].s <= t && t <= windows[i].e) return windows[i].e;
    return t;
  }
  function contained(windows, s, e) {
    for (var i = 0; i < windows.length; i++) if (windows[i].s <= s && e <= windows[i].e) return true;
    return false;
  }

  // ---------- defaults ----------
  var DEFAULT_SETTINGS = {
    mode: 'shifts',          // 'shifts' (rotating day/night), 'regular' (set days, e.g. Mon–Fri 9–5), 'free' (no fixed commitments)
    workLabel: 'Work',       // what a regular commitment is called: Work, School, Lectures...
    workDays: [1, 2, 3, 4, 5],
    shifts: { day: { start: '07:00', end: '19:00' }, night: { start: '19:00', end: '07:00' } },
    commuteMin: 45,        // travel each way
    prepMin: 60,           // getting ready between waking and leaving
    sleepHours: 8,           // least sleep before a shift
    wakeTime: '06:00',       // wake time on a normal off day
    wakeAfterDayShift: '10:00', // wake time the morning after a day shift (when not working)
    bedtime: '22:00',        // usual bedtime (earlier when a shift needs it)
    postNightSleep: '12:30', // after a night shift: stay up until this time...
    postNightWake: '17:00',  // ...rest until this time, then sleep again at bedtime
    napMin: 90,              // nap before the first night shift in a run (0 = off)
    handoverMin: 30,         // settling-in time at the start of a shift, kept free of work tasks
    shiftEndBufferMin: 30,   // handover time at the end of a shift, kept free of work tasks
    focusMin: 30,
    breakMin: 15,
    capOffDay: 300,        // max minutes of personal tasks on an off day
    capShiftDay: 60,       // ... on a day-shift or night-shift day
    capRecoveryDay: 150,   // ... on the first off day after a shift
    weekendDays: [0, 6],
    weekStartsOn: 1,
    sound: true,
    volume: 0.6,
    chime: 'bells',
    headsUpMin: 5,
    maxSession: 120,       // longest single sitting for a project step
    name: '',
    theme: 'auto',
    voice: false           // browser voice typing (opt-in: it uses an online speech service)
  };
  var TIME_OF_DAY = {
    wake: [0, 24 * 60],          // first thing after waking, in list order (morning routine)
    morning: [5 * 60, 12 * 60],
    afternoon: [12 * 60, 17 * 60],
    evening: [17 * 60, 23 * 60]
  };

  function withDefaults(s) {
    s = s || {};
    var out = {};
    Object.keys(DEFAULT_SETTINGS).forEach(function (k) { out[k] = s[k] !== undefined ? s[k] : DEFAULT_SETTINGS[k]; });
    out.shifts = {
      day: Object.assign({}, DEFAULT_SETTINGS.shifts.day, (s.shifts || {}).day || {}),
      night: Object.assign({}, DEFAULT_SETTINGS.shifts.night, (s.shifts || {}).night || {})
    };
    out.sleepMin = Math.round(Number(out.sleepHours) * 60) || 480;
    out.mode = ['shifts', 'regular', 'free'].indexOf(out.mode) >= 0 ? out.mode : 'shifts';
    out.workLabel = String(out.workLabel || 'Work').slice(0, 30) || 'Work';
    out.workDays = Array.isArray(out.workDays) ? out.workDays : DEFAULT_SETTINGS.workDays;
    ['commuteMin', 'prepMin', 'napMin', 'handoverMin', 'shiftEndBufferMin', 'focusMin', 'breakMin', 'capOffDay', 'capShiftDay', 'capRecoveryDay', 'headsUpMin'].forEach(function (k) {
      out[k] = Math.max(0, Math.round(Number(out[k]) || 0));
    });
    if (out.focusMin < 5) out.focusMin = 5;
    return out;
  }

  // ---------- planning window ----------
  // From today to the end of the calendar week that contains today + 6,
  // so weekly quotas are always planned against whole weeks.
  function horizonFor(today, settings) {
    var S = withDefaults(settings);
    var end = addDays(weekStart(addDays(today, 6), S.weekStartsOn), 6);
    return { from: today, days: diffDays(today, end) + 1, end: end };
  }

  // ---------- main ----------
  function buildPlan(state, opts) {
    state = state || {};
    opts = opts || {};
    var S = withDefaults(state.settings);
    var today = opts.today;
    var hz = horizonFor(today, S);
    var from = today, nDays = opts.days || hz.days;
    var horizonEnd = addDays(from, nDays - 1);
    var base = addDays(from, -1);
    var span = nDays + 3;
    var dates = [];
    for (var i = 0; i < span; i++) dates.push(addDays(base, i));
    var horizon = [];
    for (i = 0; i < nDays; i++) horizon.push(addDays(from, i));

    var shifts = state.shifts || {};
    var log = state.log || {};
    // An explicit entry wins (a holiday, an extra day); otherwise a regular schedule follows its weekdays.
    function typeOf(d) {
      var t = shifts[d];
      if (t === 'day' || t === 'night' || t === 'off') return t;
      return S.mode === 'regular' && S.workDays.indexOf(weekday(d)) >= 0 ? 'day' : 'off';
    }
    var shiftsMode = S.mode === 'shifts', wl = S.workLabel.toLowerCase();
    function idx(d) { return diffDays(base, d); }
    function abs(d, m) { return idx(d) * DAY + m; }
    function dateOfAbs(a) { return addDays(base, Math.floor(a / DAY)); }
    var nowAbs = opts.nowMin != null ? abs(today, opts.nowMin) : null;
    // Changes to a single day ("resting now until 19:30", "busy until 17:00", "started work at 06:40").
    // Minutes count from midnight of that date and may run past 24:00.
    var adjust = state.adjust || {};
    function adj(d) { var a = adjust[d]; return a && typeof a === 'object' ? a : null; }
    function mins(v) { return typeof v === 'number' && isFinite(v) && v >= -DAY && v <= 2 * DAY ? Math.round(v) : null; }

    // 1. Fixed structure: shifts, travel, sleep, naps.
    var structure = [];
    dates.forEach(function (d) {
      var t = typeOf(d);
      if (t === 'off') return;
      var sh = S.shifts[t];
      var s = abs(d, hm(sh.start)), e = abs(d, hm(sh.end));
      if (e <= s) e += DAY;
      var ad = adj(d) && adj(d).shift, moved = false;
      if (ad) {
        var as = mins(ad.start), ae = mins(ad.end);
        if (as != null && abs(d, as) < e) { s = abs(d, as); moved = 'start'; }
        if (ae != null && abs(d, ae) > s) { e = abs(d, ae); moved = true; }
      }
      structure.push({ s: s, e: e, kind: 'shift', adjusted: moved, title: !shiftsMode && t === 'day' ? S.workLabel : t === 'day' ? 'Day shift' : 'Night shift', shiftType: t });
      if (S.prepMin > 0) structure.push({ s: s - S.commuteMin - S.prepMin, e: s - S.commuteMin, kind: 'prep', title: 'Get ready for ' + (!shiftsMode && t === 'day' ? wl : t === 'day' ? 'day shift' : 'night shift') });
      if (S.commuteMin > 0) {
        structure.push({ s: s - S.commuteMin, e: s, kind: 'commute', title: 'Travel to ' + (shiftsMode ? 'work' : wl) });
        structure.push({ s: e, e: e + S.commuteMin, kind: 'commute', title: 'Travel home' });
      }
      if (t === 'night') {
        var home = e + S.commuteMin, nd = addDays(d, 1);
        if (typeOf(nd) === 'night') {
          // another night shift tonight: sleep through the day until it's time to get ready
          var nextStart = abs(nd, hm(S.shifts.night.start));
          structure.push({ s: home + 30, e: nextStart - S.commuteMin - S.prepMin, kind: 'sleep', title: 'Sleep between night shifts' });
        } else if (typeOf(nd) === 'off') {
          // stay up a while after getting home, rest in the afternoon, sleep again at night
          var rs = Math.max(home + 30, abs(nd, hm(S.postNightSleep))), re = abs(nd, hm(S.postNightWake));
          if (re - rs >= 60) structure.push({ s: rs, e: re, kind: 'sleep', title: 'Rest after night shift' });
        }
        if (S.napMin > 0 && typeOf(addDays(d, -1)) !== 'night') {
          var napEnd = s - S.commuteMin - S.prepMin;
          structure.push({ s: napEnd - S.napMin, e: napEnd, kind: 'nap', title: 'Nap before night shift' });
        }
      }
    });
    // 1b. Fixed-time life areas (classes, a part-time job, rehearsals): blocked out every week like a shift.
    var roles = (state.roles || []).filter(function (r) { return r && r.active !== false && r.name && r.id; });
    var roleById = {};
    roles.forEach(function (r) { roleById[r.id] = r; });
    function isFixedRole(id) { return !!(id && roleById[id] && roleById[id].type === 'fixed'); }
    roles.filter(function (r) { return r.type === 'fixed' && hm(r.start) != null && hm(r.end) != null; }).forEach(function (r) {
      dates.forEach(function (d) {
        if ((r.days || []).indexOf(weekday(d)) < 0 || (r.skip || []).indexOf(d) >= 0 || !eligible(r, d)) return;
        var s = abs(d, hm(r.start)), e = abs(d, hm(r.end));
        if (e <= s) e += DAY;
        var c = Math.max(0, Math.round(Number(r.commuteMin) || 0));
        structure.push({ s: s, e: e, kind: 'commit', title: r.name, role: r.id, travel: c });
        if (c) {
          structure.push({ s: s - c, e: s, kind: 'commute', title: 'Travel to ' + r.name, role: r.id });
          structure.push({ s: e, e: e + c, kind: 'commute', title: 'Travel home', role: r.id });
        }
      });
    });
    var hard = structure.filter(function (b) { return b.kind === 'shift' || b.kind === 'commute' || b.kind === 'prep' || b.kind === 'commit'; });
    var wakeAt = {}; // date -> minute you get up (start of the day)
    dates.forEach(function (d) {
      if (typeOf(d) === 'night') return; // working through this night
      var nx = addDays(d, 1);
      var wake;
      if (typeOf(nx) === 'day') wake = abs(nx, hm(S.shifts.day.start)) - S.commuteMin - S.prepMin;
      else if (shiftsMode && typeOf(d) === 'day') wake = abs(nx, hm(S.wakeAfterDayShift));
      else wake = abs(nx, hm(S.wakeTime));
      structure.forEach(function (b) { // up in time for an early commitment
        if (b.kind === 'commit' && dateOfAbs(b.s) === nx) wake = Math.min(wake, b.s - (b.travel || 0) - S.prepMin);
      });
      var bt = hm(S.bedtime);
      var bed = abs(d, bt) + (bt < 12 * 60 ? DAY : 0);     // a 00:30 bedtime belongs to the next morning
      var s = Math.min(bed, wake - S.sleepMin), e = wake;
      hard.forEach(function (b) {
        if (b.s < e && b.e > s) { if (b.e <= wake) s = Math.max(s, b.e); else e = Math.min(e, b.s); }
      });
      if (e - s >= 60) { structure.push({ s: s, e: e, kind: 'sleep', title: 'Sleep' }); wakeAt[nx] = e; }
    });
    // merge overlapping sleep/nap blocks
    var sleeps = structure.filter(function (b) { return b.kind === 'sleep'; }).sort(function (a, b) { return a.s - b.s; });
    var merged = [];
    sleeps.forEach(function (b) {
      var last = merged[merged.length - 1];
      if (last && b.s <= last.e) { last.e = Math.max(last.e, b.e); if (b.title !== 'Sleep') last.title = b.title; }
      else merged.push(Object.assign({}, b));
    });
    structure = structure.filter(function (b) { return b.kind !== 'sleep'; }).concat(merged);

    // 1c. Today didn't go to plan: actual rest replaces the planned sleep it overlaps; busy time is blocked out.
    var extraBusy = [];
    dates.forEach(function (d) {
      var a = adj(d);
      if (!a) return;
      if (Array.isArray(a.rest)) {
        var rs0 = mins(a.rest[0]), re0 = mins(a.rest[1]);
        if (rs0 != null && re0 != null && re0 > rs0) {
          var ovS = abs(d, rs0), ovE = abs(d, re0);
          structure = structure.filter(function (b) {
            if ((b.kind !== 'sleep' && b.kind !== 'nap') || b.e <= ovS || b.s >= ovE) return true;
            if (b.s < ovS) { b.e = ovS; return b.e - b.s >= 10; }         // the part you did sleep before
            if (b.e > ovE + 180) { b.s = ovE; return true; }               // a long sleep still to come
            return false;
          });
          Object.keys(wakeAt).forEach(function (k) { if (wakeAt[k] >= ovS && wakeAt[k] <= ovE + 180) wakeAt[k] = ovE; });
          structure.push({ s: ovS, e: ovE, kind: 'sleep', title: 'Rest', adjusted: true });
          extraBusy.push({ s: ovS, e: ovE });
        }
      }
      (Array.isArray(a.busy) ? a.busy : []).slice(0, 10).forEach(function (x) {
        var bs0 = mins(x && x[0]), be0 = mins(x && x[1]);
        if (bs0 == null || be0 == null || be0 <= bs0) return;
        var bS = abs(d, bs0), bE = abs(d, be0);
        structure.push({ s: bS, e: bE, kind: 'busy', title: typeof x[2] === 'string' && x[2] ? x[2].slice(0, 60) : 'Busy', adjusted: true });
        extraBusy.push({ s: bS, e: bE });
      });
    });

    // 2. Free time per day (outside shifts) and quiet time inside shifts.
    var free = {}, work = {}, load = {}, roleWork = {};
    horizon.forEach(function (d) {
      var w = [{ s: abs(d, 0), e: abs(d, DAY) }];
      structure.forEach(function (b) { w = subtract(w, b.s, b.e); });
      var ww = [];
      structure.forEach(function (b) {
        if (b.kind === 'shift' && dateOfAbs(b.s) === d) ww.push({ s: b.s + (b.adjusted === 'start' ? 0 : S.handoverMin), e: b.e - S.shiftEndBufferMin }); // started early: ready to work straight away
      });
      var rw = {};
      structure.forEach(function (b) { if (b.kind === 'commit' && dateOfAbs(b.s) === d) (rw[b.role] = rw[b.role] || []).push({ s: b.s, e: b.e }); });
      extraBusy.forEach(function (x) {
        ww = subtract(ww, x.s, x.e);
        Object.keys(rw).forEach(function (k) { rw[k] = subtract(rw[k], x.s, x.e); });
      });
      if (nowAbs != null && d === today) {
        var cut = Math.ceil(nowAbs / 5) * 5;
        w = subtract(w, -Infinity, cut);
        ww = subtract(ww, -Infinity, cut);
        Object.keys(rw).forEach(function (k) { rw[k] = subtract(rw[k], -Infinity, cut); });
      }
      free[d] = w.filter(function (x) { return x.e - x.s >= 10; });
      work[d] = ww.filter(function (x) { return x.e - x.s >= 10; });
      roleWork[d] = rw;
      load[d] = 0;
    });

    // Done / skipped instances recorded in the log.
    var doneBlocks = [];
    Object.keys(log).forEach(function (key) {
      var L = log[key];
      if (!L || L.status !== 'done' || !isIso(L.date)) return;
      if (L.date < from || L.date > horizonEnd) return;
      var s = hm(L.start), e = hm(L.end);
      if (s == null || e == null) return;
      var as = abs(L.date, s), ae = abs(L.date, e);
      if (ae < as) ae += DAY; else if (ae === as) ae = as + 5;
      doneBlocks.push({ s: as, e: ae, kind: 'task', title: L.title || 'Task', key: key, taskId: L.taskId, done: true, during: L.when === 'during', role: L.role || '' });
      if (free[L.date]) {
        // finished work keeps its slot, so nothing new is planned on top of it
        free[L.date] = subtract(free[L.date], as, ae);
        work[L.date] = subtract(work[L.date], as, ae);
        Object.keys(roleWork[L.date] || {}).forEach(function (k) { roleWork[L.date][k] = subtract(roleWork[L.date][k], as, ae); });
        if (L.when !== 'during') load[L.date] += (ae - as);
      }
    });

    // 3. Expand tasks into instances.
    // Off days come in two kinds: a normal off day, and the first off day after a shift (recovery).
    function kindOf(d) { var t = typeOf(d); return t !== 'off' ? t : (!shiftsMode || typeOf(addDays(d, -1)) === 'off') ? 'off' : 'recovery'; }
    function capFor(d) { var k = kindOf(d); return k === 'off' ? S.capOffDay : k === 'recovery' ? S.capRecoveryDay : S.capShiftDay; }
    function eligible(task, d) {
      var t = typeOf(d), k = kindOf(d), al = task.allow || {};
      var rule = k === 'recovery' ? (al.recovery || al.off || 'yes') : (al[t] || 'yes');
      if (rule === 'no') return false;
      if (rule === 'weekend' && S.weekendDays.indexOf(weekday(d)) < 0) return false;
      if (task.when === 'during') {
        if (isFixedRole(task.role)) { if (!(roleWork[d] && roleWork[d][task.role] && roleWork[d][task.role].length)) return false; }
        else if (t === 'off') return false;
      }
      if (Array.isArray(task.weekdays) && task.weekdays.length && task.weekdays.indexOf(weekday(d)) < 0) return false;
      return true;
    }
    function byDistance(list, target) {
      return list.slice().sort(function (a, b) {
        var da = diffDays(target, a), db = diffDays(target, b);
        var ka = da >= 0 ? da : 1000 - da, kb = db >= 0 ? db : 1000 - db; // prefer on/after target
        return ka - kb;
      });
    }
    var instances = [], unplaced = [];
    function inst(task, key, candidates, extra) {
      return Object.assign({
        key: key, taskId: task.id, title: task.title, source: extra.source, order: extra.order || 0, role: task.role || '',
        duration: Math.max(5, Math.round(Number(task.durationMin) || 30)),
        when: task.when || 'outside',
        timeOfDay: task.timeOfDay || 'any',
        fixed: hm(task.fixedTime || ''),
        keepWhole: !!task.keepWhole,
        priority: Number(task.priority) || 2,
        candidates: candidates
      }, extra);
    }

    (state.recurring || []).forEach(function (r, order) {
      if (!r || r.active === false || !r.title) return;
      var times = Math.max(1, Math.min(14, Math.round(Number(r.times) || 1)));
      var per = r.per === 'week' || r.per === 'month' ? r.per : 'day';
      if (per === 'day') {
        horizon.forEach(function (d) {
          if (!eligible(r, d)) return;
          for (var k = 0; k < times; k++) {
            var key = r.id + '@D' + d + '#' + k;
            if (log[key]) continue;
            var tod = times > 1 && (r.timeOfDay || 'any') === 'any' ? ['morning', 'afternoon', 'evening'][k % 3] : r.timeOfDay;
            instances.push(inst(r, key, [d], { source: 'recurring', period: d, periodEnd: d, timeOfDay: tod || 'any', order: order }));
          }
        });
      } else if (per === 'week') {
        var weeks = [];
        horizon.forEach(function (d) { var ws = weekStart(d, S.weekStartsOn); if (weeks.indexOf(ws) < 0) weeks.push(ws); });
        weeks.forEach(function (ws) {
          var usable = [];
          for (var j = 0; j < 7; j++) { var d = addDays(ws, j); if (horizon.indexOf(d) >= 0 && eligible(r, d)) usable.push(d); }
          var remaining = [];
          for (var k = 0; k < times; k++) { var key = r.id + '@W' + ws + '#' + k; if (!log[key]) remaining.push(key); }
          if (!remaining.length) return;
          if (!usable.length) {
            remaining.forEach(function (key) {
              unplaced.push({ key: key, taskId: r.id, title: r.title, reason: (r.when === 'during' ? 'No shifts' : 'No allowed days') + ' left in ' + (ws <= today ? 'this' : 'next') + ' week.' });
            });
            return;
          }
          var m = usable.length, kk = remaining.length;
          remaining.forEach(function (key, i2) {
            var target = usable[Math.min(m - 1, Math.floor((i2 + 0.5) * m / kk))];
            instances.push(inst(r, key, byDistance(usable, target), { source: 'recurring', period: ws, periodEnd: addDays(ws, 6), order: order }));
          });
        });
      } else {
        var months = [];
        horizon.forEach(function (d) { var mk = monthKey(d); if (months.indexOf(mk) < 0) months.push(mk); });
        months.forEach(function (mk) {
          var all = monthDates(mk + '-01').filter(function (d) { return eligible(r, d); });
          if (!all.length) return;
          var usable = horizon.filter(function (d) { return monthKey(d) === mk && eligible(r, d); });
          for (var k = 0; k < times; k++) {
            var key = r.id + '@M' + mk + '#' + k;
            if (log[key]) continue;
            var target = all[Math.min(all.length - 1, Math.floor((k + 0.5) * all.length / times))];
            if (target > horizonEnd) continue; // later this month
            if (target < from) target = from;   // overdue: as soon as possible
            if (!usable.length) { unplaced.push({ key: key, taskId: r.id, title: r.title, reason: 'No allowed days left this month.' }); continue; }
            instances.push(inst(r, key, byDistance(usable, target), { source: 'recurring', period: mk, periodEnd: monthDates(mk + '-01').slice(-1)[0] }));
          }
        });
      }
    });

    (state.oneoffs || []).forEach(function (o) {
      if (!o || !o.title) return;
      var key = 'o:' + o.id;
      if (o.done || log[key]) return;
      var cands, overdue = false;
      var after = isIso(o.after) ? o.after : null;
      var hardDue = isIso(o.deadline) ? o.deadline : null; // project deadline: a step may slip to here, never past
      if (isIso(o.date)) {
        if (o.date > horizonEnd) return;          // planned for later
        if (o.date >= from) cands = eligible(o, o.date) ? [o.date] : [];
        else { overdue = true; cands = horizon.filter(function (d) { return eligible(o, d); }); }
      } else {
        if (after && after > horizonEnd) return;  // this step's window starts later
        var due = isIso(o.due) ? o.due : null;
        var limit = hardDue || due;
        if (limit && limit < from) { overdue = true; limit = null; after = null; }
        cands = horizon.filter(function (d) { return eligible(o, d) && (!after || d >= after) && (!limit || d <= limit); });
        if (due && hardDue && due < hardDue) {
          // within its own window first, then later days up to the project deadline
          cands = cands.filter(function (d) { return d <= due; }).concat(cands.filter(function (d) { return d > due; }));
        }
      }
      if (!cands.length) { unplaced.push({ key: key, taskId: o.id, title: o.title, reason: isIso(o.date) ? 'Not allowed on ' + o.date + ' (check shift rules).' : 'No allowed day before it is due.' }); return; }
      instances.push(inst(o, key, cands, { source: 'oneoff', overdue: overdue, project: o.project || '', periodEnd: isIso(o.due) ? o.due : (isIso(o.date) ? o.date : horizonEnd) }));
    });

    // 4. Place instances: fixed times first, then priority, deadline, fewest options, longest.
    instances.sort(function (a, b) {
      return ((a.fixed != null ? 0 : 1) - (b.fixed != null ? 0 : 1)) ||
        (a.priority - b.priority) ||
        (a.overdue === b.overdue ? 0 : a.overdue ? -1 : 1) ||
        (a.periodEnd < b.periodEnd ? -1 : a.periodEnd > b.periodEnd ? 1 : 0) ||
        (a.candidates.length - b.candidates.length) ||
        (b.duration - a.duration);
    });

    function chunksFor(it) {
      if (it.keepWhole || it.duration <= S.focusMin) return [it.duration];
      var out = [], left = it.duration;
      while (left > 0) { out.push(Math.min(S.focusMin, left)); left -= S.focusMin; }
      if (out.length > 1 && out[out.length - 1] < 10) { var r = out.pop(); out[out.length - 1] += r; }
      return out;
    }
    function trySequence(windows, chunks, minStart, maxFirstStart) {
      var w = windows.map(function (x) { return { s: x.s, e: x.e }; });
      var pos = minStart, placed = [];
      for (var c = 0; c < chunks.length; c++) {
        var L = chunks[c], found = null;
        for (var q = 0; q < w.length; q++) { var st = Math.max(w[q].s, pos); if (w[q].e - st >= L) { found = st; break; } }
        if (found == null) return null;
        if (c === 0 && maxFirstStart != null && found > maxFirstStart) return null;
        var end = found + L;
        var bEnd = S.breakMin > 0 ? Math.min(end + S.breakMin, endOfWindowAt(w, end)) : end;
        placed.push({ s: found, e: end, bs: end, be: bEnd });
        w = subtract(w, found, bEnd);
        pos = bEnd;
      }
      return { placed: placed, windows: w };
    }

    var taskBlocks = [];

    // Morning routine: tasks set to "first thing after waking" run back to back from your wake time.
    var routineEnd = {};
    instances.filter(function (it) { return it.timeOfDay === 'wake' && it.fixed == null; })
      .sort(function (a, b) { return a.order - b.order; })
      .forEach(function (it) {
        for (var ci = 0; ci < it.candidates.length; ci++) {
          var d = it.candidates[ci];
          if (!free[d] || wakeAt[d] == null) continue;
          var cap = capFor(d);
          if (load[d] + it.duration > cap) continue;
          var st = routineEnd[d] != null ? routineEnd[d] : wakeAt[d];
          if (nowAbs != null && st < nowAbs) st = Math.ceil(nowAbs / 5) * 5; // opened late: the rest of the routine starts now, still in order
          var fit = null;
          for (var q = 0; q < free[d].length && fit == null; q++) { var fs0 = Math.max(free[d][q].s, st); if (free[d][q].e - fs0 >= it.duration) fit = fs0; }
          if (fit == null || fit - st > 180) continue; // keep the routine together, not hours later
          st = fit;
          free[d] = subtract(free[d], st, st + it.duration);
          load[d] += it.duration;
          routineEnd[d] = st + it.duration;
          taskBlocks.push({ s: st, e: st + it.duration, kind: 'task', title: it.title, key: it.key, taskId: it.taskId, source: it.source, part: '', during: false, routine: true, conflict: false, overdue: false });
          it.placed = true;
          return;
        }
        it.timeOfDay = 'morning'; // no wake slot (e.g. shift day): plan it like any morning task
      });
    Object.keys(routineEnd).forEach(function (d) {
      var e = routineEnd[d], be = Math.min(e + S.breakMin, endOfWindowAt(free[d], e));
      if (be > e) { free[d] = subtract(free[d], e, be); taskBlocks.push({ s: e, e: be, kind: 'break', title: 'Break' }); }
    });

    function getPool(d, pool) { return pool === 'out' ? free[d] : pool === 'work' ? work[d] : ((roleWork[d] || {})[pool.slice(2)] || []); }
    function setPool(d, pool, w) {
      if (pool === 'out') free[d] = w; else if (pool === 'work') work[d] = w;
      else { roleWork[d] = roleWork[d] || {}; roleWork[d][pool.slice(2)] = w; }
    }
    instances.forEach(placeInstance);
    function placeInstance(it) {
      if (it.placed) return;
      var reason = 'No free time on the allowed days.';
      var clash = null;
      for (var ci = 0; ci < it.candidates.length; ci++) {
        var d = it.candidates[ci];
        if (!free[d]) continue;
        var inside = isFixedRole(it.role) ? 'r:' + it.role : 'work';
        var pools = it.when === 'during' ? [inside] : it.when === 'either' ? ['out', inside] : ['out'];
        for (var pi = 0; pi < pools.length; pi++) {
          var pool = pools[pi];
          var windows = getPool(d, pool);
          var cap = capFor(d);
          if (pool === 'out' && load[d] + it.duration > cap) { reason = 'Daily limit for personal tasks reached on the allowed days.'; continue; }

          if (it.fixed != null) {
            var fs = abs(d, it.fixed), fe = fs + it.duration;
            if (nowAbs != null && fs < nowAbs) { reason = 'Its fixed time has already passed today.'; continue; }
            if (contained(windows, fs, fe)) {
              commit(it, d, pool, [{ s: fs, e: fe, bs: fe, be: fe }], subtract(windows, fs, fe), false);
              return;
            }
            reason = 'The fixed time clashes with sleep, travel or a shift.';
            if (!clash) clash = { d: d, pool: pool, fs: fs, fe: fe };
            continue;
          }

          var chunks = chunksFor(it);
          var res = null;
          var pref = TIME_OF_DAY[it.timeOfDay];
          if (pref) {
            var ps = abs(d, pref[0]), pe = abs(d, pref[1]);
            res = trySequence(windows, chunks, ps, pe - chunks[0]);
          }
          if (!res) res = trySequence(windows, chunks, -Infinity, null);
          if (res) { commit(it, d, pool, res.placed, res.windows, false); return; }
          reason = 'Not enough free time on the allowed days.';
        }
      }
      if (clash) {
        // The user chose this exact time, so keep it and flag the clash.
        var cw = getPool(clash.d, clash.pool);
        commit(it, clash.d, clash.pool, [{ s: clash.fs, e: clash.fe, bs: clash.fe, be: clash.fe }], subtract(cw, clash.fs, clash.fe), true);
        return;
      }
      unplaced.push({ key: it.key, taskId: it.taskId, title: it.title, reason: reason });
    }

    // Flexible areas ("about 6 hours a week"): top up whatever the area's own tasks don't already cover.
    var weeksH = [];
    horizon.forEach(function (d) { var ws = weekStart(d, S.weekStartsOn); if (weeksH.indexOf(ws) < 0) weeksH.push(ws); });
    roles.filter(function (r) { return r.type === 'flexible' && Number(r.weeklyHours) > 0; }).forEach(function (r, order) {
      weeksH.forEach(function (ws) {
        var we = addDays(ws, 6), a0 = abs(ws, 0), a1 = abs(we, DAY), have = 0;
        taskBlocks.concat(doneBlocks).forEach(function (b) { if (b.kind === 'task' && b.role === r.id && b.s >= a0 && b.s < a1) have += b.e - b.s; });
        Object.keys(log).forEach(function (k) {
          var L = log[k];
          if (L && L.status === 'done' && L.role === r.id && L.date >= ws && L.date < from) { var s1 = hm(L.start), e1 = hm(L.end); if (s1 != null && e1 != null) have += Math.max(5, e1 - s1); }
        });
        var left = Math.round(Number(r.weeklyHours) * 60) - have;
        if (left < 15) return;
        var session = Math.max(30, Math.min(Number(r.session) || 90, S.maxSession));
        var usable = [];
        for (var j = 0; j < 7; j++) { var d = addDays(ws, j); if (horizon.indexOf(d) >= 0 && eligible(r, d)) usable.push(d); }
        var n = Math.ceil(left / session), k = 0;
        for (var i = 0; i < n; i++) {
          var dur = Math.min(session, left - i * session);
          if (dur < 15) break;
          var key; do { key = 'role:' + r.id + '@W' + ws + '#' + (k++); } while (log[key]);
          if (!usable.length) { unplaced.push({ key: key, taskId: 'role:' + r.id, title: r.name + ' time', reason: 'No allowed days left this week.' }); continue; }
          var target = usable[Math.min(usable.length - 1, Math.floor((i + 0.5) * usable.length / n))];
          placeInstance(inst({ id: 'role:' + r.id, title: r.name + ' time', durationMin: dur, when: 'outside', role: r.id, priority: 3, timeOfDay: r.timeOfDay || 'any' },
            key, byDistance(usable, target), { source: 'area', period: ws, periodEnd: we, order: order }));
        }
      });
    });

    function commit(it, d, pool, placed, windows, conflict) {
      setPool(d, pool, windows);
      if (pool === 'out') load[d] += it.duration;
      placed.forEach(function (p, n) {
        taskBlocks.push({
          s: p.s, e: p.e, kind: 'task', title: it.title, key: it.key, taskId: it.taskId, source: it.source,
          part: placed.length > 1 ? (n + 1) + '/' + placed.length : '', during: pool !== 'out', project: it.project || '', role: it.role || '',
          conflict: conflict, overdue: !!it.overdue
        });
        if (p.be > p.bs) taskBlocks.push({ s: p.bs, e: p.be, kind: 'break', title: 'Break' });
      });
    }

    // 5. Output.
    var all = structure.concat(taskBlocks, doneBlocks).filter(function (b) {
      return b.e > abs(from, 0) && b.s < abs(horizonEnd, DAY);
    }).sort(function (a, b) { return a.s - b.s || (a.kind === 'shift' ? -1 : 1); });
    all.forEach(function (b) {
      b.date = dateOfAbs(b.s);
      b.startTime = fmt(b.s % DAY);
      b.endDate = dateOfAbs(b.e === b.s ? b.e : b.e - 1);
      b.endTime = fmt(b.e % DAY);
      b.minutes = b.e - b.s;
      b.id = b.kind + ':' + (b.key || b.title) + ':' + b.date + 'T' + b.startTime;
    });

    var days = horizon.map(function (d) {
      var focus = 0;
      all.forEach(function (b) { if (b.kind === 'task' && b.date === d) focus += b.minutes; });
      return { date: d, type: typeOf(d), kind: kindOf(d), weekday: weekday(d), taskMinutes: focus, wake: wakeAt[d] != null ? fmt(wakeAt[d] % DAY) : '' };
    });

    return {
      from: from, to: horizonEnd, base: base, days: days, blocks: all, unplaced: unplaced,
      settings: S
    };
  }

  // Minutes from the plan base for a local date + minute (used by the alarm loop).
  function absFor(plan, date, minute) { return diffDays(plan.base, date) * DAY + minute; }

  var API = {
    DAY: DAY, DEFAULT_SETTINGS: DEFAULT_SETTINGS, TIME_OF_DAY: TIME_OF_DAY,
    hm: hm, fmt: fmt, addDays: addDays, weekday: weekday, diffDays: diffDays, weekStart: weekStart,
    monthDates: monthDates, isIso: isIso, withDefaults: withDefaults, horizonFor: horizonFor,
    buildPlan: buildPlan, absFor: absFor, subtract: subtract
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else { root.SR = root.SR || {}; root.SR.scheduler = API; }
})(this);
