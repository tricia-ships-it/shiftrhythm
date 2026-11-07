/*
 * ShiftRhythm smart capture, daily briefing and projects.
 *
 * Say or type what's coming up -> ShiftRhythm works out each task, breaks big ones
 * into steps, spreads them before the deadline and checks that they fit.
 * All of this runs on your device. Two optional extras only appear when the app is
 * opened inside Claude: "Refine with Claude" and "Ask Claude about my day".
 */
(function (root) {
  'use strict';
  var A = function () { return root.SR.app; }; // filled in by app.js
  var Sch = root.SR.scheduler, Smart = root.SR.smart, St = root.SR.store;
  var ui = { proposals: [], text: '', listening: false, voiceHelp: '', claude: null, advice: '', adviceBusy: false, refining: '' };
  var Rec = root.SpeechRecognition || root.webkitSpeechRecognition;
  var rec = null;

  function h() { return A().h.apply(null, arguments); }
  function S() { return A().state(); }

  // ---------- Claude (only inside Claude) ----------
  function init() {
    if (root.claude && typeof root.claude.use === 'function') {
      root.claude.use('sample').then(function (s) { if (s) { ui.claude = s; A().render(); } }).catch(function () {});
    }
  }

  // ---------- capture panel ----------
  function renderCapture() {
    var ta = h('textarea', {
      id: 'capture', rows: '3', value: ui.text, 'aria-label': 'What is coming up',
      placeholder: 'Say or type what\u2019s coming up. For example: Plan the Builders Circle event by 28 Nov, about 8 hours. Call the venue tomorrow at 3pm. Gym 3 times a week.',
      oninput: function (e) { ui.text = e.target.value; },
      onkeydown: function (e) { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) understand(); }
    });
    var mic = h('button', { class: 'btn mic', type: 'button', id: 'micBtn', 'aria-pressed': String(ui.listening), onclick: toggleMic },
      h('span', { class: 'dot', 'aria-hidden': 'true' }), ui.listening ? 'Listening\u2026 tap to stop' : 'Speak');
    var card = h('section', { class: 'card capture', 'aria-labelledby': 'capH' },
      h('h3', { id: 'capH', text: 'What\u2019s coming up?' }), ta,
      h('div', { class: 'row' }, mic,
        h('button', { class: 'btn primary', type: 'button', onclick: understand }, 'Plan it for me'),
        ui.proposals.length ? h('button', { class: 'btn link', type: 'button', onclick: function () { ui.proposals = []; A().render(); } }, 'Clear') : null));
    if (ui.voiceHelp) card.append(voiceHelp());
    if (ui.proposals.length) card.append(h('div', { class: 'proposals' }, ui.proposals.map(renderProposal)));
    if (ui.proposals.length > 1) card.append(h('button', { class: 'btn primary', type: 'button', onclick: addAll }, 'Add all ' + ui.proposals.length + ' to my plan'));
    return card;
  }

  function understand() {
    var text = (ui.text || '').trim();
    if (!text) { A().toast('Say or type something first.'); var el = root.document.getElementById('capture'); if (el) el.focus(); return; }
    var items = Smart.parse(text, A().todayIso(), S().settings);
    ui.proposals = items.map(toProposal);
    A().render();
  }

  function toProposal(p) {
    var pr = {
      id: St.uid(), kind: p.recurrence ? 'recurring' : p.isProject ? 'project' : 'task',
      title: p.title, minutes: p.isProject ? p.totalMin : p.durationMin, due: p.due, date: p.date, fixedTime: p.fixedTime,
      when: p.when, priority: p.priority, type: p.type, typeLabel: p.typeLabel, recurrence: p.recurrence, guessed: p.guessed
    };
    if (pr.kind === 'project') rebuild(pr);
    else if (pr.kind === 'task') pr.check = dryRunTask(pr);
    return pr;
  }

  function startDay() {
    var t = A().todayIso();
    return A().nowMin() > 20 * 60 ? Sch.addDays(t, 1) : t;
  }
  function rebuild(pr, custom) {
    var b = Smart.breakdown({ title: pr.title, type: pr.type, totalMin: pr.minutes, due: pr.due },
      { today: A().todayIso(), start: startDay(), maxSession: S().settings.maxSession, steps: custom });
    pr.steps = b.steps; pr.finishBy = b.finishBy; pr.typeLabel = pr.typeLabel || b.typeLabel;
    pr.check = dryRunProject(pr);
  }
  function projectTasks(pr, pid) {
    pid = pid || ('p' + St.uid().slice(0, 10));
    return pr.steps.map(function (s, i) {
      return St.cleanTask({
        id: St.uid(), title: s.title + ' \u00b7 ' + shortTitle(pr.title), durationMin: s.minutes, after: s.after, due: s.due,
        deadline: pr.due, project: pid, projectTitle: pr.title, step: i, when: pr.when, priority: pr.priority,
        allow: pr.when === 'during' ? { off: 'no', day: 'yes', night: 'yes' } : undefined
      }, true);
    });
  }
  function shortTitle(t) { return t.length > 38 ? t.slice(0, 36).trim() + '\u2026' : t; }

  // Try the plan with this project added, without saving anything.
  function trial(extraOneoffs, days) {
    var st = JSON.parse(JSON.stringify(S()));
    st.oneoffs = st.oneoffs.concat(extraOneoffs);
    return Sch.buildPlan(st, { today: A().todayIso(), nowMin: A().nowMin(), days: days });
  }
  function dryRunProject(pr) {
    var t = A().todayIso();
    var tasks = projectTasks(pr, 'trial');
    var days = Math.max(1, Sch.diffDays(t, pr.due) + 1);
    var p = trial(tasks, days);
    var placements = tasks.map(function (o) {
      var b = p.blocks.filter(function (x) { return x.key === 'o:' + o.id; })[0];
      return b ? { date: b.date, time: b.startTime } : null;
    });
    var missing = 0;
    tasks.forEach(function (o, i) { if (!placements[i]) missing += o.durationMin; });
    var suggestion = '';
    if (missing) {
      // Smallest later deadline that would fit everything (checks up to 6 weeks out).
      for (var extra = 2; extra <= 42; extra += 2) {
        var d2 = Sch.addDays(pr.due, extra);
        var b2 = Smart.breakdown({ title: pr.title, type: pr.type, totalMin: pr.minutes, due: d2 }, { today: t, start: startDay(), maxSession: S().settings.maxSession, steps: pr.steps.map(function (s) { return { title: s.title, minutes: s.minutes }; }) });
        var tasks2 = projectTasks({ steps: b2.steps, title: pr.title, due: d2, when: pr.when, priority: pr.priority }, 'trial');
        var p2 = trial(tasks2, Sch.diffDays(t, d2) + 1);
        if (!p2.unplaced.some(function (u) { return /^o:/.test(u.key) && tasks2.some(function (o) { return 'o:' + o.id === u.key; }); })) { suggestion = d2; break; }
      }
    }
    return { placements: placements, missing: missing, suggestion: suggestion };
  }
  function dryRunTask(pr) {
    var o = singleTask(pr);
    var p = trial([o]);
    var b = p.blocks.filter(function (x) { return x.key === 'o:' + o.id; })[0];
    return b ? { date: b.date, time: b.startTime } : null;
  }
  function singleTask(pr) {
    return St.cleanTask({ id: St.uid(), title: pr.title, durationMin: pr.minutes, date: pr.date, due: pr.due, fixedTime: pr.fixedTime, when: pr.when, priority: pr.priority,
      allow: pr.when === 'during' ? { off: 'no', day: 'yes', night: 'yes' } : undefined }, true);
  }

  function field(label, input) { return h('label', { class: 'field' }, h('span', {}, label), input); }
  function whenSelect(pr, onchange) {
    return h('select', { onchange: function (e) { pr.when = e.target.value; onchange(); } },
      h('option', { value: 'outside', selected: pr.when === 'outside' }, 'Personal time'),
      h('option', { value: 'during', selected: pr.when === 'during' }, 'During my shift'));
  }
  function remove(pr) { ui.proposals = ui.proposals.filter(function (x) { return x !== pr; }); A().render(); }
  function placementText(pl) { return pl ? A().dayLabel(pl.date) + ', ' + pl.time : 'won\u2019t fit'; }

  function renderProposal(pr) {
    var box = h('div', { class: 'proposal' });
    var redo = function () { if (pr.kind === 'project') rebuild(pr); else if (pr.kind === 'task') pr.check = dryRunTask(pr); A().render(); };
    var title = h('input', { type: 'text', value: pr.title, 'aria-label': 'Title', onchange: function (e) { pr.title = e.target.value.trim() || pr.title; redo(); } });

    if (pr.kind === 'project') {
      var hours = h('input', { type: 'number', min: '0.5', max: '200', step: '0.5', value: String(Math.round(pr.minutes / 30) / 2), onchange: function (e) { pr.minutes = Math.max(30, Math.round(Number(e.target.value) * 60) || pr.minutes); redo(); } });
      var due = h('input', { type: 'date', value: pr.due, onchange: function (e) { if (e.target.value) { pr.due = e.target.value; redo(); } } });
      box.append(
        h('div', { class: 'spread' }, h('span', { class: 'chip work', text: 'Project \u00b7 ' + pr.typeLabel }), h('button', { class: 'btn link', type: 'button', onclick: function () { remove(pr); } }, 'Discard')),
        title,
        h('div', { class: 'fields' }, field('Total time (hours)' + (pr.guessed && pr.guessed.duration ? ', estimated' : ''), hours), field('Deadline', due), field('Where', whenSelect(pr, redo))),
        h('p', { class: 'small muted', text: pr.steps.length + ' steps, finishing by ' + A().dayLabel(pr.finishBy) + ' to leave some slack. Edit anything; times update as you go.' }));
      var list = h('div', { class: 'steps-list' });
      pr.steps.forEach(function (s, i) {
        var pl = pr.check.placements[i];
        list.append(h('div', { class: 'step' + (pl ? '' : ' nofit') },
          h('input', { type: 'text', value: s.title, 'aria-label': 'Step ' + (i + 1), onchange: function (e) { s.title = e.target.value.trim() || s.title; } }),
          h('input', { type: 'number', min: '15', max: '480', step: '15', value: String(s.minutes), 'aria-label': 'Minutes for step ' + (i + 1), onchange: function (e) { s.minutes = Math.max(15, Number(e.target.value) || s.minutes); rebuild(pr, pr.steps.map(function (x) { return { title: x.title, minutes: x.minutes }; })); pr.minutes = pr.steps.reduce(function (a, x) { return a + x.minutes; }, 0); A().render(); } }),
          h('span', { class: 'when small', text: placementText(pl) }),
          h('button', { class: 'x', type: 'button', 'aria-label': 'Remove step ' + (i + 1), onclick: function () {
            var rest = pr.steps.filter(function (_, j) { return j !== i; }).map(function (x) { return { title: x.title, minutes: x.minutes }; });
            if (!rest.length) { remove(pr); return; }
            rebuild(pr, rest); pr.minutes = pr.steps.reduce(function (a, x) { return a + x.minutes; }, 0); A().render();
          } }, '\u00d7')));
      });
      box.append(list);
      box.append(h('button', { class: 'btn small', type: 'button', onclick: function () {
        var cur = pr.steps.map(function (x) { return { title: x.title, minutes: x.minutes }; });
        cur.push({ title: 'New step', minutes: 30 });
        rebuild(pr, cur); pr.minutes += 30; A().render();
      } }, '+ Add step'));
      if (pr.check.missing) {
        box.append(h('div', { class: 'banner warn small' },
          h('span', { text: A().dur(pr.check.missing) + ' of this won\u2019t fit before the deadline with your current shifts and limits.' + (pr.check.suggestion ? ' It would all fit by ' + A().dayLabel(pr.check.suggestion) + '.' : '') }),
          pr.check.suggestion ? h('button', { class: 'btn small', type: 'button', onclick: function () { pr.due = pr.check.suggestion; rebuild(pr, pr.steps.map(function (x) { return { title: x.title, minutes: x.minutes }; })); A().render(); } }, 'Use that deadline') : null));
      } else {
        box.append(h('p', { class: 'small ok', text: 'Everything fits before the deadline.' }));
      }
      var acts = h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'button', onclick: function () { addProject(pr); } }, 'Add project to my plan'));
      if (ui.claude) acts.append(h('button', { class: 'btn', type: 'button', disabled: ui.refining === pr.id, onclick: function () { refine(pr); } }, ui.refining === pr.id ? 'Asking Claude\u2026' : 'Refine steps with Claude'));
      box.append(acts);
    } else if (pr.kind === 'recurring') {
      var times = h('input', { type: 'number', min: '1', max: '14', value: String(pr.recurrence.times), onchange: function (e) { pr.recurrence.times = Math.max(1, Math.min(14, Number(e.target.value) || 1)); } });
      var per = h('select', { onchange: function (e) { pr.recurrence.per = e.target.value; } }, ['day', 'week', 'month'].map(function (p) { return h('option', { value: p, selected: pr.recurrence.per === p }, 'per ' + p); }));
      var mins = h('input', { type: 'number', min: '5', max: '480', step: '5', value: String(pr.minutes), onchange: function (e) { pr.minutes = Math.max(5, Number(e.target.value) || pr.minutes); } });
      var wd = pr.recurrence.weekdays.length ? ' on ' + pr.recurrence.weekdays.map(function (d) { return A().dayLabel(Sch.addDays('2026-11-08', d), { weekday: 'short' }); }).join(', ') : '';
      box.append(
        h('div', { class: 'spread' }, h('span', { class: 'chip off', text: 'Repeats' + wd }), h('button', { class: 'btn link', type: 'button', onclick: function () { remove(pr); } }, 'Discard')),
        title,
        h('div', { class: 'fields' }, field('Times', times), field('Every', per), field('Minutes each', mins), field('Where', whenSelect(pr, function () {}))),
        h('p', { class: 'small muted', text: 'You can set which days it\u2019s allowed on later, under Tasks.' }),
        h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'button', onclick: function () { addRecurring(pr); } }, 'Add as recurring task')));
    } else {
      var m2 = h('input', { type: 'number', min: '5', max: '600', step: '5', value: String(pr.minutes), onchange: function (e) { pr.minutes = Math.max(5, Number(e.target.value) || pr.minutes); redo(); } });
      var dd = h('input', { type: 'date', value: pr.date || pr.due || '', onchange: function (e) { if (pr.date || !pr.due) pr.date = e.target.value; else pr.due = e.target.value; redo(); } });
      var tm = h('input', { type: 'time', value: pr.fixedTime || '', onchange: function (e) { pr.fixedTime = e.target.value; redo(); } });
      box.append(
        h('div', { class: 'spread' }, h('span', { class: 'chip', text: 'Task' + (pr.priority === 1 ? ' \u00b7 urgent' : '') }), h('button', { class: 'btn link', type: 'button', onclick: function () { remove(pr); } }, 'Discard')),
        title,
        h('div', { class: 'fields' }, field('Minutes', m2), field(pr.due && !pr.date ? 'Due by' : 'Day', dd), field('At (optional)', tm), field('Where', whenSelect(pr, redo))),
        h('p', { class: 'small ' + (pr.check ? 'ok' : 'warn-text'), text: pr.check ? 'Will go in ' + placementText(pr.check) + '.' : 'No free slot in the next two weeks. Try fewer minutes or another day.' }),
        h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'button', onclick: function () { addTask(pr); } }, 'Add task')));
    }
    return box;
  }

  function addProject(pr, quiet) {
    var tasks = projectTasks(pr);
    A().change(function () { tasks.forEach(function (o) { S().oneoffs.push(o); }); }, quiet ? null : 'Project added: ' + tasks.length + ' steps spread over the next ' + Math.max(1, Sch.diffDays(A().todayIso(), pr.due) + 1) + ' days.');
    ui.proposals = ui.proposals.filter(function (x) { return x !== pr; });
    if (!quiet) A().render();
  }
  function addTask(pr, quiet) {
    var o = singleTask(pr);
    A().change(function () { S().oneoffs.push(o); }, quiet ? null : 'Added. Plan recalculated.');
    ui.proposals = ui.proposals.filter(function (x) { return x !== pr; });
    if (!quiet) A().render();
  }
  function addRecurring(pr, quiet) {
    var r = St.cleanTask({ id: St.uid(), title: pr.title, durationMin: pr.minutes, per: pr.recurrence.per, times: pr.recurrence.times, weekdays: pr.recurrence.weekdays, when: pr.when,
      allow: pr.when === 'during' ? { off: 'no', day: 'yes', night: 'yes' } : undefined }, false);
    A().change(function () { S().recurring.push(r); }, quiet ? null : 'Recurring task added.');
    ui.proposals = ui.proposals.filter(function (x) { return x !== pr; });
    if (!quiet) A().render();
  }
  function addAll() {
    var n = ui.proposals.length;
    ui.proposals.slice().forEach(function (pr) { if (pr.kind === 'project') addProject(pr, true); else if (pr.kind === 'recurring') addRecurring(pr, true); else addTask(pr, true); });
    ui.text = '';
    A().render();
    A().toast(n + ' items added. Plan recalculated.');
  }

  function refine(pr) {
    if (!ui.claude) return;
    ui.refining = pr.id; A().render();
    var prompt = 'Break this task into practical, specific steps for a busy shift worker.\n' +
      'Task: ' + pr.title + '\nKind of work: ' + pr.typeLabel + '\nTotal time to spend: ' + pr.minutes + ' minutes\n' +
      'Deadline: ' + pr.due + ' (today is ' + A().todayIso() + ')\n' + (pr.when === 'during' ? 'Done during work shifts.\n' : 'Done in personal time.\n') +
      'Rules: 4 to 10 steps in the order they should happen. Each title is a short instruction (at most 8 words) specific to this task. ' +
      'Minutes per step are multiples of 5, at least 15, adding up to about ' + pr.minutes + '.\n' +
      'Reply with only JSON like {"steps":[{"title":"Confirm venue and date","minutes":60}]}';
    ui.claude.json(prompt, { modelTier: 'quick' }).then(function (out) {
      var steps = (out && Array.isArray(out.steps) ? out.steps : []).filter(function (s) { return s && typeof s.title === 'string'; }).slice(0, 12)
        .map(function (s) { return { title: s.title.trim().slice(0, 80), minutes: Math.max(15, Math.min(480, Math.round((Number(s.minutes) || 30) / 5) * 5)) }; });
      if (steps.length < 2) throw { code: 'invalid_json' };
      rebuild(pr, steps);
      pr.minutes = pr.steps.reduce(function (a, x) { return a + x.minutes; }, 0);
      A().toast('Claude refined the steps.');
    }).catch(function (e) {
      A().toast(e && e.code === 'rate_limited' ? 'Claude is busy. Try again in a bit.' : 'Couldn\u2019t get steps from Claude. The built-in steps are still there.');
    }).then(function () { ui.refining = ''; A().render(); });
  }

  // ---------- voice ----------
  function toggleMic() {
    if (ui.listening) { try { rec && rec.stop(); } catch (e) {} return; }
    if (!Rec) { ui.voiceHelp = 'none'; A().render(); return; }
    if (!S().settings.voice) { ui.voiceHelp = 'optin'; A().render(); return; }
    startListening();
  }
  function startListening(lang) {
    var ta = root.document.getElementById('capture');
    var base = ui.text ? ui.text.replace(/\s*$/, ' ') : '';
    try {
      rec = new Rec(); rec.lang = lang || root.navigator.language || 'en-GB'; rec.interimResults = true; rec.continuous = true;
    } catch (e) { ui.voiceHelp = 'blocked'; A().render(); return; }
    rec.onresult = function (e) {
      var fin = '', mid = '';
      for (var i = 0; i < e.results.length; i++) { var tx = e.results[i][0].transcript; if (e.results[i].isFinal) fin += tx + ' '; else mid += tx; }
      ui.text = base + fin + mid;
      if (ta) ta.value = ui.text;
    };
    rec.onerror = function (e) {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      if (e.error === 'language-not-supported' && rec.lang !== 'en-US') { startListening('en-US'); return; }
      ui.voiceHelp = 'blocked';
    };
    rec.onend = function () {
      ui.listening = false;
      if (ui.text.trim() && !ui.voiceHelp) understand(); else A().render();
    };
    try { rec.start(); ui.listening = true; ui.voiceHelp = ''; A().render(); }
    catch (e) { ui.voiceHelp = 'blocked'; A().render(); }
  }
  function voiceHelp() {
    var box = h('div', { class: 'help' });
    if (ui.voiceHelp === 'optin') {
      box.append(h('strong', { text: 'Turn on voice typing?' }),
        h('p', { class: 'small', text: 'Your browser\u2019s voice typing sends the audio to its maker\u2019s speech service (Google for Chrome, Microsoft for Edge) to turn it into text. ShiftRhythm itself still sends nothing. It\u2019s off until you choose to use it.' }),
        h('div', { class: 'row' },
          h('button', { class: 'btn primary small', type: 'button', onclick: function () { A().change(function () { S().settings.voice = true; }); startListening(); } }, 'Turn on and start'),
          h('button', { class: 'btn small', type: 'button', onclick: function () { ui.voiceHelp = 'keyboard'; A().render(); } }, 'Use my keyboard\u2019s mic instead')));
    } else {
      box.append(h('strong', { text: ui.voiceHelp === 'blocked' ? 'The microphone isn\u2019t available here' : ui.voiceHelp === 'none' ? 'This browser has no built-in voice typing' : 'Use your keyboard\u2019s voice typing' }),
        h('p', { class: 'small', text: 'Tap the box, then use your device\u2019s own dictation:' }),
        h('ul', { class: 'small' },
          h('li', {}, h('b', {}, 'Android / iPhone: '), 'the microphone key on the keyboard'),
          h('li', {}, h('b', {}, 'Windows: '), 'press Win + H'),
          h('li', {}, h('b', {}, 'Mac: '), 'press Fn twice (or the Globe key)')),
        h('p', { class: 'small muted', text: 'When you finish speaking, tap \u201cPlan it for me\u201d.' }));
    }
    box.append(h('button', { class: 'btn link', type: 'button', onclick: function () { ui.voiceHelp = ''; A().render(); var el = root.document.getElementById('capture'); if (el) el.focus(); } }, 'Close'));
    return box;
  }

  // ---------- projects ----------
  function projects() {
    var map = {};
    S().oneoffs.forEach(function (o) {
      if (!o.project) return;
      var p = map[o.project] || (map[o.project] = { id: o.project, title: o.projectTitle || o.title, deadline: o.deadline || o.due, steps: [], done: 0, total: 0, doneMin: 0, totalMin: 0 });
      p.steps.push(o); p.total++; p.totalMin += o.durationMin;
      if (o.deadline && o.deadline > p.deadline) p.deadline = o.deadline;
      if (o.done) { p.done++; p.doneMin += o.durationMin; }
    });
    return Object.keys(map).map(function (k) {
      var p = map[k];
      p.steps.sort(function (a, b) { return a.step - b.step; });
      p.next = p.steps.filter(function (o) { return !o.done; })[0];
      // on track? compare finished share with the share of time already gone
      var first = p.steps[0].after || A().todayIso();
      var span = Math.max(1, Sch.diffDays(first, p.deadline) + 1);
      var gone = Math.min(1, Math.max(0, Sch.diffDays(first, A().todayIso()) / span));
      p.expected = gone; p.progress = p.totalMin ? p.doneMin / p.totalMin : 0;
      p.status = p.done === p.total ? 'done' : (p.progress + 0.15 >= gone ? 'on track' : 'behind');
      return p;
    }).sort(function (a, b) { return a.deadline < b.deadline ? -1 : 1; });
  }
  function renderProjects() {
    var ps = projects();
    var card = h('section', { class: 'card', 'aria-labelledby': 'prjH' },
      h('div', { class: 'spread' }, h('h2', { id: 'prjH', text: 'Projects' }), h('a', { class: 'btn', href: '#today' }, 'New project')),
      h('p', { class: 'small muted', text: 'Tasks with a deadline that ShiftRhythm broke into steps. Describe a new one under \u201cWhat\u2019s coming up?\u201d on Today.' }));
    if (!ps.length) card.append(h('div', { class: 'empty', text: 'No projects yet.' }));
    ps.forEach(function (p) {
      var bar = h('i'); bar.style.width = Math.round(p.progress * 100) + '%';
      var del = h('button', { class: 'btn small danger', type: 'button', onclick: function () {
        if (!del.dataset.armed) { del.dataset.armed = '1'; del.textContent = 'Tap again to delete'; return; }
        A().change(function () { S().oneoffs = S().oneoffs.filter(function (o) { return o.project !== p.id; }); }, 'Project deleted.');
      } }, 'Delete');
      var steps = h('details', {}, h('summary', { class: 'small', text: 'Steps (' + p.done + '/' + p.total + ' done)' }),
        p.steps.map(function (o) {
          return h('div', { class: 'item' }, h('div', { class: 'body' }, h('span', { class: 'title' + (o.done ? ' muted' : ''), text: (o.done ? '\u2713 ' : '') + o.title.split(' \u00b7 ')[0] }),
            h('span', { class: 'muted small', text: A().dur(o.durationMin) + ' \u00b7 ' + (o.after ? A().dayLabel(o.after) + '\u2013' + A().dayLabel(o.due) : '') })));
        }));
      card.append(h('div', { class: 'project' },
        h('div', { class: 'spread' }, h('strong', { text: p.title }),
          h('span', { class: 'chip ' + (p.status === 'behind' ? 'warn' : 'off'), text: p.status === 'done' ? 'Done' : p.status === 'behind' ? 'Behind' : 'On track' })),
        h('div', { class: 'bar' }, bar),
        h('div', { class: 'small muted', text: 'Due ' + A().dayLabel(p.deadline) + ' \u00b7 ' + A().dur(p.doneMin) + ' of ' + A().dur(p.totalMin) + ' done' + (p.next ? ' \u00b7 next: ' + p.next.title.split(' \u00b7 ')[0] : '') }),
        h('div', { class: 'spread' }, steps, del)));
    });
    return card;
  }

  // ---------- daily briefing (built on the device) ----------
  function briefing() {
    var app = A(), st = S(), plan = app.plan(), t = app.todayIso(), lines = [];
    var type = st.shifts[t] || 'off';
    var todays = plan.blocks.filter(function (b) { return b.date === t; });
    var shift = todays.filter(function (b) { return b.kind === 'shift'; })[0];
    var recover = plan.blocks.filter(function (b) { return b.kind === 'sleep' && b.title !== 'Sleep' && b.date === t; })[0];
    var leave = todays.filter(function (b) { return b.kind === 'commute' && b.title === 'Travel to work'; })[0];
    if (type === 'day' && shift) lines.push('Day shift ' + shift.startTime + '\u2013' + shift.endTime + (leave ? ', leave by ' + leave.startTime : '') + '.');
    else if (type === 'night' && shift) {
      var nap = todays.filter(function (b) { return b.kind === 'nap'; })[0];
      lines.push('Night shift tonight from ' + shift.startTime + '.' + (nap ? ' Nap ' + nap.startTime + '\u2013' + nap.endTime + ' first.' : ''));
    } else lines.push('Off day.');
    if (recover) lines.push('After last night\u2019s shift you\u2019re sleeping until ' + recover.endTime + '. Everything else starts after that.');
    var now = Sch.absFor(plan, t, app.nowMin());
    var tasks = todays.filter(function (b) { return b.kind === 'task'; });
    var left = tasks.filter(function (b) { return !b.done && b.e > now; });
    var mins = left.reduce(function (a, b) { return a + b.minutes; }, 0);
    if (left.length) lines.push(left.length + ' task block' + (left.length > 1 ? 's' : '') + ' left today (' + app.dur(mins) + '). Next: ' + left[0].title.split(' \u00b7 ')[0] + ' at ' + left[0].startTime + '.');
    else if (tasks.length) lines.push('All of today\u2019s tasks are done. Rest well.');
    else lines.push('Nothing else planned today.');
    projects().filter(function (p) { return p.status !== 'done' && Sch.diffDays(t, p.deadline) <= 14; }).forEach(function (p) {
      lines.push(p.title + ': due ' + app.dayLabel(p.deadline) + ', ' + Math.round(p.progress * 100) + '% done' + (p.status === 'behind' ? ', a little behind. Today\u2019s steps matter.' : ', on track.'));
    });
    var ws = Sch.weekStart(t, st.settings.weekStartsOn), weekly = [];
    st.recurring.forEach(function (r) {
      if (!r.active || r.per !== 'week') return;
      var done = Object.keys(st.log).filter(function (k) { return k.indexOf(r.id + '@W' + ws + '#') === 0 && st.log[k].status === 'done'; }).length;
      weekly.push(r.title + ' ' + done + '/' + r.times);
    });
    if (weekly.length) lines.push('This week so far: ' + weekly.slice(0, 5).join(', ') + (weekly.length > 5 ? ' and ' + (weekly.length - 5) + ' more' : '') + '.');
    if (plan.unplaced.length) lines.push(plan.unplaced.length + ' thing' + (plan.unplaced.length > 1 ? 's' : '') + ' couldn\u2019t fit. See the list below.');
    return lines;
  }
  function renderBriefing() {
    var card = h('section', { class: 'card', 'aria-labelledby': 'brH' }, h('h3', { id: 'brH', text: 'Your briefing' }),
      h('ul', { class: 'brief' }, briefing().map(function (l) { return h('li', { text: l }); })));
    if (ui.claude) {
      var out = h('p', { class: 'advice small', text: ui.advice });
      if (!ui.advice) out.hidden = true;
      card.append(h('div', { class: 'row' }, h('button', { class: 'btn small', type: 'button', disabled: ui.adviceBusy, onclick: function () { askAdvice(out); } }, ui.adviceBusy ? 'Thinking\u2026' : 'Ask Claude how to approach today')), out);
    }
    return card;
  }
  function askAdvice(out) {
    var app = A(), plan = app.plan(), t = app.todayIso();
    var blocks = plan.blocks.filter(function (b) { return b.date === t && b.kind !== 'break'; }).map(function (b) { return b.startTime + '\u2013' + b.endTime + ' ' + b.title + (b.done ? ' (done)' : ''); });
    var prompt = 'I work rotating day and night shifts. Here is my plan for today (' + t + '), already scheduled around my shift and sleep:\n' + blocks.join('\n') +
      '\n\nBriefing: ' + briefing().join(' ') +
      '\n\nIn at most 5 short bullet lines, tell me how to approach today: what to protect, what to do first, and one thing to drop if energy is low. Plain text, no markdown headings.';
    ui.adviceBusy = true; out.hidden = false; out.textContent = 'Thinking\u2026';
    ui.claude(prompt, { cache: false, onText: function (u) { out.textContent = u.text; } }).then(function (r) { ui.advice = r.text; })
      .catch(function (e) { ui.advice = e && e.code === 'rate_limited' ? 'Claude is busy right now. Try again later.' : 'Couldn\u2019t reach Claude.'; })
      .then(function () { ui.adviceBusy = false; app.render(); });
  }

  root.SR = root.SR || {};
  root.SR.capture = { init: init, renderCapture: renderCapture, renderBriefing: renderBriefing, renderProjects: renderProjects, ui: ui };
})(this);
