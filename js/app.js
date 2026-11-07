/*
 * ShiftRhythm UI. Plain JavaScript, no frameworks, no network.
 * All user text is rendered with textContent, never innerHTML.
 */
(function (root) {
  'use strict';
  var Sch = root.SR.scheduler, St = root.SR.store, Al = root.SR.alarm, Ics = root.SR.ics, Rw = root.SR.rewards;
  var doc = root.document;

  var state = St.load();
  var plan = null, planDay = null;
  var ui = { calMonth: null, pattern: [], patternStart: null, patternWeeks: 8, wizardStep: 0, alarm: null, toastTimer: null };

  // ---------- helpers ----------
  function h(tag, attrs) {
    var el = doc.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = !!v;
      else if (k === 'value') el.value = v;
      else el.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { append(el, x); }); return; }
    el.appendChild(c.nodeType ? c : doc.createTextNode(String(c)));
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function todayIso() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function nowMin() { var d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
  function nowAbsPrecise() { var d = new Date(); return Sch.absFor(plan, todayIso(), d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60); }
  function dayLabel(iso, opts) {
    var p = iso.split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString(undefined, opts || { weekday: 'short', day: 'numeric', month: 'short' });
  }
  function dur(m) { m = Math.round(m); if (m < 60) return m + ' min'; var hh = Math.floor(m / 60), mm = m % 60; return hh + ' h' + (mm ? ' ' + mm + ' min' : ''); }
  var SHIFT_LABEL = { day: 'Day shift', night: 'Night shift', off: 'Off day' };
  function mode() { return state.settings.mode || 'shifts'; }
  function shiftsMode() { return mode() === 'shifts'; }
  function workLabel() { return state.settings.workLabel || 'Work'; }
  function workWord() { return shiftsMode() ? 'shift' : workLabel().toLowerCase(); }   // "during my shift" / "during work" / "during school"
  function dayTypeLabel(type, kind) {
    if (shiftsMode()) return kind === 'recovery' ? 'Off day after a shift' : SHIFT_LABEL[type];
    if (type === 'day' || type === 'night') return workLabel() + ' day';
    return mode() === 'regular' ? 'Day off' : 'Free day';
  }
  function shortType(type, kind) {
    if (shiftsMode()) return kind === 'recovery' ? 'Off \u00b7 after shift' : SHORT[type];
    return type === 'off' ? (mode() === 'regular' ? 'Off' : 'Free') : workLabel();
  }
  var SHORT = { day: 'Day', night: 'Night', off: 'Off' };
  function save() {
    state.updatedAt = Date.now();
    if (!St.save(state)) { toast('Could not save. Your browser storage may be full or blocked.'); return; }
    if (root.SR.sync) root.SR.sync.changed();
  }
  function toast(msg) {
    var t = doc.getElementById('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(ui.toastTimer);
    ui.toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
  }
  function download(name, text, type) {
    var blob = new Blob([text], { type: type || 'application/octet-stream' });
    var a = h('a', { href: URL.createObjectURL(blob), download: name });
    doc.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  // ---------- look and feel ----------
  var PALETTE = ['--c1', '--c2', '--c3', '--c4', '--c5', '--c6', '--c7', '--c8'];
  function colorVar(id) {
    var str = String(id || ''), x = 0;
    for (var i = 0; i < str.length; i++) x = (x * 31 + str.charCodeAt(i)) >>> 0;
    return 'var(' + PALETTE[x % PALETTE.length] + ')';
  }
  function taskColor(b) { return (b.role && root.SR.areas.areaColor(b.role)) || colorVar(b.project || b.taskId || b.key || b.title); }
  function tint(el, c) { el.style.setProperty('--c', c); return el; }
  var themeSetByApp = false;
  function applyTheme() {
    var t = state.settings.theme || 'auto', el = doc.documentElement;
    if (t === 'auto') { if (themeSetByApp) { el.removeAttribute('data-theme'); themeSetByApp = false; } }
    else { el.setAttribute('data-theme', t); themeSetByApp = true; }
    var btn = doc.getElementById('themeBtn');
    if (btn) {
      btn.replaceChildren(icon(t === 'dark' ? 'moon' : t === 'light' ? 'sun' : 'auto'));
      btn.setAttribute('aria-label', 'Theme: ' + (t === 'auto' ? 'automatic' : t) + '. Tap to change.');
      btn.title = 'Theme: ' + (t === 'auto' ? 'Auto' : t === 'dark' ? 'Dark' : 'Light');
    }
  }
  function cycleTheme() {
    var order = ['auto', 'light', 'dark'], cur = state.settings.theme || 'auto';
    var nx = order[(order.indexOf(cur) + 1) % 3];
    state.settings.theme = nx; save(); applyTheme();
    toast(nx === 'auto' ? 'Theme follows your device' : nx === 'dark' ? 'Dark mode' : 'Light mode');
  }
  var ICONS = {
    sun: 'M12 4V2M12 22v-2M4.9 4.9 3.5 3.5M20.5 20.5l-1.4-1.4M4 12H2M22 12h-2M4.9 19.1l-1.4 1.4M20.5 3.5l-1.4 1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
    moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z',
    auto: 'M12 3a9 9 0 1 0 0 18V3ZM12 3a9 9 0 0 1 0 18'
  };
  function icon(name) {
    var ns = 'http://www.w3.org/2000/svg', svg = doc.createElementNS(ns, 'svg'), path = doc.createElementNS(ns, 'path');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round'); svg.setAttribute('aria-hidden', 'true');
    path.setAttribute('d', ICONS[name]); if (name === 'auto') path.setAttribute('fill', 'currentColor');
    svg.appendChild(path); return svg;
  }
  function progressRing(done, total) {
    var ns = 'http://www.w3.org/2000/svg', svg = doc.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100'); svg.setAttribute('aria-hidden', 'true');
    var r = 42, c = 2 * Math.PI * r, frac = total ? done / total : 0;
    [['rgba(255,255,255,.25)', 1], ['#FFFFFF', frac]].forEach(function (x) {
      var ci = doc.createElementNS(ns, 'circle');
      ci.setAttribute('cx', '50'); ci.setAttribute('cy', '50'); ci.setAttribute('r', String(r)); ci.setAttribute('fill', 'none');
      ci.setAttribute('stroke', x[0]); ci.setAttribute('stroke-width', '10'); ci.setAttribute('stroke-linecap', 'round');
      ci.setAttribute('stroke-dasharray', (c * x[1]).toFixed(1) + ' ' + c.toFixed(1));
      svg.appendChild(ci);
    });
    return h('div', { class: 'ring', role: 'img', 'aria-label': done + ' of ' + total + ' tasks done today' }, svg,
      h('div', { class: 'num' }, done + '/' + total, h('small', {}, 'DONE')));
  }
  function confetti() {
    if (root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var cv = h('canvas', { class: 'confetti', 'aria-hidden': 'true' });
    doc.body.appendChild(cv);
    var W = cv.width = root.innerWidth, H = cv.height = root.innerHeight, g = cv.getContext('2d');
    var cs = getComputedStyle(doc.documentElement), cols = PALETTE.map(function (v) { return cs.getPropertyValue(v).trim() || '#6D4AFF'; });
    var ps = [];
    for (var i = 0; i < 90; i++) ps.push({ x: W / 2 + (Math.random() - .5) * 80, y: H * 0.45, vx: (Math.random() - .5) * 13, vy: -Math.random() * 13 - 4, r: Math.random() * 6 + 4, a: Math.random() * 6, va: (Math.random() - .5) * .4, c: cols[i % cols.length] });
    var t0 = performance.now();
    (function frame(t) {
      var k = (t - t0) / 1000; g.clearRect(0, 0, W, H);
      ps.forEach(function (p) { p.vy += 0.42; p.x += p.vx; p.y += p.vy; p.a += p.va; g.save(); g.translate(p.x, p.y); g.rotate(p.a); g.globalAlpha = Math.max(0, 1 - k / 1.6); g.fillStyle = p.c; g.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2); g.restore(); });
      if (k < 1.6) requestAnimationFrame(frame); else cv.remove();
    })(t0);
  }
  var CHEERS = ['Nice work!', 'Done and dusted.', 'One less thing. Well done!', 'You\u2019re on a roll!', 'Look at you go!', 'Ticked off. Breathe.', 'That\u2019s progress.'];

  // ---------- planning ----------
  var pendingEvents = [];
  function replan() {
    var t = todayIso();
    St.prune(state, t);
    plan = Sch.buildPlan(state, { today: t, nowMin: nowMin() });
    planDay = t;
    if (state.setupDone) {
      var before = state.rewards ? state.rewards.through : null;
      var ev = Rw.evaluate(state, t);
      Rw.snapshot(state, plan, t);
      if (ev.length || (state.rewards && state.rewards.through !== before)) { pendingEvents = pendingEvents.concat(ev); save(); }
      else St.save(state);
    }
  }
  function flushEvents() {
    var ev = pendingEvents; pendingEvents = [];
    var frozen = ev.filter(function (e) { return e.type === 'frozen'; }), missed = ev.filter(function (e) { return e.type === 'missed'; });
    var msgs = [];
    if (frozen.length) msgs.push('\u2744\ufe0f ' + (frozen.length === 1 ? dayLabel(frozen[0].date) + ' was' : frozen.length + ' days were') + ' frozen with your coins. Your streak is safe.');
    if (missed.length) msgs.push(missed.length === 1 ? 'Your streak reset on ' + dayLabel(missed[0].date) + '. Today is a fresh start.' : 'Your streak reset after ' + missed.length + ' quiet days. Today is a fresh start.');
    ev.forEach(function (e) { if (e.type === 'milestone') msgs.push('\ud83d\udd25 ' + e.streak + ' days in a row! +' + e.coins + ' bonus coins.'); });
    msgs.forEach(function (m, i) { setTimeout(function () { toast(m); }, 300 + i * 2800); });
    if (ev.some(function (e) { return e.type === 'milestone'; })) setTimeout(confetti, 300);
  }
  function change(mutator, msg) {
    mutator();
    save();
    replan();
    render();
    if (msg) toast(msg);
  }
  function blocksOverlapping(date) {
    var s = Sch.absFor(plan, date, 0), e = s + Sch.DAY;
    return plan.blocks.filter(function (b) { return b.e > s && b.s < e; });
  }
  function instanceBlocks(key) { return plan.blocks.filter(function (b) { return b.key === key && !b.done; }); }

  function markDone(key) {
    var beforeR = Rw.status(state, plan, todayIso());
    var parts = instanceBlocks(key);
    var first = parts[0], last = parts[parts.length - 1];
    var oneoff = key.slice(0, 2) === 'o:' ? state.oneoffs.filter(function (o) { return 'o:' + o.id === key; })[0] : null;
    var title = first ? first.title : oneoff ? oneoff.title : 'Task';
    var taskId = first ? first.taskId : oneoff ? oneoff.id : '';
    var nm = nowMin(), minutes = first ? last.e - first.s : (oneoff ? oneoff.durationMin : 15);
    var date = todayIso(), start, end;
    if (first && first.s <= nowAbsPrecise()) { date = first.date; start = first.startTime; end = last.endTime; }
    else { start = Sch.fmt(Math.max(0, nm - minutes)); end = Sch.fmt(Math.max(nm, 5)); } // finished early: log it as just done
    change(function () {
      state.log[key] = {
        status: 'done', at: Date.now(), title: title, taskId: taskId, when: first && first.during ? 'during' : 'outside', role: first ? first.role || '' : (oneoff ? oneoff.role || '' : ''),
        date: date, start: start, end: end
      };
      if (key.slice(0, 2) === 'o:') state.oneoffs.forEach(function (o) { if ('o:' + o.id === key) o.done = true; });
    }, null);
    var after = Rw.status(state, plan, todayIso());
    if (!beforeR.todayCoins && after.todayCoins) { toast('\ud83e\ude99 Today\u2019s coin earned! Your streak is now ' + after.streak + '.'); confetti(); setTimeout(confetti, 450); }
    else if (beforeR.todayCoins === 1 && after.todayCoins === 2) { toast('\ud83c\udf1f Perfect day! Everything done. +2 coins.'); confetti(); setTimeout(confetti, 450); }
    else { toast(CHEERS[Math.floor(Math.random() * CHEERS.length)] + (after.today.need > 0 ? ' ' + after.today.need + ' more for today\u2019s coin.' : '')); confetti(); }
  }
  function undo(key) {
    change(function () {
      delete state.log[key];
      if (key.slice(0, 2) === 'o:') state.oneoffs.forEach(function (o) { if ('o:' + o.id === key) o.done = false; });
    }, 'Marked as not done.');
  }
  function skip(key) {
    change(function () {
      if (key.slice(0, 2) === 'o:') {
        state.oneoffs.forEach(function (o) { if ('o:' + o.id === key) { o.date = Sch.addDays(todayIso(), 1); } });
      } else {
        state.log[key] = { status: 'skipped', at: Date.now(), date: todayIso(), title: '', taskId: '' };
      }
    }, key.slice(0, 2) === 'o:' ? 'Moved to tomorrow.' : 'Skipped this time.');
  }

  // ---------- rendering ----------
  function route() { var r = (root.location.hash || '#today').slice(1); return ['today', 'week', 'tasks', 'shifts', 'settings'].indexOf(r) >= 0 ? r : 'today'; }

  function render() {
    applyTheme();
    var calLink = doc.querySelector('nav.tabs a[href="#shifts"]');
    if (calLink && calLink.lastChild && calLink.lastChild.nodeType === 3) calLink.lastChild.textContent = shiftsMode() ? 'Shifts' : 'Calendar';
    var main = doc.getElementById('main');
    main.replaceChildren();
    doc.querySelectorAll('nav.tabs a').forEach(function (a) { a.setAttribute('aria-current', a.getAttribute('href') === '#' + route() ? 'page' : 'false'); });
    var t = todayIso();
    var type = plan && plan.days[0] ? plan.days[0].type : ((state.shifts[t]) || 'off');
    var chip = doc.getElementById('todayChip');
    var kind = plan && plan.days[0] ? plan.days[0].kind : type;
    chip.className = 'chip ' + type; chip.textContent = 'Today: ' + dayTypeLabel(type, kind);

    if (!state.setupDone) { doc.getElementById('nav').hidden = true; main.append(renderWizard()); return; }
    doc.getElementById('nav').hidden = false;
    main.append(renderPrompts());
    var r = route();
    if (r === 'today') main.append(renderToday());
    if (r === 'week') main.append(renderWeek());
    if (r === 'tasks') main.append(renderTasks());
    if (r === 'shifts') main.append(renderShifts());
    if (r === 'settings') main.append(renderSettings());
  }

  function renderPrompts() {
    var box = h('div', { class: 'stack' });
    if (state.settings.sound && !Al.unlocked()) {
      box.append(h('div', { class: 'banner', 'data-banner': 'sound' }, h('span', { text: 'Tap once to let ShiftRhythm play its switch-task chime.' }),
        h('button', { class: 'btn small primary', type: 'button', onclick: function () { Al.unlock(); Al.play('heads', state.settings); render(); } }, 'Turn on sound')));
    }
    if (Al.permission() === 'default') {
      box.append(h('div', { class: 'banner' }, h('span', { text: 'Allow notifications so you get a pop-up when it is time to switch tasks.' }),
        h('button', { class: 'btn small primary', type: 'button', onclick: function () { Al.askPermission().then(render); } }, 'Allow notifications')));
    }
    return box;
  }

  function blockRow(b, opts) {
    opts = opts || {};
    var now = nowAbsPrecise();
    var cls = 'blk k-' + b.kind + (b.during ? ' during' : '') + (b.done ? ' done' : '') + (b.e <= now && !b.done ? ' past' : '') + (b.s <= now && now < b.e ? ' current' : '');
    var timeTxt = b.startTime + '–' + b.endTime + (b.endDate !== b.date && b.kind !== 'break' ? ' +1' : '');
    var sub = [];
    if (b.kind === 'task') {
      if (b.role) sub.push(root.SR.areas.areaName(b.role));
      sub.push(dur(b.minutes));
      if (b.part) sub.push('part ' + b.part);
      if (b.during) sub.push('during ' + workWord());
      if (b.done) sub.push('done');
    } else if (b.kind !== 'break') sub.push(dur(b.minutes));
    var badges = [];
    if (b.conflict) badges.push(h('span', { class: 'chip warn', text: 'Clashes' }));
    if (b.overdue) badges.push(h('span', { class: 'chip warn', text: 'Overdue' }));
    var acts = h('div', { class: 'acts' });
    if (b.kind === 'commit' && opts.actions && b.e > now) {
      acts.append(h('button', { class: 'btn small', type: 'button', onclick: function () {
        change(function () { var r = root.SR.areas.role(b.role); if (r && r.skip.indexOf(b.date) < 0) r.skip.push(b.date); }, b.title + ' skipped this time. Plan recalculated.');
      } }, 'Not this time'));
    }
    if (b.kind === 'task' && opts.actions) {
      if (b.done) acts.append(h('button', { class: 'btn small', type: 'button', onclick: function () { undo(b.key); } }, 'Undo'));
      else {
        acts.append(h('button', { class: 'btn small primary', type: 'button', onclick: function () { markDone(b.key); }, 'aria-label': 'Done: ' + b.title }, 'Done'));
        acts.append(h('button', { class: 'btn small', type: 'button', onclick: function () { skip(b.key); } }, b.source === 'oneoff' ? 'Tomorrow' : 'Skip'));
      }
    }
    var row = h('div', { class: cls },
      h('span', { class: 'time', text: timeTxt }),
      h('div', {}, h('div', { class: 'title' }, b.kind === 'task' ? h('span', { class: 'dot', 'aria-hidden': 'true' }) : null, b.kind === 'break' ? 'Break' : b.title, ' ', badges), sub.length ? h('div', { class: 'sub', text: sub.join(' · ') }) : null),
      acts);
    if (b.kind === 'task' || b.kind === 'commit') tint(row, taskColor(b));
    return row;
  }

  function renderToday() {
    var t = todayIso();
    var blocks = blocksOverlapping(t);
    var now = nowAbsPrecise();
    var cur = blocks.filter(function (b) { return b.s <= now && now < b.e && !b.done; }).sort(function (a, b) { return (a.kind === 'shift') - (b.kind === 'shift'); })[0];
    var next = plan.blocks.filter(function (b) { return b.s > now && !b.done && b.kind !== 'shift'; })[0];

    var nowCard = h('section', { class: 'card now', 'aria-labelledby': 'nowH' });
    nowCard.append(h('h3', { id: 'nowH', text: 'Right now' }));
    if (cur) {
      var pct = Math.min(100, Math.max(0, 100 * (now - cur.s) / (cur.e - cur.s)));
      var bar = h('i'); bar.style.width = pct.toFixed(1) + '%';
      nowCard.append(h('div', { class: 'big', text: cur.kind === 'break' ? 'Break time' : cur.title + (cur.part ? ' (' + cur.part + ')' : '') }),
        h('div', { class: 'bar' }, bar),
        h('div', { class: 'muted', text: cur.startTime + '–' + cur.endTime + ' · ' + dur(cur.e - now) + ' left' }));
    } else nowCard.append(h('div', { class: 'big', text: 'Free time' }));
    if (next) {
      nowCard.append(h('div', { class: 'row' }, h('span', { class: 'muted', text: 'Next:' }), h('strong', { text: next.kind === 'break' ? 'Break' : next.title }),
        h('span', { class: 'countdown', id: 'countdown', 'data-at': String(next.s) }, countdownText(next.s - now)), h('span', { class: 'muted small', text: 'at ' + next.startTime })));
    }

    var quick = root.SR.capture.renderCapture();
    var keys = {}, doneKeys = {};
    blocks.forEach(function (b) { if (b.kind === 'task' && b.date === t) { keys[b.key] = 1; if (b.done) doneKeys[b.key] = 1; } });
    var total = Object.keys(keys).length, doneCount = Object.keys(doneKeys).length;
    var day0 = plan.days[0] || {}, kind = day0.kind || 'off';
    var hr = new Date().getHours();
    var hello = (hr < 5 ? 'Still up' : hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening') + (state.settings.name ? ', ' + state.settings.name : '');
    var shiftB = blocks.filter(function (b) { return b.kind === 'shift' && b.date === t; })[0];
    var mood = kind === 'night' ? 'Night shift tonight. Rest first.' : kind === 'recovery' ? 'Recovery day. Go gently.'
      : kind === 'day' ? (shiftsMode() ? 'Day shift. You\u2019ve got this.' : workLabel() + ' day. One step at a time.')
      : total ? (mode() === 'free' ? 'Your day, your plan.' : 'A free day, made for your own things.') : 'A free day. Enjoy it.';
    var pills = [h('span', { class: 'pill', text: dayTypeLabel(day0.type || 'off', kind) })];
    if (shiftB) pills.push(h('span', { class: 'pill', text: shiftB.startTime + '–' + shiftB.endTime }));
    if (day0.wake) pills.push(h('span', { class: 'pill', text: 'Up at ' + day0.wake }));
    var rs = Rw.status(state, plan, t);
    pills.push(h('span', { class: 'pill', text: '\ud83d\udd25 ' + rs.streak + '-day streak' }));
    pills.push(h('span', { class: 'pill', text: '\ud83e\ude99 ' + rs.coinsWithToday + ' coin' + (rs.coinsWithToday === 1 ? '' : 's') }));
    var hero = h('section', { class: 'hero ' + kind, 'aria-label': 'Today' },
      h('div', { class: 'orb', 'aria-hidden': 'true' }), h('div', { class: 'stars', 'aria-hidden': 'true' }),
      h('div', {}, h('div', { class: 'sub', text: dayLabel(t, { weekday: 'long', day: 'numeric', month: 'long' }) }), h('div', { class: 'hello', text: hello }), h('div', { class: 'sub', text: mood })),
      progressRing(doneCount, total),
      h('div', { class: 'pills' }, pills));

    var list = h('div', { class: 'timeline' });
    if (!blocks.length) list.append(h('div', { class: 'empty', text: 'Nothing planned today.' }));
    blocks.forEach(function (b) { list.append(blockRow(b, { actions: true })); });
    var todayTasks = blocks.filter(function (b) { return b.kind === 'task'; });
    var doneN = todayTasks.filter(function (b) { return b.done; }).length;

    var timeline = h('section', { class: 'card', 'aria-labelledby': 'todayH' },
      h('div', { class: 'spread' }, h('h2', { id: 'todayH', text: dayLabel(t, { weekday: 'long', day: 'numeric', month: 'long' }) }),
        h('span', { class: 'muted small', text: doneN + ' of ' + todayTasks.length + ' task blocks done' })),
      list);

    var side = h('div', { class: 'stack' }, nowCard, renderDrift(), renderStreakCard(rs), root.SR.capture.renderBriefing(), renderUnplaced());
    return h('div', { class: 'stack' }, hero, quick, h('div', { class: 'grid2' }, timeline, side));
  }
  // ---------- the day drifted: say what actually happened, the rest of the day is replanned ----------
  function round5(m) { return Math.ceil(m / 5) * 5; }
  function adjFor(d) { state.adjust = state.adjust || {}; return state.adjust[d] || (state.adjust[d] = {}); }
  function untilMin(v) { var m = Sch.hm(v), nm = nowMin(); if (m == null) return null; if (m < nm - 30) m += Sch.DAY; return m > nm ? m : null; }
  function renderDrift() {
    var t = todayIso(), nm = nowMin(), now = nowAbsPrecise();
    // Default rest length: what was planned for the sleep you're late for, otherwise 90 minutes.
    var planned = plan.blocks.filter(function (b) { return (b.kind === 'sleep' || b.kind === 'nap') && !b.adjusted && b.e > now && b.s < now + 180; })[0];
    var restLen = planned ? Math.min(9 * 60, planned.e - planned.s) : 90;
    var restIn = h('input', { type: 'time', id: 'drRest', value: Sch.fmt(round5(nm + restLen) % Sch.DAY), 'aria-label': 'Resting until' });
    var busyIn = h('input', { type: 'time', id: 'drBusy', value: Sch.fmt(round5(nm + 60) % Sch.DAY), 'aria-label': 'Busy until' });
    function setRest() {
      var e = untilMin(restIn.value); if (e == null) { toast('Pick a time later than now.'); return; }
      change(function () { adjFor(t).rest = [nm, e]; }, 'Rest until ' + restIn.value + '. The rest of your day is replanned around it.');
    }
    function setBusy() {
      var e = untilMin(busyIn.value); if (e == null) { toast('Pick a time later than now.'); return; }
      change(function () { var a = adjFor(t); a.busy = (a.busy || []).concat([[nm, e, 'Busy']]).slice(-10); }, 'Busy until ' + busyIn.value + '. Everything after moves along.');
    }
    var rows = [
      h('div', { class: 'drow' }, h('span', { class: 'dlbl', text: '\ud83d\ude34 Resting now, until' }), restIn, h('button', { class: 'btn small primary', type: 'button', onclick: setRest }, 'Set')),
      h('div', { class: 'drow' }, h('span', { class: 'dlbl', text: '\u23f3 Busy or running late, until' }), busyIn, h('button', { class: 'btn small primary', type: 'button', onclick: setBusy }, 'Set'))
    ];
    // Work: started early, or finished at a different time.
    var shift = plan.blocks.filter(function (b) { return b.kind === 'shift' && b.e + 180 > now && b.s - 180 < now; })[0];
    if (shift && mode() !== 'free') {
      var rel = now - Sch.absFor(plan, shift.date, 0); // now, counted from the shift's own date
      if (now < shift.s) {
        rows.push(h('div', { class: 'drow' }, h('span', { class: 'dlbl', text: '\ud83d\udcbc Already at ' + (shiftsMode() ? 'work' : workLabel()) + '?' }),
          h('button', { class: 'btn small primary', type: 'button', onclick: function () {
            change(function () { var a = adjFor(shift.date); a.shift = Object.assign({}, a.shift, { start: round5(rel - 4) }); }, 'Started now. Work tasks can begin straight away.');
          } }, 'Start work now')));
      } else {
        var endIn = h('input', { type: 'time', id: 'drEnd', value: now < shift.e ? shift.endTime : Sch.fmt(round5(nm) % Sch.DAY), 'aria-label': 'Finished work at' });
        rows.push(h('div', { class: 'drow' }, h('span', { class: 'dlbl', text: '\ud83d\udcbc ' + (shiftsMode() ? 'Shift' : workLabel()) + ' ends or ended at' }), endIn,
          h('button', { class: 'btn small primary', type: 'button', onclick: function () {
            var m = Sch.hm(endIn.value); if (m == null) return;
            var d0 = Sch.absFor(plan, shift.date, 0), sMin = shift.s - d0, eMin = shift.e - d0;
            var em = [m, m + Sch.DAY].filter(function (x) { return x > sMin; }).sort(function (x, y) { return Math.abs(x - eMin) - Math.abs(y - eMin); })[0];
            if (em == null) { toast('That\u2019s before work started.'); return; }
            change(function () { var a = adjFor(shift.date); a.shift = Object.assign({}, a.shift, { end: em }); }, 'Work ends at ' + endIn.value + '. Travel and the rest of the day are moved.');
          } }, 'Set')));
      }
    }
    // What has been changed today, with undo.
    var notes = [];
    [Sch.addDays(t, -1), t].forEach(function (d) {
      var a = state.adjust && state.adjust[d]; if (!a) return;
      var off = Sch.diffDays(t, d) * Sch.DAY;
      function tm(m) { return Sch.fmt(((m + off) % Sch.DAY + Sch.DAY) % Sch.DAY); }
      if (a.rest) notes.push('Rest ' + tm(a.rest[0]) + '\u2013' + tm(a.rest[1]));
      (a.busy || []).forEach(function (x) { notes.push('Busy ' + tm(x[0]) + '\u2013' + tm(x[1])); });
      if (a.shift && a.shift.start != null) notes.push('Work from ' + tm(a.shift.start));
      if (a.shift && a.shift.end != null) notes.push('Work until ' + tm(a.shift.end));
    });
    var undoBtn = notes.length ? h('button', { class: 'btn small', type: 'button', onclick: function () {
      change(function () { [Sch.addDays(t, -1), t].forEach(function (d) { if (state.adjust) delete state.adjust[d]; }); }, 'Back to the original plan.');
    } }, 'Undo changes') : null;
    return h('section', { class: 'card drift', 'aria-labelledby': 'drH' },
      h('h3', { id: 'drH', text: 'Day not going to plan?' }),
      h('p', { class: 'small muted', text: 'Say what\u2019s actually happening and the rest of today is rearranged to fit the time left.' }),
      rows,
      notes.length ? h('p', { class: 'small', text: 'Today: ' + notes.join(' \u00b7 ') }) : null,
      h('div', { class: 'row' }, h('button', { class: 'btn small', type: 'button', onclick: function () { replan(); render(); toast('Plan recalculated from now.'); } }, '\u21bb Recalculate from now'), undoBtn));
  }

  var DOT = { win: ['Counted', '\u2713'], perfect: ['Perfect', '\u2605'], frozen: ['Frozen', '\u2744'], missed: ['Missed', '\u00d7'], rest: ['Rest day', '\u2013'], none: ['Not tracked', ''], today: ['Today', ''] };
  function renderStreakCard(rs) {
    var t = rs.today;
    var pct = t.planned ? Math.round(100 * t.done / t.planned) : 0;
    var bar = h('i'); bar.style.width = pct + '%';
    var mark = h('b', { class: 'mark', 'aria-hidden': 'true' }); mark.style.left = (t.planned ? Math.min(100, 100 * (Math.floor(t.planned / 2) + 1) / t.planned) : 50) + '%';
    var line = t.status === 'rest' ? 'Nothing planned today: a rest day. Your streak is safe.'
      : t.status === 'perfect' ? 'Everything done today. \ud83c\udf1f 2 coins earned.'
      : t.status === 'win' ? 'Today\u2019s coin is earned! Finish everything for a second one.'
      : t.need + ' more task' + (t.need === 1 ? '' : 's') + ' to earn today\u2019s coin (' + t.done + ' of ' + t.planned + ' done).';
    var dots = h('div', { class: 'dots', role: 'list', 'aria-label': 'Last two weeks' });
    rs.history.forEach(function (x) {
      dots.append(h('div', { class: 'dotday s-' + x.s, role: 'listitem', title: dayLabel(x.date) + ': ' + DOT[x.s][0], 'aria-label': dayLabel(x.date) + ': ' + DOT[x.s][0] },
        h('span', { class: 'sym', text: DOT[x.s][1] }), h('span', { class: 'lbl', text: dayLabel(x.date, { weekday: 'narrow' }) })));
    });
    return h('section', { class: 'card streak-card', 'aria-labelledby': 'stkH' },
      h('div', { class: 'spread' }, h('h3', { id: 'stkH', text: 'Your streak' }), h('span', { class: 'small muted', text: 'Best: ' + rs.best })),
      h('div', { class: 'stk-nums' },
        h('div', { class: 'stk' }, h('span', { class: 'emoji', 'aria-hidden': 'true', text: '\ud83d\udd25' }), h('b', { text: String(rs.streak) }), h('span', { class: 'small muted', text: 'days in a row' })),
        h('div', { class: 'stk' }, h('span', { class: 'emoji', 'aria-hidden': 'true', text: '\ud83e\ude99' }), h('b', { text: String(rs.coinsWithToday) }), h('span', { class: 'small muted', text: 'coins' })),
        h('div', { class: 'stk' }, h('span', { class: 'emoji', 'aria-hidden': 'true', text: '\u2744\ufe0f' }), h('b', { text: String(Math.floor(rs.coins / rs.freezeCost)) }), h('span', { class: 'small muted', text: 'freezes ready' }))),
      t.status !== 'rest' ? h('div', { class: 'goal' }, h('div', { class: 'bar' }, bar), mark) : null,
      h('p', { class: 'small', text: line }),
      dots,
      h('details', {}, h('summary', { class: 'small', text: 'How it works' }),
        h('ul', { class: 'small rules' },
          h('li', { text: 'Finish more than half of a day\u2019s tasks and the day counts: 1 coin, or 2 if you finish everything.' }),
          h('li', { text: 'Days with nothing planned are rest days. They don\u2019t break your streak.' }),
          h('li', { text: 'If a day doesn\u2019t count, ' + rs.freezeCost + ' coins freeze it automatically and your streak lives on.' + (rs.auto ? '' : ' (Turned off in Settings.)') }),
          h('li', { text: 'Bonus coins at 7, 14, 30, 60 and 100 days in a row.' }))));
  }
  function countdownText(min) {
    if (min < 0) min = 0;
    var s = Math.floor(min * 60), hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
    return 'in ' + (hh ? hh + ':' + pad(mm) : mm) + ':' + pad(ss);
  }

  function renderUnplaced() {
    if (!plan.unplaced.length) return null;
    var list = h('div', {});
    plan.unplaced.forEach(function (u) {
      list.append(h('div', { class: 'item' }, h('div', { class: 'body' }, h('span', { class: 'title', text: u.title }), h('span', { class: 'muted small', text: u.reason }))));
    });
    return h('section', { class: 'card', 'aria-labelledby': 'unH' },
      h('h3', { id: 'unH', text: 'Could not fit (' + plan.unplaced.length + ')' }),
      h('p', { class: 'small muted', text: 'Try shorter tasks, fewer repeats, more allowed days, or a higher daily limit in Settings.' }),
      list);
  }

  function renderWeek() {
    var grid = h('div', { class: 'week' });
    var t = todayIso();
    plan.days.forEach(function (d) {
      var card = h('section', { class: 'card dayc ' + d.kind + (d.date === t ? ' today' : '') }, h('div', { class: 'band', 'aria-hidden': 'true' }));
      card.append(h('div', { class: 'spread' }, h('strong', { text: dayLabel(d.date) }), h('span', { class: 'chip ' + d.type, text: shortType(d.type, d.kind) })));
      var items = plan.blocks.filter(function (b) { return b.date === d.date && b.kind !== 'break'; });
      if (!items.length) card.append(h('div', { class: 'empty', text: 'Nothing planned' }));
      items.forEach(function (b) {
        card.append(tint(h('div', { class: 'mini k-' + b.kind + (b.during ? ' during' : '') + (b.done ? ' done' : '') },
          h('span', { class: 't', text: b.startTime + '–' + b.endTime }),
          h('span', { text: b.title + (b.part ? ' (' + b.part + ')' : '') + (b.conflict ? ' ⚠' : '') })), b.kind === 'task' || b.kind === 'commit' ? taskColor(b) : 'var(--line)'));
      });
      card.append(h('div', { class: 'muted small', text: dur(d.taskMinutes) + ' of tasks' }));
      grid.append(card);
    });
    return h('div', { class: 'stack' },
      h('div', { class: 'spread' }, h('h2', { text: 'Your next ' + plan.days.length + ' days' }),
        h('div', { class: 'row' },
          h('button', { class: 'btn', type: 'button', onclick: function () { replan(); render(); toast('Plan recalculated.'); } }, 'Recalculate'),
          h('button', { class: 'btn', type: 'button', onclick: exportIcs }, 'Send to phone calendar (.ics)'))),
      root.SR.areas.renderHours(plan), renderUnplaced(), grid);
  }

  // ---------- tasks ----------
  function describeTask(t, oneoff) {
    var bits = [dur(t.durationMin)];
    if (t.role) bits.unshift(root.SR.areas.areaName(t.role));
    if (!oneoff) bits.unshift(t.times + '× per ' + t.per);
    if (oneoff && t.date) bits.push('on ' + dayLabel(t.date));
    if (oneoff && t.due) bits.push('due ' + dayLabel(t.due));
    if (mode() !== 'free' || t.when !== 'outside') bits.push(t.when === 'during' ? 'during ' + workWord() : t.when === 'either' ? 'during or outside ' + workWord() : 'outside ' + workWord());
    var rules = [];
    var NAMES = shiftsMode() ? { off: 'normal off days', recovery: 'off days after a shift', day: 'day-shift days', night: 'night-shift days' }
      : { off: 'days off', recovery: 'days off', day: workLabel().toLowerCase() + ' days', night: 'night-shift days' };
    ['off', 'recovery', 'day', 'night'].forEach(function (k) {
      var v = t.allow[k];
      if (v === 'no') rules.push('not on ' + NAMES[k]);
      if (v === 'weekend') rules.push(NAMES[k] + ' at weekends only');
    });
    if (rules.length) bits.push(rules.join(', '));
    if (t.fixedTime) bits.push('at ' + t.fixedTime);
    else if (t.timeOfDay === 'wake') bits.push('morning routine');
    else if (t.timeOfDay !== 'any') bits.push('prefers ' + t.timeOfDay);
    if (t.keepWhole) bits.push('one block');
    if (t.priority === 1) bits.push('high priority');
    return bits.join(' · ');
  }
  function renderTasks() {
    var rec = h('div', {});
    if (!state.recurring.length) rec.append(h('div', { class: 'empty', text: 'No recurring tasks yet.' }));
    state.recurring.forEach(function (t) {
      rec.append(h('div', { class: 'item' + (t.active ? '' : ' paused') },
        tint(h('span', { class: 'swatch', 'aria-hidden': 'true' }), (t.role && root.SR.areas.areaColor(t.role)) || colorVar(t.id)),
        h('div', { class: 'body' }, h('span', { class: 'title', text: t.title + (t.active ? '' : ' (paused)') }), h('span', { class: 'muted small', text: describeTask(t, false) })),
        h('div', { class: 'row' },
          h('button', { class: 'btn small', type: 'button', onclick: function () { openEditor(t, false); } }, 'Edit'),
          h('button', { class: 'btn small', type: 'button', onclick: function () { change(function () { t.active = !t.active; }, t.active ? 'Paused.' : 'Resumed.'); } }, t.active ? 'Pause' : 'Resume'))));
    });
    var open = state.oneoffs.filter(function (o) { return !o.done && !o.project; });
    var done = state.oneoffs.filter(function (o) { return o.done && !o.project; });
    var one = h('div', {});
    if (!open.length) one.append(h('div', { class: 'empty', text: 'No one-off tasks. Add them from Today when something comes up.' }));
    open.forEach(function (o) {
      one.append(h('div', { class: 'item' },
        h('div', { class: 'body' }, h('span', { class: 'title', text: o.title }), h('span', { class: 'muted small', text: describeTask(o, true) })),
        h('div', { class: 'row' },
          h('button', { class: 'btn small', type: 'button', onclick: function () { openEditor(o, true); } }, 'Edit'),
          h('button', { class: 'btn small primary', type: 'button', onclick: function () { markDone('o:' + o.id); } }, 'Done'))));
    });
    return h('div', { class: 'stack' }, root.SR.capture.renderProjects(), h('div', { class: 'grid2' },
      h('section', { class: 'card', 'aria-labelledby': 'recH' },
        h('div', { class: 'spread' }, h('h2', { id: 'recH', text: 'Recurring tasks' }),
          h('button', { class: 'btn primary', type: 'button', onclick: function () { openEditor(null, false); } }, 'Add recurring task')),
        h('p', { class: 'small muted', text: 'These repeat every day, week or month. ShiftRhythm fits them around ' + (shiftsMode() ? 'your shifts' : mode() === 'regular' ? 'your ' + workLabel().toLowerCase() + ' days' : 'your day') + ' and your sleep automatically.' }),
        rec,
        h('details', { open: !state.recurring.length }, h('summary', { text: 'Suggestions for you' }), root.SR.areas.renderSuggestions())),
      h('section', { class: 'card', 'aria-labelledby': 'oneH' },
        h('div', { class: 'spread' }, h('h2', { id: 'oneH', text: 'One-off tasks' }),
          h('button', { class: 'btn primary', type: 'button', onclick: function () { openEditor(null, true); } }, 'Add one-off')),
        one,
        done.length ? h('details', {}, h('summary', { text: 'Done (' + done.length + ')' }),
          done.slice(-30).reverse().map(function (o) {
            return h('div', { class: 'item' }, h('div', { class: 'body' }, h('span', { class: 'title', text: o.title }), h('span', { class: 'muted small', text: describeTask(o, true) })),
              h('button', { class: 'btn small', type: 'button', onclick: function () { undo('o:' + o.id); } }, 'Undo'));
          })) : null)));
  }

  function openEditor(task, oneoff) {
    var isNew = !task;
    var t = task ? JSON.parse(JSON.stringify(task)) : St.cleanTask({ id: St.uid(), title: 'x', per: 'week', times: 1, durationMin: 30 }, oneoff);
    if (isNew) t.title = '';
    var f = {};
    f.title = h('input', { type: 'text', id: 'edTitle', value: t.title, placeholder: oneoff ? 'e.g. Send outreach proposal' : 'e.g. Workout', required: true });
    f.dur = h('input', { type: 'number', id: 'edDur', min: '5', max: '720', step: '5', value: String(t.durationMin) });
    if (!oneoff) {
      f.times = h('input', { type: 'number', id: 'edTimes', min: '1', max: '14', value: String(t.times) });
      f.per = h('select', { id: 'edPer' }, ['day', 'week', 'month'].map(function (p) { return h('option', { value: p, selected: t.per === p }, 'per ' + p); }));
    } else {
      f.date = h('input', { type: 'date', id: 'edDate', value: t.date || '' });
      f.due = h('input', { type: 'date', id: 'edDue', value: t.due || '' });
    }
    f.when = h('select', { id: 'edWhen' },
      h('option', { value: 'outside', selected: t.when === 'outside' }, mode() === 'free' ? 'In my own time' : 'Outside ' + (shiftsMode() ? 'my shift' : workWord()) + ' (personal time)'),
      h('option', { value: 'during', selected: t.when === 'during' }, 'During ' + (shiftsMode() ? 'my shift' : workWord()) + ' (' + (workWord() === 'school' ? 'school' : 'work') + ' task)'),
      h('option', { value: 'either', selected: t.when === 'either' }, 'Either'));
    function ruleSel(k, label, opts) {
      return h('label', { class: 'field' }, h('span', {}, label),
        f['allow_' + k] = h('select', { id: 'edAllow' + k }, opts.map(function (o) { return h('option', { value: o[0], selected: t.allow[k] === o[0] }, o[1]); })));
    }
    if (!t.allow.recovery) t.allow.recovery = t.allow.off;
    f.role = h('select', { id: 'edRole' }, root.SR.areas.areaOptions().map(function (o) { return h('option', { value: o[0], selected: (t.role || '') === o[0] }, o[1]); }));
    f.tod = h('select', { id: 'edTod' }, [['any', 'Any time'], ['wake', 'First thing after waking (morning routine)'], ['morning', 'Morning'], ['afternoon', 'Afternoon'], ['evening', 'Evening']].map(function (o) { return h('option', { value: o[0], selected: t.timeOfDay === o[0] }, o[1]); }));
    f.fixed = h('input', { type: 'time', id: 'edFixed', value: t.fixedTime || '' });
    f.whole = h('input', { type: 'checkbox', id: 'edWhole', checked: t.keepWhole });
    f.prio = h('select', { id: 'edPrio' }, [[1, 'High'], [2, 'Normal'], [3, 'Low']].map(function (o) { return h('option', { value: String(o[0]), selected: t.priority === o[0] }, o[1]); }));
    var err = h('p', { class: 'small', role: 'alert' });
    err.style.color = 'var(--danger)';

    function saveIt() {
      t.title = f.title.value.trim();
      if (!t.title) { err.textContent = 'Give the task a name.'; f.title.focus(); return; }
      t.durationMin = Number(f.dur.value) || 30;
      if (!oneoff) { t.times = Number(f.times.value) || 1; t.per = f.per.value; }
      else { t.date = f.date.value; t.due = f.due.value; }
      t.when = f.when.value;
      var pick = function (k, d) { return f['allow_' + k] ? f['allow_' + k].value : d; };
      t.allow = { off: pick('off', 'yes'), recovery: pick('recovery', pick('off', 'yes')), day: pick('day', t.allow.day || 'yes'), night: pick('night', t.allow.night || 'yes') };
      t.role = f.role.value;
      t.timeOfDay = f.tod.value; t.fixedTime = f.fixed.value; t.keepWhole = f.whole.checked; t.priority = Number(f.prio.value);
      var clean = St.cleanTask(t, oneoff);
      if (t.when === 'during' && clean.allow.day === 'no' && clean.allow.night === 'no') { err.textContent = 'A task done during ' + workWord() + ' needs ' + workWord() + ' days allowed.'; return; }
      close();
      change(function () {
        var list = oneoff ? state.oneoffs : state.recurring;
        var i = list.findIndex(function (x) { return x.id === clean.id; });
        if (i >= 0) list[i] = clean; else list.push(clean);
      }, isNew ? 'Task added. Plan recalculated.' : 'Saved. Plan recalculated.');
    }
    function del() {
      if (!confirmBtn.dataset.armed) { confirmBtn.dataset.armed = '1'; confirmBtn.textContent = 'Tap again to delete'; return; }
      close();
      change(function () {
        if (oneoff) state.oneoffs = state.oneoffs.filter(function (x) { return x.id !== t.id; });
        else state.recurring = state.recurring.filter(function (x) { return x.id !== t.id; });
      }, 'Deleted.');
    }
    var confirmBtn = h('button', { class: 'btn danger', type: 'button', onclick: del }, 'Delete');
    var modal = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'edH' },
      h('h2', { id: 'edH', text: (isNew ? 'Add ' : 'Edit ') + (oneoff ? 'one-off task' : 'recurring task') }),
      h('label', { class: 'field' }, h('span', {}, 'Task'), f.title),
      h('div', { class: 'fields' },
        h('label', { class: 'field' }, h('span', {}, 'Minutes each time'), f.dur),
        oneoff ? [h('label', { class: 'field' }, h('span', {}, 'On a specific day'), f.date), h('label', { class: 'field' }, h('span', {}, 'Or due by'), f.due)]
          : [h('label', { class: 'field' }, h('span', {}, 'How many times'), f.times), h('label', { class: 'field' }, h('span', {}, 'Every'), f.per)]),
      h('div', { class: 'fields' }, h('label', { class: 'field' }, h('span', {}, 'Area of life'), f.role), h('label', { class: 'field' }, h('span', {}, 'Where it happens'), f.when)),
      h('h3', { text: 'Allowed on' }),
      h('div', { class: 'fields' },
        ruleSel('off', shiftsMode() ? 'Normal off days' : mode() === 'regular' ? 'Days off' : 'Any day', [['yes', 'Yes'], ['no', 'No'], ['weekend', 'Weekends only']]),
        shiftsMode() ? ruleSel('recovery', 'Off day right after a shift', [['yes', 'Yes'], ['no', 'No'], ['weekend', 'Weekends only']]) : null,
        mode() === 'free' ? null : ruleSel('day', shiftsMode() ? 'Day-shift days' : workLabel() + ' days', [['yes', 'Yes'], ['no', 'No'], ['weekend', 'Weekends only']]),
        shiftsMode() ? ruleSel('night', 'Night-shift days', [['yes', 'Yes'], ['no', 'No'], ['weekend', 'Weekends only']]) : null),
      h('div', { class: 'fields' },
        h('label', { class: 'field' }, h('span', {}, 'Best time of day'), f.tod),
        h('label', { class: 'field' }, h('span', {}, 'Fixed start time (optional)'), f.fixed),
        h('label', { class: 'field' }, h('span', {}, 'Priority'), f.prio)),
      h('label', { class: 'check' }, f.whole, 'Keep it in one block (don’t split it into focus sessions), e.g. workouts, rehearsals, meetings'),
      err,
      h('div', { class: 'spread' },
        isNew ? h('span') : confirmBtn,
        h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancel'), h('button', { class: 'btn primary', type: 'button', onclick: saveIt }, 'Save'))));
    var bg = h('div', { class: 'modal-bg', onclick: function (e) { if (e.target === bg) close(); } }, modal);
    function close() { bg.remove(); doc.removeEventListener('keydown', esc); }
    function esc(e) { if (e.key === 'Escape') close(); }
    doc.addEventListener('keydown', esc);
    doc.body.append(bg);
    f.title.focus();
  }

  // ---------- shifts ----------
  function defaultType(d) { return mode() === 'regular' && (state.settings.workDays || []).indexOf(Sch.weekday(d)) >= 0 ? 'day' : 'off'; }
  function typeOn(d) { var t = state.shifts[d]; return t === 'day' || t === 'night' || t === 'off' ? t : defaultType(d); }
  function cycle(d) {
    var order = shiftsMode() ? ['off', 'day', 'night'] : ['off', 'day'];
    var cur = typeOn(d);
    change(function () {
      var nx = order[(order.indexOf(cur) + 1) % order.length];
      if (nx === defaultType(d)) delete state.shifts[d]; else state.shifts[d] = nx;
    });
  }
  function renderPatternTool(onApplied) {
    var t = todayIso();
    if (!ui.patternStart) ui.patternStart = t;
    var box = h('div', { class: 'pattern', 'aria-label': 'Rotation pattern' });
    if (!ui.pattern.length) box.append(h('span', { class: 'muted small', text: 'Tap Day, Night or Off to build one full cycle of your rotation.' }));
    ui.pattern.forEach(function (p, i) {
      box.append(h('button', { class: 'chip ' + p, type: 'button', title: 'Remove', onclick: function () { ui.pattern.splice(i, 1); render(); } }, SHORT[p] + ' ×'));
    });
    var start = h('input', { type: 'date', id: 'patStart', value: ui.patternStart, onchange: function () { ui.patternStart = start.value; } });
    var weeks = h('select', { id: 'patWeeks', onchange: function () { ui.patternWeeks = Number(weeks.value); } },
      [4, 8, 12, 26].map(function (w) { return h('option', { value: String(w), selected: ui.patternWeeks === w }, w + ' weeks'); }));
    function apply() {
      if (!ui.pattern.length || !Sch.isIso(start.value)) { toast('Build a pattern and pick a start date first.'); return; }
      var days = ui.patternWeeks * 7;
      change(function () {
        for (var i = 0; i < days; i++) {
          var d = Sch.addDays(start.value, i), p = ui.pattern[i % ui.pattern.length];
          if (p === 'off') delete state.shifts[d]; else state.shifts[d] = p;
        }
      }, 'Rotation applied for ' + ui.patternWeeks + ' weeks.');
      if (onApplied) onApplied();
    }
    return h('div', { class: 'stack' },
      h('div', { class: 'row' }, ['day', 'night', 'off'].map(function (p) {
        return h('button', { class: 'btn small', type: 'button', onclick: function () { ui.pattern.push(p); render(); } }, '+ ' + SHORT[p]);
      }), ui.pattern.length ? h('button', { class: 'btn link', type: 'button', onclick: function () { ui.pattern = []; render(); } }, 'Clear') : null),
      box,
      h('div', { class: 'row' }, h('label', { class: 'field' }, h('span', {}, 'Cycle starts on'), start), h('label', { class: 'field' }, h('span', {}, 'Fill'), weeks),
        h('button', { class: 'btn primary', type: 'button', onclick: apply }, 'Apply rotation')),
      h('p', { class: 'small muted', text: 'Example: Day, Day, Night, Night, Off, Off, Off, Off repeats every 8 days. You can still change any single day afterwards.' }));
  }
  function renderShifts() {
    var t = todayIso();
    if (!ui.calMonth) ui.calMonth = t.slice(0, 7);
    var first = ui.calMonth + '-01';
    var ws = state.settings.weekStartsOn;
    var gridStart = Sch.weekStart(first, ws);
    var cal = h('div', { class: 'cal' });
    for (var i = 0; i < 7; i++) cal.append(h('div', { class: 'hd', text: dayLabel(Sch.addDays(gridStart, i), { weekday: 'short' }) }));
    for (i = 0; i < 42; i++) {
      (function (d) {
        var type = typeOn(d);
        cal.append(h('button', {
          type: 'button', class: type + (d.slice(0, 7) !== ui.calMonth ? ' out' : '') + (d === t ? ' today' : ''),
          'aria-label': dayLabel(d, { weekday: 'long', day: 'numeric', month: 'long' }) + ': ' + dayTypeLabel(type), onclick: function () { cycle(d); }
        }, h('span', { class: 'n', text: String(Number(d.slice(8))) }), h('span', { class: 's', text: shortType(type) })));
      })(Sch.addDays(gridStart, i));
    }
    function shiftMonth(n) { var p = ui.calMonth.split('-').map(Number); var d = new Date(p[0], p[1] - 1 + n, 1); ui.calMonth = d.getFullYear() + '-' + pad(d.getMonth() + 1); render(); }
    return h('div', { class: 'grid2' },
      h('section', { class: 'card', 'aria-labelledby': 'calH' },
        h('div', { class: 'spread' },
          h('h2', { id: 'calH', text: dayLabel(first, { month: 'long', year: 'numeric' }) }),
          h('div', { class: 'row' }, h('button', { class: 'btn small', type: 'button', onclick: function () { shiftMonth(-1); } }, '‹ Prev'), h('button', { class: 'btn small', type: 'button', onclick: function () { shiftMonth(1); } }, 'Next ›'))),
        h('p', { class: 'small muted', text: shiftsMode() ? 'Tap a day to switch Off \u2192 Day \u2192 Night.' : 'Tap a day to switch between ' + workLabel().toLowerCase() + ' and a day off: holidays, leave, an extra day.' }),
        cal),
      h('div', { class: 'stack' },
        h('section', { class: 'card', 'aria-labelledby': 'wkH' }, h('h2', { id: 'wkH', text: 'Your main schedule' }), renderModePicker()),
        shiftsMode() ? h('section', { class: 'card', 'aria-labelledby': 'rosH' }, h('h2', { id: 'rosH', text: 'Import this month\u2019s roster' }), root.SR.capture.renderRosterImport()) : null,
        shiftsMode() ? h('section', { class: 'card', 'aria-labelledby': 'patH' }, h('details', {}, h('summary', { id: 'patH', text: 'Or fill from a repeating rotation' }), renderPatternTool())) : null));
  }
  function shiftHoursFields() {
    var s = state.settings.shifts;
    function tf(id, k, side) {
      return h('input', { type: 'time', id: id, value: s[k][side], onchange: function (e) { var v = e.target.value; if (v) change(function () { state.settings.shifts[k][side] = v; }, 'Hours saved.'); } });
    }
    if (!shiftsMode()) {
      return h('div', { class: 'fields' },
        h('label', { class: 'field' }, h('span', {}, workLabel() + ' starts'), tf('dS', 'day', 'start')),
        h('label', { class: 'field' }, h('span', {}, workLabel() + ' ends'), tf('dE', 'day', 'end')));
    }
    return h('div', { class: 'fields' },
      h('label', { class: 'field' }, h('span', {}, 'Day shift starts'), tf('dS', 'day', 'start')),
      h('label', { class: 'field' }, h('span', {}, 'Day shift ends'), tf('dE', 'day', 'end')),
      h('label', { class: 'field' }, h('span', {}, 'Night shift starts'), tf('nS', 'night', 'start')),
      h('label', { class: 'field' }, h('span', {}, 'Night shift ends'), tf('nE', 'night', 'end')));
  }

  function renderLifeCard() {
    return h('section', { class: 'card', 'aria-labelledby': 'lifeH' },
      h('h2', { id: 'lifeH', text: 'Your life' }),
      h('h3', { text: 'What\u2019s part of your life?' }), root.SR.areas.renderPersonaPicker(),
      h('h3', { text: 'Your main schedule' }), renderModePicker(),
      h('h3', { text: 'Your areas' }), root.SR.areas.renderAreas());
  }
  var MODES = [
    ['shifts', 'I work shifts', 'Rotating day and night shifts, a new roster each month.'],
    ['regular', 'I have a regular schedule', 'Work, school or classes on set days and hours, like Monday to Friday, 9 to 5.'],
    ['free', 'My time is my own', 'Not working right now, freelancing, retired, at home or between jobs.']
  ];
  function renderModePicker() {
    var box = h('div', { class: 'stack' });
    var opts = h('div', { class: 'modes', role: 'radiogroup', 'aria-label': 'What your week looks like' });
    MODES.forEach(function (m) {
      opts.append(h('button', { type: 'button', class: 'mode-opt' + (mode() === m[0] ? ' on' : ''), role: 'radio', 'aria-checked': String(mode() === m[0]),
        onclick: function () {
          change(function () {
            state.settings.mode = m[0];
            if (m[0] === 'regular' && state.settings.shifts.day.start === '07:00' && state.settings.shifts.day.end === '19:00') state.settings.shifts.day = { start: '09:00', end: '17:00' };
            if (m[0] === 'shifts' && state.settings.shifts.day.start === '09:00' && state.settings.shifts.day.end === '17:00') state.settings.shifts.day = { start: '07:00', end: '19:00' };
          });
        } }, h('strong', { text: m[1] }), h('span', { class: 'small muted', text: m[2] })));
    });
    box.append(opts);
    if (mode() === 'regular') {
      var label = h('input', { type: 'text', id: 'workLabel', value: workLabel(), placeholder: 'Work, School, Lectures\u2026', onchange: function (e) { var v = e.target.value.trim().slice(0, 30) || 'Work'; change(function () { state.settings.workLabel = v; }); } });
      var days = h('div', { class: 'row' }, [1, 2, 3, 4, 5, 6, 0].map(function (d) {
        var cb = h('input', { type: 'checkbox', checked: (state.settings.workDays || []).indexOf(d) >= 0, onchange: function () {
          change(function () { var w = (state.settings.workDays || []).filter(function (x) { return x !== d; }); if (cb.checked) w.push(d); state.settings.workDays = w; });
        } });
        return h('label', { class: 'check' }, cb, dayLabel(Sch.addDays('2026-11-08', d), { weekday: 'short' }));
      }));
      box.append(h('div', { class: 'fields' }, h('label', { class: 'field' }, h('span', {}, 'Call it'), label)),
        h('div', { class: 'field' }, h('span', { class: 'small muted' }, 'On these days'), days), shiftHoursFields());
    } else if (mode() === 'shifts') {
      box.append(h('div', { class: 'fields' }, h('label', { class: 'field' }, h('span', {}, 'Where you work (optional)'),
        h('input', { type: 'text', id: 'workLabelS', value: state.settings.workLabel === 'Work' ? '' : state.settings.workLabel, placeholder: 'e.g. PAIX', onchange: function (e) { var v = e.target.value.trim().slice(0, 30) || 'Work'; change(function () { state.settings.workLabel = v; }); } }))),
        shiftHoursFields());
    }
    else box.append(h('p', { class: 'small muted', text: 'No fixed commitments: every day is planned around your sleep and the things you want to do. If something regular comes up, like a part-time job or classes, switch to a regular schedule, or tap single days on the calendar.' }));
    box.append(h('div', { class: 'fields' }, mode() === 'free' ? null : numField('wCommute', 'Travel each way', 'commuteMin', 0, 240, 5, 'min')));
    return box;
  }

  // ---------- settings ----------
  function numField(id, label, key, min, max, step, suffix) {
    var inp = h('input', { type: 'number', id: id, min: String(min), max: String(max), step: String(step || 1), value: String(state.settings[key]),
      onchange: function () { var v = Number(inp.value); if (isFinite(v)) change(function () { state.settings[key] = Math.min(max, Math.max(min, v)); }, 'Saved. Plan recalculated.'); } });
    return h('label', { class: 'field' }, h('span', {}, label + (suffix ? ' (' + suffix + ')' : '')), inp);
  }
  function timeField(id, label, key) {
    var inp = h('input', { type: 'time', id: id, value: state.settings[key], onchange: function () { if (inp.value) change(function () { state.settings[key] = inp.value; }, 'Saved. Plan recalculated.'); } });
    return h('label', { class: 'field' }, h('span', {}, label), inp);
  }
  function rhythmPicker() {
    var presets = [[25, 5], [30, 15], [45, 15], [50, 10], [90, 20]];
    var cur = state.settings.focusMin + '/' + state.settings.breakMin;
    return h('div', { class: 'stack' },
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Focus and break presets' }, presets.map(function (p) {
        var k = p[0] + '/' + p[1];
        return h('button', { type: 'button', 'aria-pressed': String(cur === k), onclick: function () { change(function () { state.settings.focusMin = p[0]; state.settings.breakMin = p[1]; }, 'Rhythm set to ' + p[0] + ' min focus, ' + p[1] + ' min break.'); } }, k);
      })),
      h('div', { class: 'fields' }, numField('focusMin', 'Focus for', 'focusMin', 5, 240, 5, 'min'), numField('breakMin', 'Then break for', 'breakMin', 0, 120, 5, 'min')));
  }
  function renderSettings() {
    var S = state.settings;
    var chimeSel = h('select', { id: 'chime', onchange: function () { change(function () { S.chime = chimeSel.value; }); Al.play('focus', S); } },
      [['bells', 'Bells'], ['marimba', 'Marimba'], ['bubbles', 'Bubbles']].map(function (o) { return h('option', { value: o[0], selected: S.chime === o[0] }, o[1]); }));
    var vol = h('input', { type: 'range', id: 'vol', min: '0', max: '1', step: '0.1', value: String(S.volume), onchange: function () { change(function () { S.volume = Number(vol.value); }); Al.play('heads', S); } });
    var wake = h('input', { type: 'time', id: 'wake', value: S.wakeTime, onchange: function () { if (wake.value) change(function () { S.wakeTime = wake.value; }, 'Saved.'); } });
    var weekendBox = h('div', { class: 'row' }, [0, 1, 2, 3, 4, 5, 6].map(function (d) {
      var cb = h('input', { type: 'checkbox', checked: S.weekendDays.indexOf(d) >= 0, onchange: function () {
        change(function () { S.weekendDays = [0, 1, 2, 3, 4, 5, 6].filter(function (x) { return x === d ? cb.checked : S.weekendDays.indexOf(x) >= 0; }); });
      } });
      return h('label', { class: 'check' }, cb, dayLabel(Sch.addDays('2026-11-08', d), { weekday: 'short' }));
    }));
    var weekStart = h('select', { id: 'wkStart', onchange: function () { change(function () { S.weekStartsOn = Number(weekStart.value); }); } },
      [[1, 'Monday'], [0, 'Sunday'], [6, 'Saturday']].map(function (o) { return h('option', { value: String(o[0]), selected: S.weekStartsOn === o[0] }, o[1]); }));

    var pass = h('input', { type: 'password', id: 'bkPass', placeholder: 'Optional passphrase', autocomplete: 'new-password' });
    var reset = h('button', { class: 'btn danger', type: 'button', onclick: function () {
      if (!reset.dataset.armed) { reset.dataset.armed = '1'; reset.textContent = 'Tap again to erase everything'; return; }
      state = St.blank(); save(); replan(); root.location.hash = '#today'; render(); toast('All data erased from this device.');
    } }, 'Erase all data');

    return h('div', { class: 'grid2' },
      h('div', { class: 'stack' },
        h('section', { class: 'card' }, h('h2', { text: 'You' }),
          h('div', { class: 'fields' },
            h('label', { class: 'field' }, h('span', {}, 'Your first name'), h('input', { type: 'text', id: 'myName', value: S.name || '', placeholder: 'For your greeting', onchange: function (e) { var v = e.target.value.trim().slice(0, 40); change(function () { S.name = v; }); } })),
            h('div', { class: 'field' }, h('span', { class: 'small muted' }, 'Look'),
              h('div', { class: 'seg', role: 'group', 'aria-label': 'Theme' }, [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].map(function (o) {
                return h('button', { type: 'button', 'aria-pressed': String((S.theme || 'auto') === o[0]), onclick: function () { change(function () { S.theme = o[0]; }); } }, o[1]);
              }))))),
        h('section', { class: 'card' }, h('h2', { text: 'Streaks and coins' }),
          h('label', { class: 'check' }, h('input', { type: 'checkbox', id: 'autoFreeze', checked: !state.rewards || state.rewards.auto !== false, onchange: function (e) { var v = e.target.checked; change(function () { Rw.ensure(state, todayIso()).auto = v; }, v ? 'Coins will freeze missed days automatically.' : 'Automatic freezes are off.'); } }),
            'Spend ' + Rw.FREEZE_COST + ' coins to freeze a day automatically when I miss it')),
        h('section', { class: 'card' }, h('h2', { text: 'Focus rhythm' }),
          h('p', { class: 'small muted', text: 'How long you can focus before a break. Every task is split into sessions of this length, with a break after each one.' }),
          rhythmPicker()),
        h('section', { class: 'card' }, h('h2', { text: 'Sleep, travel and limits' }),
          h('div', { class: 'fields' },
            h('label', { class: 'field' }, h('span', {}, mode() === 'free' ? 'Wake time' : shiftsMode() ? 'Wake on normal off days' : 'Wake on days off'), wake),
            shiftsMode() ? timeField('wakeAD', 'Wake after a day shift', 'wakeAfterDayShift') : null,
            timeField('bed', 'Usual bedtime', 'bedtime'),
            shiftsMode() ? timeField('pnS', 'After a night shift, rest from', 'postNightSleep') : null,
            shiftsMode() ? timeField('pnE', '\u2026until', 'postNightWake') : null,
            numField('sleepH', mode() === 'free' ? 'Least sleep' : 'Least sleep before ' + workWord(), 'sleepHours', 4, 12, 0.5, 'hours'),
            numField('prep', 'Getting ready', 'prepMin', 0, 180, 5, 'min'),
            numField('commute', 'Travel each way', 'commuteMin', 0, 240, 5, 'min'),
            shiftsMode() ? numField('nap', 'Nap before night shifts', 'napMin', 0, 240, 15, 'min') : null,
            mode() === 'free' ? null : numField('handover', 'Settling in at the start of ' + workWord(), 'handoverMin', 0, 180, 5, 'min'),
            mode() === 'free' ? null : numField('endBuf', 'Wrap-up at the end of ' + workWord(), 'shiftEndBufferMin', 0, 180, 5, 'min'),
            numField('capOff', 'Max task time, off days', 'capOffDay', 0, 960, 15, 'min'),
            shiftsMode() ? numField('capRec', 'Max task time, off day after a shift', 'capRecoveryDay', 0, 960, 15, 'min') : null,
            mode() === 'free' ? null : numField('capShift', 'Max task time, ' + workWord() + ' days', 'capShiftDay', 0, 480, 15, 'min')),
          h('div', { class: 'fields' }, numField('maxSession', 'Longest sitting for a project step', 'maxSession', 30, 480, 15, 'min')),
          mode() === 'free' ? null : h('p', { class: 'small muted', text: 'The ' + workWord() + '-day limit protects you after a long day. Tasks done during ' + workWord() + ' don\u2019t count towards it.' })),
        renderLifeCard(),
        h('section', { class: 'card' }, h('h2', { text: 'Week' }),
          h('label', { class: 'field' }, h('span', {}, 'Week starts on'), weekStart),
          h('div', { class: 'field' }, h('span', { class: 'small muted' }, 'Weekend days (for "weekends only" rules)'), weekendBox))),
      h('div', { class: 'stack' },
        renderSyncCard(),
        h('section', { class: 'card' }, h('h2', { text: 'Alarms' }),
          h('label', { class: 'check' }, h('input', { type: 'checkbox', id: 'snd', checked: S.sound, onchange: function (e) { var v = e.target.checked; change(function () { S.sound = v; }); } }), 'Play a chime when it is time to switch'),
          h('div', { class: 'fields' }, h('label', { class: 'field' }, h('span', {}, 'Chime'), chimeSel), h('label', { class: 'field' }, h('span', {}, 'Volume'), vol),
            numField('heads', 'Heads-up before tasks', 'headsUpMin', 0, 60, 1, 'min')),
          h('div', { class: 'row' }, h('span', { class: 'small muted', text: 'Test:' }),
            [['focus', 'Focus'], ['break', 'Break'], ['travel', 'Travel'], ['sleep', 'Sleep']].map(function (o) {
              return h('button', { class: 'btn small', type: 'button', onclick: function () { Al.unlock(); Al.play(o[0], S); } }, o[1]);
            })),
          h('div', { class: 'row' }, h('span', { class: 'small', text: 'Notifications: ' + ({ granted: 'on', denied: 'blocked in your browser settings', default: 'not set', unsupported: 'not supported here' })[Al.permission()] }),
            Al.permission() === 'default' ? h('button', { class: 'btn small', type: 'button', onclick: function () { Al.askPermission().then(render); } }, 'Allow') : null),
          h('p', { class: 'small muted', text: 'Alarms ring while ShiftRhythm is open (a tab or the installed app). For alarms when it is closed, send your plan to your phone calendar.' }),
          h('button', { class: 'btn', type: 'button', onclick: exportIcs }, 'Send plan to phone calendar (.ics)')),
        h('section', { class: 'card' }, h('h2', { text: 'Voice typing' }),
          h('label', { class: 'check' }, h('input', { type: 'checkbox', id: 'voice', checked: S.voice, onchange: function (e) { var v = e.target.checked; change(function () { S.voice = v; }); } }), 'Use the browser\u2019s voice typing for the Speak button'),
          h('p', { class: 'small muted', text: 'Off by default. Chrome and Edge send the audio to Google or Microsoft to turn it into text. Your keyboard\u2019s own microphone key always works too.' })),
        h('section', { class: 'card' }, h('h2', { text: 'Backup' }),
          h('p', { class: 'small muted', text: 'Your data lives only in this browser on this device. Save a backup file to move it to another device or keep it safe.' }),
          pass,
          h('button', { class: 'btn', type: 'button', onclick: function () {
            St.exportBackup(state, pass.value).then(function (txt) {
              download('shiftrhythm-backup-' + todayIso() + (pass.value ? '.srbackup' : '.json'), txt, 'application/json');
              toast(pass.value ? 'Encrypted backup saved.' : 'Backup saved.');
            }, function (e) { toast(e.message); });
          } }, 'Save backup'),
          h('h3', { text: 'Restore' }), renderRestore(),
          h('p', { class: 'small muted', text: 'Restoring replaces everything on this device.' })),
        h('section', { class: 'card' }, h('h2', { text: 'Privacy' }),
          h('p', { class: 'small', text: 'ShiftRhythm makes no network requests. There is no account, server, analytics or tracking. The page blocks all outside connections, so even a bug cannot send your data anywhere.' }),
          h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: function () { state.setupDone = false; ui.wizardStep = 0; save(); render(); } }, 'Run setup again'), reset))));
  }

  // ---------- sync settings ----------
  function syncStatusText() {
    if (!root.SR.sync) return '';
    var i = root.SR.sync.info(), st = i.status;
    if (!i.connected) return 'Not set up on this device.';
    if (st.state === 'syncing') return 'Syncing\u2026';
    if (st.state === 'locked') return st.message || 'Locked. Enter your passphrase.';
    if (st.state === 'error' || st.state === 'offline') return st.message;
    if (st.lastSync) { var m = Math.round((Date.now() - st.lastSync) / 60000); return 'Synced ' + (m < 1 ? 'just now' : m + ' min ago') + (i.dirty ? ' \u00b7 changes waiting' : ''); }
    return i.dirty ? 'Changes waiting to sync.' : 'Connected.';
  }
  function renderSyncCard() {
    var card = h('section', { class: 'card', 'aria-labelledby': 'syncH' }, h('div', { class: 'spread' }, h('h2', { id: 'syncH', text: 'Sync your devices' }), h('span', { class: 'chip good', text: 'End-to-end encrypted' })));
    if ((root.claude && typeof root.claude.use === 'function') || !root.SR.sync) {
      card.append(h('p', { class: 'small muted', text: 'Sync runs in the version you open from your GitHub Pages link or your computer. It can\u2019t run inside this preview, because the preview isn\u2019t allowed to contact GitHub.' }));
      return card;
    }
    var i = root.SR.sync.info();
    var stat = h('p', { class: 'small', id: 'syncStatus', role: 'status', text: syncStatusText() });
    if (i.connected) {
      card.append(h('p', { class: 'small muted', text: 'Saved to ' + i.owner + '/' + i.repo + ' as \u201c' + (i.device || 'this device') + '\u201d. Only ciphertext is stored there; your passphrase never leaves this device.' }), stat);
      if (i.status.state === 'locked') {
        var up = h('input', { type: 'password', id: 'syncUnlock', placeholder: 'Sync passphrase', autocomplete: 'current-password' });
        card.append(up, h('button', { class: 'btn primary', type: 'button', onclick: function () { root.SR.sync.unlock(doc.getElementById('syncUnlock').value).then(function () { toast('Sync unlocked.'); render(); }, function (e) { toast(e.message); render(); }); } }, 'Unlock'));
      }
      var dis = h('button', { class: 'btn danger small', type: 'button', onclick: function () {
        if (!dis.dataset.armed) { dis.dataset.armed = '1'; dis.textContent = 'Tap again to disconnect'; return; }
        root.SR.sync.disconnect().then(function () { toast('This device no longer syncs. Your data here is untouched.'); render(); });
      } }, 'Disconnect this device');
      card.append(h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: function () { root.SR.sync.syncNow('manual').then(function () { render(); }); } }, 'Sync now'), dis));
      return card;
    }
    var f = {
      owner: h('input', { type: 'text', id: 'syOwner', placeholder: 'e.g. tricia-ships-it', autocomplete: 'off', autocapitalize: 'off' }),
      repo: h('input', { type: 'text', id: 'syRepo', value: 'shiftrhythm-data', autocomplete: 'off', autocapitalize: 'off' }),
      token: h('input', { type: 'password', id: 'syToken', placeholder: 'github_pat_\u2026', autocomplete: 'off' }),
      pass: h('input', { type: 'password', id: 'syPass', placeholder: 'A sentence only you know', autocomplete: 'new-password' }),
      confirm: h('input', { type: 'password', id: 'syConfirm', placeholder: 'Type it again (first device only)', autocomplete: 'new-password' }),
      device: h('input', { type: 'text', id: 'syDevice', value: /Mobi|Android|iPhone/i.test(root.navigator.userAgent) ? 'Phone' : 'Laptop' }),
      remember: h('input', { type: 'checkbox', id: 'syRemember', checked: true })
    };
    var err = h('p', { class: 'small warn-text', role: 'alert' });
    var go = h('button', { class: 'btn primary', type: 'button', onclick: function () {
      err.textContent = ''; go.disabled = true; go.textContent = 'Connecting\u2026';
      var v = function (id) { var el = doc.getElementById(id); return el ? el.value : ''; };
      var rem = doc.getElementById('syRemember');
      root.SR.sync.connect({ owner: v('syOwner'), repo: v('syRepo'), token: v('syToken'), pass: v('syPass'), confirm: v('syConfirm'), device: v('syDevice'), remember: rem ? rem.checked : true })
        .then(function () { toast('Sync is on. Do the same on your other device.'); render(); },
          function (e) { err.textContent = e.message; go.disabled = false; go.textContent = 'Connect and sync'; });
    } }, 'Connect and sync');
    card.append(
      h('p', { class: 'small muted', text: 'Use the planner on your phone and laptop with the same data. It\u2019s encrypted on your device with your passphrase, then stored in a private GitHub repository of yours. GitHub, and anyone who got in there, would only see scrambled data.' }),
      h('details', {}, h('summary', { class: 'small', text: 'Set it up (about 5 minutes, once)' }),
        h('ol', { class: 'small setup' },
          h('li', {}, 'On GitHub, create a new ', h('b', {}, 'private'), ' repository called ', h('b', {}, 'shiftrhythm-data'), '. Leave it empty.'),
          h('li', {}, 'Create a fine-grained token: ', h('a', { href: 'https://github.com/settings/personal-access-tokens/new', target: '_blank', rel: 'noopener noreferrer' }, 'github.com/settings/personal-access-tokens/new'), '. Under Repository access choose ', h('b', {}, 'Only select repositories'), ' \u2192 shiftrhythm-data. Under Permissions \u2192 Repository permissions set ', h('b', {}, 'Contents: Read and write'), '. Nothing else.'),
          h('li', {}, 'Pick a sync passphrase. Use the same one on every device. If you forget it, the synced copy can\u2019t be opened by anyone, including you, but each device keeps its own copy.'),
          h('li', {}, 'Fill in the form below and connect. Then do the same on your other device (it will ask for the passphrase only).'))),
      h('div', { class: 'fields' },
        h('label', { class: 'field' }, h('span', {}, 'GitHub username'), f.owner),
        h('label', { class: 'field' }, h('span', {}, 'Private repository'), f.repo),
        h('label', { class: 'field' }, h('span', {}, 'This device\u2019s name'), f.device)),
      h('label', { class: 'field' }, h('span', {}, 'Access token'), f.token),
      h('div', { class: 'fields' }, h('label', { class: 'field' }, h('span', {}, 'Sync passphrase'), f.pass), h('label', { class: 'field' }, h('span', {}, 'Confirm passphrase'), f.confirm)),
      h('label', { class: 'check' }, f.remember, 'Remember the key on this device (so it syncs automatically)'),
      err, h('div', { class: 'row' }, go));
    return card;
  }

  function renderRestore() {
    var ipass = h('input', { type: 'password', id: 'imPass', placeholder: 'Passphrase (if the backup is encrypted)', autocomplete: 'off' });
    var file = h('input', { type: 'file', id: 'imFile', accept: '.json,.srbackup,application/json' });
    return h('div', { class: 'stack' }, file, ipass,
      h('button', { class: 'btn', type: 'button', onclick: function () {
        var fl = file.files && file.files[0];
        if (!fl) { toast('Choose a backup file first.'); return; }
        if (fl.size > 5 * 1024 * 1024) { toast('That file is too large to be a backup.'); return; }
        fl.text().then(function (txt) { return St.importBackup(txt, ipass.value); }).then(function (s2) {
          state = s2; state.setupDone = true; save(); replan(); root.location.hash = '#today'; render(); toast('Backup restored.');
        }, function (e) { toast(e.message); });
      } }, 'Restore backup'));
  }

  function exportIcs() {
    var txt = Ics.build(plan, ['task', 'break', 'prep', 'commute', 'shift'], state.settings.headsUpMin);
    download('shiftrhythm-' + plan.from + '-to-' + plan.to + '.ics', txt, 'text/calendar');
    toast('Calendar file saved. Open it to add the plan to your calendar.');
  }

  // ---------- first-run setup ----------
  function renderWizard() {
    var steps = ['Welcome', 'Your life', 'Sleep and rhythm', 'Recurring tasks', 'Alarms'];
    var s = ui.wizardStep;
    var bar = h('div', { class: 'steps', 'aria-hidden': 'true' }, steps.map(function (_, i) { return h('i', { class: i <= s ? 'on' : '' }); }));
    function nav(canBack, nextLabel, onNext) {
      return h('div', { class: 'spread' },
        canBack ? h('button', { class: 'btn', type: 'button', onclick: function () { ui.wizardStep--; render(); } }, 'Back') : h('span'),
        h('button', { class: 'btn primary', type: 'button', onclick: onNext || function () { ui.wizardStep++; render(); } }, nextLabel || 'Next'));
    }
    var body;
    if (s === 0) {
      var inClaude = root.claude && typeof root.claude.use === 'function';
      body = [h('h2', { text: 'A planner that fits your real life' }),
        h('p', { text: 'Rotating shifts, a 9-to-5, classes, or no fixed schedule at all: ShiftRhythm starts from how your week actually runs. Tell it the things you want to do, and it builds each day and week around your commitments, your sleep and your focus rhythm. Say what\u2019s coming up and it breaks big jobs into steps. It rings a soft chime when it\u2019s time to switch, and rewards the days you show up.' }),
        h('p', { class: 'small muted', text: 'Everything stays on this device. No account, no server, no tracking.' }),
        nav(false, 'Set up from scratch'),
        h('div', { class: 'proposal' },
          h('strong', { text: 'Already using ShiftRhythm on another device?' }),
          inClaude || !root.SR.sync ? null : h('details', {}, h('summary', { class: 'small', text: 'Sync from your other device (recommended)' }),
            h('p', { class: 'small muted', text: 'Use the same GitHub username, repository and passphrase as on your other device, with a token made for this device. Everything comes across: your calendar, tasks, streaks and coins.' }),
            renderSyncCard()),
          h('details', {}, h('summary', { class: 'small', text: 'Restore a backup file' }), renderRestore()))];
    } else if (s === 1) {
      body = [h('h2', { text: 'What\u2019s part of your life?' }), root.SR.areas.renderPersonaPicker(),
        h('h3', { text: 'Your main schedule' }), renderModePicker(),
        (state.roles || []).length ? [h('h3', { text: 'Your areas' }), root.SR.areas.renderAreas()] : null,
        shiftsMode() ? [h('h3', { text: 'This month\u2019s roster' }), root.SR.capture.renderRosterImport(),
          h('details', {}, h('summary', { text: 'Or use a repeating rotation' }), renderPatternTool()),
          h('p', { class: 'small muted', text: 'Irregular rota? Skip this and tap days on the calendar later.' })] : null,
        nav(true)];
    } else if (s === 2) {
      body = [h('h2', { text: 'Sleep and focus rhythm' }),
        h('div', { class: 'fields' }, numField('wSleep', 'Sleep', 'sleepHours', 4, 12, 0.5, 'hours'),
          h('label', { class: 'field' }, h('span', {}, mode() === 'free' ? 'Wake time' : 'Wake time on days off'), h('input', { type: 'time', id: 'wWake', value: state.settings.wakeTime, onchange: function (e) { var v = e.target.value; if (v) change(function () { state.settings.wakeTime = v; }); } })),
          timeField('wBed', 'Usual bedtime', 'bedtime'),
          shiftsMode() ? numField('wNap', 'Nap before night shifts', 'napMin', 0, 240, 15, 'min') : null),
        h('h3', { text: 'How long can you focus before a break?' }), rhythmPicker(),
        h('div', { class: 'fields' }, numField('wCapOff', mode() === 'free' ? 'Max task time a day' : 'Max task time, days off', 'capOffDay', 0, 960, 15, 'min'), mode() === 'free' ? null : numField('wCapShift', 'Max task time, ' + workWord() + ' days', 'capShiftDay', 0, 480, 15, 'min')),
        nav(true)];
    } else if (s === 3) {
      var list = h('div', {});
      if (!state.recurring.length) list.append(h('div', { class: 'empty', text: 'Nothing yet. Pick from the suggestions below, or add your own.' }));
      state.recurring.forEach(function (t) {
        list.append(h('div', { class: 'item' }, h('div', { class: 'body' }, h('span', { class: 'title', text: t.title }), h('span', { class: 'muted small', text: describeTask(t, false) })),
          h('button', { class: 'btn small', type: 'button', onclick: function () { openEditor(t, false); } }, 'Edit')));
      });
      body = [h('h2', { text: 'Things you do regularly' }),
        h('p', { class: 'small muted', text: 'Workouts, study, practice, chores, side projects, family time. For each one, say how often, how long, and which days it\u2019s allowed on.' }),
        h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'button', onclick: function () { openEditor(null, false); } }, 'Add a task')),
        list,
        h('h3', { text: 'Suggested for you' }), root.SR.areas.renderSuggestions(),
        nav(true)];
    } else {
      body = [h('h2', { text: 'Alarms' }),
        h('p', { text: 'When a focus session, break, travel time or bedtime starts, ShiftRhythm plays a short chime and shows a notification.' }),
        h('div', { class: 'row' },
          h('button', { class: 'btn', type: 'button', onclick: function () { Al.unlock(); Al.play('focus', state.settings); } }, 'Hear the focus chime'),
          h('button', { class: 'btn', type: 'button', onclick: function () { Al.unlock(); Al.play('break', state.settings); } }, 'Hear the break chime'),
          Al.permission() === 'default' ? h('button', { class: 'btn', type: 'button', onclick: function () { Al.askPermission().then(render); } }, 'Allow notifications') : h('span', { class: 'small muted', text: 'Notifications: ' + Al.permission() })),
        nav(true, 'Show my plan', function () { Al.unlock(); change(function () { state.setupDone = true; }); root.location.hash = '#today'; })];
    }
    return h('section', { class: 'card', 'aria-label': 'Setup, step ' + (s + 1) + ' of ' + steps.length }, bar, h('h3', { text: 'Step ' + (s + 1) + ' of ' + steps.length + ' · ' + steps[s] }), body);
  }

  // ---------- alarm loop ----------
  var FIRED_KEY = 'shiftrhythm.fired';
  var fired = {};
  try { fired = JSON.parse(root.localStorage.getItem(FIRED_KEY) || '{}') || {}; } catch (e) { fired = {}; }
  function markFired(id) {
    fired[id] = Date.now();
    var cutoff = Date.now() - 2 * 86400000;
    Object.keys(fired).forEach(function (k) { if (fired[k] < cutoff) delete fired[k]; });
    try { root.localStorage.setItem(FIRED_KEY, JSON.stringify(fired)); } catch (e) {}
  }
  var TUNE = { task: 'focus', break: 'break', commute: 'travel', prep: 'focus', nap: 'sleep', sleep: 'sleep', commit: 'focus' };
  function alarmText(b) {
    if (b.kind === 'task') return { title: 'Time for: ' + b.title + (b.part ? ' (' + b.part + ')' : ''), body: b.startTime + '–' + b.endTime + ' · ' + dur(b.minutes) + ' focus' };
    if (b.kind === 'commit') return { title: 'Time for: ' + b.title, body: b.startTime + '\u2013' + b.endTime };
    if (b.kind === 'break') return { title: 'Break time', body: 'Step away for ' + dur(b.minutes) + '. Stretch, drink some water.' };
    if (b.kind === 'commute') return { title: b.title, body: 'Leave now · ' + b.startTime };
    if (b.kind === 'prep') return { title: 'Time to get up and get ready', body: 'Leave at ' + b.endTime + '.' };
    if (b.kind === 'nap') return { title: 'Nap time', body: 'Rest before your night shift until ' + b.endTime + '.' };
    return { title: 'Wind down for sleep', body: 'Sleep until ' + b.endTime + '.' };
  }
  function ring(b, heads) {
    var txt = heads ? { title: 'In ' + state.settings.headsUpMin + ' min: ' + (b.kind === 'task' ? b.title : b.title), body: 'Starts at ' + b.startTime } : alarmText(b);
    if (state.settings.sound) Al.play(heads ? 'heads' : TUNE[b.kind] || 'focus', Object.assign({}, state.settings, { repeat: heads ? 1 : 2 }));
    Al.notify(txt.title, txt.body, heads ? 'heads' : 'switch');
    if (heads) return;
    showAlarm(b, txt);
  }
  function showAlarm(b, txt) {
    closeAlarm();
    var box = h('div', { class: 'alarm k-' + b.kind, role: 'alertdialog', 'aria-labelledby': 'alT' },
      h('div', { class: 'big', id: 'alT', text: txt.title }), h('div', { text: txt.body }),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', type: 'button', onclick: closeAlarm }, 'Got it'),
        h('button', { class: 'btn', type: 'button', onclick: function () { closeAlarm(); setTimeout(function () { ring(b, false); }, 5 * 60000); toast('I’ll remind you again in 5 minutes.'); } }, 'Snooze 5 min')));
    if (b.kind === 'task') tint(box, taskColor(b));
    doc.body.append(box);
    var again = 0;
    ui.alarm = { el: box, timer: setInterval(function () {
      if (++again > 2 || !state.settings.sound) { clearInterval(ui.alarm.timer); return; }
      Al.play(TUNE[b.kind] || 'focus', state.settings);
    }, 30000) };
  }
  function closeAlarm() { if (ui.alarm) { clearInterval(ui.alarm.timer); ui.alarm.el.remove(); ui.alarm = null; } }

  function tick() {
    if (!plan) return;
    if (todayIso() !== planDay) { replan(); render(); flushEvents(); }
    var now = nowAbsPrecise();
    var hu = state.settings.headsUpMin;
    plan.blocks.forEach(function (b) {
      if (b.done || !TUNE[b.kind] || (b.adjusted && b.kind === 'sleep')) return; // you just told us you're resting
      if (now >= b.s && now < b.s + 3 && !fired[b.id]) { markFired(b.id); ring(b, false); }
      else if (hu > 0 && (b.kind === 'task' || b.kind === 'commute') && now >= b.s - hu && now < b.s - hu + 3 && !fired['h:' + b.id]) { markFired('h:' + b.id); ring(b, true); }
    });
    var cd = doc.getElementById('countdown');
    if (cd) cd.textContent = countdownText(Number(cd.dataset.at) - now);
  }

  // ---------- shared with capture.js ----------
  root.SR.app = {
    h: h, state: function () { return state; }, plan: function () { return plan; }, change: change, render: render, toast: toast,
    todayIso: todayIso, nowMin: nowMin, dur: dur, dayLabel: dayLabel, colorVar: colorVar, tint: tint,
    mode: mode, workWord: workWord, workLabel: workLabel, dayTypeLabel: dayTypeLabel
  };

  // ---------- boot ----------
  function boot() {
    // Anti-clickjacking: refuse to run inside someone else's frame (the Claude preview is the only allowed host).
    var framed = false;
    try { framed = root.top !== root.self; } catch (e) { framed = true; }
    if (framed && root.SR_PREVIEW !== true && !(root.claude && typeof root.claude.use === 'function')) {
      doc.body.replaceChildren(h('main', { class: 'wrap' }, h('section', { class: 'card' }, h('h2', { text: 'Open ShiftRhythm directly' }),
        h('p', { text: 'For your safety, ShiftRhythm doesn\u2019t run inside other websites. Open it in its own tab instead.' }))));
      return;
    }
    root.SR.capture.init();
    if (root.SR.sync && !(root.claude && typeof root.claude.use === 'function')) {
      root.SR.sync.init({
        getState: function () { return state; },
        setState: function (s) {
          var keepSetup = state.setupDone;
          state = St.clean(s); state.setupDone = state.setupDone || keepSetup;
          St.save(state); replan(); render();
        },
        clean: function (raw) { return St.clean(raw); },
        onStatus: function () { var el = doc.getElementById('syncStatus'); if (el) el.textContent = syncStatusText(); }
      });
    }
    var tb = doc.getElementById('themeBtn');
    if (tb) tb.addEventListener('click', cycleTheme);
    replan();
    render();
    root.addEventListener('hashchange', render);
    doc.addEventListener('pointerdown', function () {
      Al.unlock();
      // Sound is now allowed: drop the "turn on sound" banner without redrawing the page.
      setTimeout(function () { if (Al.unlocked()) doc.querySelectorAll('[data-banner="sound"]').forEach(function (el) { el.remove(); }); }, 100);
    }, { once: true });
    doc.addEventListener('visibilitychange', function () { if (!doc.hidden) { tick(); render(); } });
    setInterval(tick, 1000 * 5);
    setInterval(function () { if (route() === 'today' && !doc.querySelector('.modal-bg') && !doc.activeElement.matches('input,select,textarea')) render(); }, 60000);
    if ('serviceWorker' in root.navigator && /^https?:$/.test(root.location.protocol) && doc.querySelector('link[rel=manifest]')) {
      root.navigator.serviceWorker.register('sw.js').catch(function () {});
    }
  }
  boot();
})(this);
