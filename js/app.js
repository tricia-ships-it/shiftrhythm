/*
 * ShiftRhythm UI. Plain JavaScript, no frameworks, no network.
 * All user text is rendered with textContent, never innerHTML.
 */
(function (root) {
  'use strict';
  var Sch = root.SR.scheduler, St = root.SR.store, Al = root.SR.alarm, Ics = root.SR.ics;
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
  var SHORT = { day: 'Day', night: 'Night', off: 'Off' };
  function save() { if (!St.save(state)) toast('Could not save. Your browser storage may be full or blocked.'); }
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

  // ---------- planning ----------
  function replan() {
    var t = todayIso();
    St.prune(state, t);
    plan = Sch.buildPlan(state, { today: t, nowMin: nowMin() });
    planDay = t;
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
        status: 'done', at: Date.now(), title: title, taskId: taskId, when: first && first.during ? 'during' : 'outside',
        date: date, start: start, end: end
      };
      if (key.slice(0, 2) === 'o:') state.oneoffs.forEach(function (o) { if ('o:' + o.id === key) o.done = true; });
    }, 'Nice work. Plan updated.');
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
    var main = doc.getElementById('main');
    main.replaceChildren();
    doc.querySelectorAll('nav.tabs a').forEach(function (a) { a.setAttribute('aria-current', a.getAttribute('href') === '#' + route() ? 'page' : 'false'); });
    var t = todayIso();
    var type = (state.shifts[t]) || 'off';
    var chip = doc.getElementById('todayChip');
    var kind = plan && plan.days[0] ? plan.days[0].kind : type;
    chip.className = 'chip ' + type; chip.textContent = 'Today: ' + (kind === 'recovery' ? 'Off day after a shift' : SHIFT_LABEL[type]);

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
      box.append(h('div', { class: 'banner' }, h('span', { text: 'Tap once to let ShiftRhythm play its switch-task chime.' }),
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
      sub.push(dur(b.minutes));
      if (b.part) sub.push('part ' + b.part);
      if (b.during) sub.push('during shift');
      if (b.done) sub.push('done');
    } else if (b.kind !== 'break') sub.push(dur(b.minutes));
    var badges = [];
    if (b.conflict) badges.push(h('span', { class: 'chip warn', text: 'Clashes' }));
    if (b.overdue) badges.push(h('span', { class: 'chip warn', text: 'Overdue' }));
    var acts = h('div', { class: 'acts' });
    if (b.kind === 'task' && opts.actions) {
      if (b.done) acts.append(h('button', { class: 'btn small', type: 'button', onclick: function () { undo(b.key); } }, 'Undo'));
      else {
        acts.append(h('button', { class: 'btn small primary', type: 'button', onclick: function () { markDone(b.key); }, 'aria-label': 'Done: ' + b.title }, 'Done'));
        acts.append(h('button', { class: 'btn small', type: 'button', onclick: function () { skip(b.key); } }, b.source === 'oneoff' ? 'Tomorrow' : 'Skip'));
      }
    }
    return h('div', { class: cls },
      h('span', { class: 'time', text: timeTxt }),
      h('div', {}, h('div', { class: 'title' }, b.kind === 'break' ? 'Break' : b.title, ' ', badges), sub.length ? h('div', { class: 'sub', text: sub.join(' · ') }) : null),
      acts);
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

    var list = h('div', { class: 'timeline' });
    if (!blocks.length) list.append(h('div', { class: 'empty', text: 'Nothing planned today.' }));
    blocks.forEach(function (b) { list.append(blockRow(b, { actions: true })); });
    var todayTasks = blocks.filter(function (b) { return b.kind === 'task'; });
    var doneN = todayTasks.filter(function (b) { return b.done; }).length;

    var timeline = h('section', { class: 'card', 'aria-labelledby': 'todayH' },
      h('div', { class: 'spread' }, h('h2', { id: 'todayH', text: dayLabel(t, { weekday: 'long', day: 'numeric', month: 'long' }) }),
        h('span', { class: 'muted small', text: doneN + ' of ' + todayTasks.length + ' task blocks done' })),
      list);

    var side = h('div', { class: 'stack' }, nowCard, root.SR.capture.renderBriefing(), renderUnplaced(),
      h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: function () { replan(); render(); toast('Plan recalculated from now.'); } }, 'Recalculate')));
    return h('div', { class: 'stack' }, quick, h('div', { class: 'grid2' }, timeline, side));
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
      var card = h('section', { class: 'card dayc' + (d.date === t ? ' today' : '') });
      card.append(h('div', { class: 'spread' }, h('strong', { text: dayLabel(d.date) }), h('span', { class: 'chip ' + d.type, text: d.kind === 'recovery' ? 'Off \u00b7 after shift' : SHORT[d.type] })));
      var items = plan.blocks.filter(function (b) { return b.date === d.date && b.kind !== 'break'; });
      if (!items.length) card.append(h('div', { class: 'empty', text: 'Nothing planned' }));
      items.forEach(function (b) {
        card.append(h('div', { class: 'mini k-' + b.kind + (b.during ? ' during' : '') + (b.done ? ' done' : '') },
          h('span', { class: 't', text: b.startTime + '–' + b.endTime }),
          h('span', { text: b.title + (b.part ? ' (' + b.part + ')' : '') + (b.conflict ? ' ⚠' : '') })));
      });
      card.append(h('div', { class: 'muted small', text: dur(d.taskMinutes) + ' of tasks' }));
      grid.append(card);
    });
    return h('div', { class: 'stack' },
      h('div', { class: 'spread' }, h('h2', { text: 'Your next ' + plan.days.length + ' days' }),
        h('div', { class: 'row' },
          h('button', { class: 'btn', type: 'button', onclick: function () { replan(); render(); toast('Plan recalculated.'); } }, 'Recalculate'),
          h('button', { class: 'btn', type: 'button', onclick: exportIcs }, 'Send to phone calendar (.ics)'))),
      renderUnplaced(), grid);
  }

  // ---------- tasks ----------
  function describeTask(t, oneoff) {
    var bits = [dur(t.durationMin)];
    if (!oneoff) bits.unshift(t.times + '× per ' + t.per);
    if (oneoff && t.date) bits.push('on ' + dayLabel(t.date));
    if (oneoff && t.due) bits.push('due ' + dayLabel(t.due));
    bits.push(t.when === 'during' ? 'during shift' : t.when === 'either' ? 'during or outside shift' : 'outside shift');
    var rules = [];
    var NAMES = { off: 'normal off days', recovery: 'off days after a shift', day: 'day-shift days', night: 'night-shift days' };
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
          h('div', { class: 'row' },
            h('button', { class: 'btn', type: 'button', onclick: addExamples }, 'Add examples'),
            h('button', { class: 'btn primary', type: 'button', onclick: function () { openEditor(null, false); } }, 'Add recurring task'))),
        h('p', { class: 'small muted', text: 'These repeat every day, week or month. ShiftRhythm places them around your shifts automatically.' }),
        rec),
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

  var EXAMPLES = [
    { title: 'Workout', durationMin: 45, per: 'week', times: 4, keepWhole: true, timeOfDay: 'morning', allow: { off: 'yes', day: 'no', night: 'yes' } },
    { title: 'Singing practice', durationMin: 10, per: 'day', times: 1, allow: { off: 'yes', day: 'yes', night: 'yes' } },
    { title: 'Choir rehearsal', durationMin: 60, per: 'week', times: 2, keepWhole: true, allow: { off: 'yes', day: 'weekend', night: 'weekend' }, when: 'either' },
    { title: 'Shoot and edit content', durationMin: 120, per: 'week', times: 1, allow: { off: 'yes', day: 'no', night: 'no' } },
    { title: 'Plan community outreach', durationMin: 60, per: 'month', times: 2, allow: { off: 'yes', day: 'no', night: 'no' } },
    { title: 'Security assessment session (work)', durationMin: 90, per: 'week', times: 1, when: 'during', allow: { off: 'no', day: 'yes', night: 'yes' } },
    { title: 'Data protection documentation (work)', durationMin: 60, per: 'week', times: 2, when: 'during', allow: { off: 'no', day: 'yes', night: 'yes' } },
    { title: 'Weekly review and planning', durationMin: 30, per: 'week', times: 1, priority: 1, allow: { off: 'yes', day: 'no', night: 'no' } }
  ];
  function addExamples() {
    change(function () {
      EXAMPLES.forEach(function (e) {
        if (state.recurring.some(function (r) { return r.title === e.title; })) return;
        state.recurring.push(St.cleanTask(Object.assign({ id: St.uid() }, e), false));
      });
    }, 'Examples added. Edit or pause any of them.');
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
      h('option', { value: 'outside', selected: t.when === 'outside' }, 'Outside my shift (personal time)'),
      h('option', { value: 'during', selected: t.when === 'during' }, 'During my shift (work task)'),
      h('option', { value: 'either', selected: t.when === 'either' }, 'Either'));
    function ruleSel(k, label, opts) {
      return h('label', { class: 'field' }, h('span', {}, label),
        f['allow_' + k] = h('select', { id: 'edAllow' + k }, opts.map(function (o) { return h('option', { value: o[0], selected: t.allow[k] === o[0] }, o[1]); })));
    }
    if (!t.allow.recovery) t.allow.recovery = t.allow.off;
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
      t.allow = { off: f.allow_off.value, recovery: f.allow_recovery.value, day: f.allow_day.value, night: f.allow_night.value };
      t.timeOfDay = f.tod.value; t.fixedTime = f.fixed.value; t.keepWhole = f.whole.checked; t.priority = Number(f.prio.value);
      var clean = St.cleanTask(t, oneoff);
      if (t.when === 'during' && clean.allow.day === 'no' && clean.allow.night === 'no') { err.textContent = 'A work task needs at least one kind of shift allowed.'; return; }
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
      h('label', { class: 'field' }, h('span', {}, 'Where it happens'), f.when),
      h('h3', { text: 'Allowed on' }),
      h('div', { class: 'fields' },
        ruleSel('off', 'Normal off days', [['yes', 'Yes'], ['no', 'No'], ['weekend', 'Weekends only']]),
        ruleSel('recovery', 'Off day right after a shift', [['yes', 'Yes'], ['no', 'No'], ['weekend', 'Weekends only']]),
        ruleSel('day', 'Day-shift days', [['yes', 'Yes'], ['no', 'No'], ['weekend', 'Weekends only']]),
        ruleSel('night', 'Night-shift days', [['yes', 'Yes'], ['no', 'No'], ['weekend', 'Weekends only']])),
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
  function cycle(d) {
    var order = ['off', 'day', 'night'];
    var cur = state.shifts[d] || 'off';
    change(function () {
      var nx = order[(order.indexOf(cur) + 1) % 3];
      if (nx === 'off') delete state.shifts[d]; else state.shifts[d] = nx;
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
        var type = state.shifts[d] || 'off';
        cal.append(h('button', {
          type: 'button', class: type + (d.slice(0, 7) !== ui.calMonth ? ' out' : '') + (d === t ? ' today' : ''),
          'aria-label': dayLabel(d, { weekday: 'long', day: 'numeric', month: 'long' }) + ': ' + SHIFT_LABEL[type], onclick: function () { cycle(d); }
        }, h('span', { class: 'n', text: String(Number(d.slice(8))) }), h('span', { class: 's', text: type === 'off' ? 'Off' : SHORT[type] })));
      })(Sch.addDays(gridStart, i));
    }
    function shiftMonth(n) { var p = ui.calMonth.split('-').map(Number); var d = new Date(p[0], p[1] - 1 + n, 1); ui.calMonth = d.getFullYear() + '-' + pad(d.getMonth() + 1); render(); }
    return h('div', { class: 'grid2' },
      h('section', { class: 'card', 'aria-labelledby': 'calH' },
        h('div', { class: 'spread' },
          h('h2', { id: 'calH', text: dayLabel(first, { month: 'long', year: 'numeric' }) }),
          h('div', { class: 'row' }, h('button', { class: 'btn small', type: 'button', onclick: function () { shiftMonth(-1); } }, '‹ Prev'), h('button', { class: 'btn small', type: 'button', onclick: function () { shiftMonth(1); } }, 'Next ›'))),
        h('p', { class: 'small muted', text: 'Tap a day to switch Off → Day → Night.' }),
        cal),
      h('div', { class: 'stack' },
        h('section', { class: 'card', 'aria-labelledby': 'rosH' }, h('h2', { id: 'rosH', text: 'Import this month\u2019s roster' }), root.SR.capture.renderRosterImport()),
        h('section', { class: 'card', 'aria-labelledby': 'patH' }, h('details', {}, h('summary', { id: 'patH', text: 'Or fill from a repeating rotation' }), renderPatternTool())),
        h('section', { class: 'card', 'aria-labelledby': 'hrsH' }, h('h2', { id: 'hrsH', text: 'Shift hours' }), shiftHoursFields())));
  }
  function shiftHoursFields() {
    var s = state.settings.shifts;
    function tf(id, k, side) {
      return h('input', { type: 'time', id: id, value: s[k][side], onchange: function (e) { var v = e.target.value; if (v) change(function () { state.settings.shifts[k][side] = v; }, 'Shift hours saved.'); } });
    }
    return h('div', { class: 'fields' },
      h('label', { class: 'field' }, h('span', {}, 'Day shift starts'), tf('dS', 'day', 'start')),
      h('label', { class: 'field' }, h('span', {}, 'Day shift ends'), tf('dE', 'day', 'end')),
      h('label', { class: 'field' }, h('span', {}, 'Night shift starts'), tf('nS', 'night', 'start')),
      h('label', { class: 'field' }, h('span', {}, 'Night shift ends'), tf('nE', 'night', 'end')));
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
    var ipass = h('input', { type: 'password', id: 'imPass', placeholder: 'Passphrase (if encrypted)', autocomplete: 'off' });
    var file = h('input', { type: 'file', id: 'imFile', accept: '.json,.srbackup,application/json' });
    var reset = h('button', { class: 'btn danger', type: 'button', onclick: function () {
      if (!reset.dataset.armed) { reset.dataset.armed = '1'; reset.textContent = 'Tap again to erase everything'; return; }
      state = St.blank(); save(); replan(); root.location.hash = '#today'; render(); toast('All data erased from this device.');
    } }, 'Erase all data');

    return h('div', { class: 'grid2' },
      h('div', { class: 'stack' },
        h('section', { class: 'card' }, h('h2', { text: 'Focus rhythm' }),
          h('p', { class: 'small muted', text: 'How long you can focus before a break. Every task is split into sessions of this length, with a break after each one.' }),
          rhythmPicker()),
        h('section', { class: 'card' }, h('h2', { text: 'Sleep, travel and limits' }),
          h('div', { class: 'fields' },
            h('label', { class: 'field' }, h('span', {}, 'Wake on normal off days'), wake),
            timeField('wakeAD', 'Wake after a day shift', 'wakeAfterDayShift'),
            timeField('bed', 'Usual bedtime', 'bedtime'),
            timeField('pnS', 'After a night shift, rest from', 'postNightSleep'),
            timeField('pnE', '\u2026until', 'postNightWake'),
            numField('sleepH', 'Least sleep before a shift', 'sleepHours', 4, 12, 0.5, 'hours'),
            numField('prep', 'Getting ready', 'prepMin', 0, 180, 5, 'min'),
            numField('commute', 'Travel each way', 'commuteMin', 0, 240, 5, 'min'),
            numField('nap', 'Nap before night shifts', 'napMin', 0, 240, 15, 'min'),
            numField('handover', 'Settling in at shift start', 'handoverMin', 0, 180, 5, 'min'),
            numField('endBuf', 'Handover at shift end', 'shiftEndBufferMin', 0, 180, 5, 'min'),
            numField('capOff', 'Max task time, off days', 'capOffDay', 0, 960, 15, 'min'),
            numField('capRec', 'Max task time, off day after a shift', 'capRecoveryDay', 0, 960, 15, 'min'),
            numField('capShift', 'Max task time, shift days', 'capShiftDay', 0, 480, 15, 'min')),
          h('div', { class: 'fields' }, numField('maxSession', 'Longest sitting for a project step', 'maxSession', 30, 480, 15, 'min')),
          h('p', { class: 'small muted', text: 'The shift-day limit protects you after a long shift. Work tasks done during the shift do not count towards it.' })),
        h('section', { class: 'card' }, h('h2', { text: 'Shift hours' }), shiftHoursFields()),
        h('section', { class: 'card' }, h('h2', { text: 'Week' }),
          h('label', { class: 'field' }, h('span', {}, 'Week starts on'), weekStart),
          h('div', { class: 'field' }, h('span', { class: 'small muted' }, 'Weekend days (for "weekends only" rules)'), weekendBox))),
      h('div', { class: 'stack' },
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
          h('h3', { text: 'Restore' }), file, ipass,
          h('button', { class: 'btn', type: 'button', onclick: function () {
            var fl = file.files && file.files[0];
            if (!fl) { toast('Choose a backup file first.'); return; }
            if (fl.size > 5 * 1024 * 1024) { toast('That file is too large to be a backup.'); return; }
            fl.text().then(function (txt) { return St.importBackup(txt, ipass.value); }).then(function (s) {
              state = s; state.setupDone = true; save(); replan(); render(); toast('Backup restored.');
            }, function (e) { toast(e.message); });
          } }, 'Restore backup'),
          h('p', { class: 'small muted', text: 'Restoring replaces everything on this device.' })),
        h('section', { class: 'card' }, h('h2', { text: 'Privacy' }),
          h('p', { class: 'small', text: 'ShiftRhythm makes no network requests. There is no account, server, analytics or tracking. The page blocks all outside connections, so even a bug cannot send your data anywhere.' }),
          h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: function () { state.setupDone = false; ui.wizardStep = 0; save(); render(); } }, 'Run setup again'), reset))));
  }

  function exportIcs() {
    var txt = Ics.build(plan, ['task', 'break', 'prep', 'commute', 'shift'], state.settings.headsUpMin);
    download('shiftrhythm-' + plan.from + '-to-' + plan.to + '.ics', txt, 'text/calendar');
    toast('Calendar file saved. Open it to add the plan to your calendar.');
  }

  // ---------- first-run setup ----------
  function renderWizard() {
    var steps = ['Welcome', 'Your shifts', 'Sleep and rhythm', 'Recurring tasks', 'Alarms'];
    var s = ui.wizardStep;
    var bar = h('div', { class: 'steps', 'aria-hidden': 'true' }, steps.map(function (_, i) { return h('i', { class: i <= s ? 'on' : '' }); }));
    function nav(canBack, nextLabel, onNext) {
      return h('div', { class: 'spread' },
        canBack ? h('button', { class: 'btn', type: 'button', onclick: function () { ui.wizardStep--; render(); } }, 'Back') : h('span'),
        h('button', { class: 'btn primary', type: 'button', onclick: onNext || function () { ui.wizardStep++; render(); } }, nextLabel || 'Next'));
    }
    var body;
    if (s === 0) {
      body = [h('h2', { text: 'A planner that follows your shifts' }),
        h('p', { text: 'Most planners assume you wake at 7 and work 9 to 5. ShiftRhythm starts from your rota instead. Tell it your shifts and the things you want to do regularly, and it builds each day and week around your work, your sleep and your focus rhythm. It rings a soft chime when it is time to switch.' }),
        h('p', { class: 'small muted', text: 'Everything stays on this device. No account, no server, no tracking.' }),
        nav(false, 'Get started')];
    } else if (s === 1) {
      body = [h('h2', { text: 'Your shifts' }), shiftHoursFields(),
        h('div', { class: 'fields' }, numField('wCommute', 'Travel each way', 'commuteMin', 0, 240, 5, 'min')),
        h('h3', { text: 'This month\u2019s roster' }), root.SR.capture.renderRosterImport(),
        h('details', {}, h('summary', { text: 'Or use a repeating rotation' }), renderPatternTool()),
        h('p', { class: 'small muted', text: 'Irregular rota? Skip this and tap days on the Shifts calendar later.' }),
        nav(true)];
    } else if (s === 2) {
      body = [h('h2', { text: 'Sleep and focus rhythm' }),
        h('div', { class: 'fields' }, numField('wSleep', 'Sleep', 'sleepHours', 4, 12, 0.5, 'hours'),
          h('label', { class: 'field' }, h('span', {}, 'Wake time on off days'), h('input', { type: 'time', id: 'wWake', value: state.settings.wakeTime, onchange: function (e) { var v = e.target.value; if (v) change(function () { state.settings.wakeTime = v; }); } })),
          numField('wNap', 'Nap before night shifts', 'napMin', 0, 240, 15, 'min')),
        h('h3', { text: 'How long can you focus before a break?' }), rhythmPicker(),
        h('div', { class: 'fields' }, numField('wCapOff', 'Max task time, off days', 'capOffDay', 0, 960, 15, 'min'), numField('wCapShift', 'Max task time, shift days', 'capShiftDay', 0, 480, 15, 'min')),
        nav(true)];
    } else if (s === 3) {
      var list = h('div', {});
      if (!state.recurring.length) list.append(h('div', { class: 'empty', text: 'Nothing yet. Add your own, or start from the examples and edit them.' }));
      state.recurring.forEach(function (t) {
        list.append(h('div', { class: 'item' }, h('div', { class: 'body' }, h('span', { class: 'title', text: t.title }), h('span', { class: 'muted small', text: describeTask(t, false) })),
          h('button', { class: 'btn small', type: 'button', onclick: function () { openEditor(t, false); } }, 'Edit')));
      });
      body = [h('h2', { text: 'Things you do regularly' }),
        h('p', { class: 'small muted', text: 'Workouts, practice, rehearsals, content, admin. For each one, say how often, how long, and which days it is allowed on.' }),
        h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'button', onclick: function () { openEditor(null, false); } }, 'Add a task'),
          h('button', { class: 'btn', type: 'button', onclick: addExamples }, 'Add examples')),
        list, nav(true)];
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
  var TUNE = { task: 'focus', break: 'break', commute: 'travel', prep: 'focus', nap: 'sleep', sleep: 'sleep' };
  function alarmText(b) {
    if (b.kind === 'task') return { title: 'Time for: ' + b.title + (b.part ? ' (' + b.part + ')' : ''), body: b.startTime + '–' + b.endTime + ' · ' + dur(b.minutes) + ' focus' };
    if (b.kind === 'break') return { title: 'Break time', body: 'Step away for ' + dur(b.minutes) + '. Stretch, drink some water.' };
    if (b.kind === 'commute') return { title: b.title, body: 'Leave now · ' + b.startTime };
    if (b.kind === 'prep') return { title: 'Time to get up and get ready', body: 'Leave for work at ' + b.endTime + '.' };
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
    var box = h('div', { class: 'alarm', role: 'alertdialog', 'aria-labelledby': 'alT' },
      h('div', { class: 'big', id: 'alT', text: txt.title }), h('div', { text: txt.body }),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', type: 'button', onclick: closeAlarm }, 'Got it'),
        h('button', { class: 'btn', type: 'button', onclick: function () { closeAlarm(); setTimeout(function () { ring(b, false); }, 5 * 60000); toast('I’ll remind you again in 5 minutes.'); } }, 'Snooze 5 min')));
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
    if (todayIso() !== planDay) { replan(); render(); }
    var now = nowAbsPrecise();
    var hu = state.settings.headsUpMin;
    plan.blocks.forEach(function (b) {
      if (b.done || !TUNE[b.kind]) return;
      if (now >= b.s && now < b.s + 3 && !fired[b.id]) { markFired(b.id); ring(b, false); }
      else if (hu > 0 && (b.kind === 'task' || b.kind === 'commute') && now >= b.s - hu && now < b.s - hu + 3 && !fired['h:' + b.id]) { markFired('h:' + b.id); ring(b, true); }
    });
    var cd = doc.getElementById('countdown');
    if (cd) cd.textContent = countdownText(Number(cd.dataset.at) - now);
  }

  // ---------- shared with capture.js ----------
  root.SR.app = {
    h: h, state: function () { return state; }, plan: function () { return plan; }, change: change, render: render, toast: toast,
    todayIso: todayIso, nowMin: nowMin, dur: dur, dayLabel: dayLabel
  };

  // ---------- boot ----------
  function boot() {
    root.SR.capture.init();
    replan();
    render();
    root.addEventListener('hashchange', render);
    doc.addEventListener('pointerdown', function (e) {
      Al.unlock();
      var onBanner = e.target.closest && e.target.closest('.banner');
      if (state.setupDone && !onBanner && doc.querySelector('.banner') && !e.target.closest('input,select,textarea,.modal-bg')) setTimeout(render, 50);
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
