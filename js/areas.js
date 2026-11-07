/*
 * ShiftRhythm life areas: the different hats you wear.
 *   - fixed:    set days and hours (classes, a part-time job, choir rehearsal)
 *   - flexible: about N hours a week, fitted into free time (your NGO, freelance work, a community role)
 * Your main schedule (shifts, a regular job, or none) is set separately and counts as the area "main".
 */
(function (root) {
  'use strict';
  var A = function () { return root.SR.app; };
  var Sch = root.SR.scheduler, St = root.SR.store;
  function h() { return A().h.apply(null, arguments); }
  function S() { return A().state(); }

  var PERSONAS = [
    { id: 'shift', icon: '🔄', label: 'Shift work', main: 'shifts' },
    { id: 'fulltime', icon: '💼', label: 'Full-time job', main: 'regular', role: { type: 'fixed', name: 'Work', days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00', commuteMin: 30 } },
    { id: 'parttime', icon: '⏰', label: 'Part-time job', role: { type: 'fixed', name: 'Part-time job', days: [2, 4], start: '10:00', end: '14:00', commuteMin: 30 } },
    { id: 'student', icon: '🎓', label: 'Studies', role: { type: 'fixed', name: 'Classes', days: [1, 3, 5], start: '09:00', end: '12:00', commuteMin: 30 }, also: { type: 'flexible', name: 'Study', weeklyHours: 6, session: 60 }, words: 'class lecture assignment exam study revise coursework tutorial' },
    { id: 'freelance', icon: '💻', label: 'Freelance or self-employed', role: { type: 'flexible', name: 'Freelance work', weeklyHours: 8, session: 90 }, words: 'client freelance invoice proposal contract' },
    { id: 'org', icon: '🌍', label: 'Running an organisation or business', role: { type: 'flexible', name: 'My organisation', weeklyHours: 6, session: 90 }, words: 'ngo business team partners donors' },
    { id: 'community', icon: '🤝', label: 'Community or volunteer role', role: { type: 'flexible', name: 'Community role', weeklyHours: 3, session: 60 }, words: 'community volunteer meetup chapter members' },
    { id: 'creative', icon: '🎭', label: 'Creative work or gigs', role: { type: 'flexible', name: 'Creative work', weeklyHours: 3, session: 60 }, words: 'gig acting audition casting shoot perform performance set' },
    { id: 'faith', icon: '🎶', label: 'Choir, church or faith group', role: { type: 'fixed', name: 'Choir rehearsal', days: [6], start: '16:00', end: '18:00', commuteMin: 30 }, words: 'choir church rehearsal mass service fellowship' },
    { id: 'family', icon: '🏡', label: 'Family and caregiving', role: { type: 'flexible', name: 'Family time', weeklyHours: 5, session: 60 }, words: 'family kids children mum mom dad parents' },
    { id: 'jobhunt', icon: '🔎', label: 'Looking for work', role: { type: 'flexible', name: 'Job search', weeklyHours: 8, session: 60 }, words: 'job application cv resume interview' },
    { id: 'retired', icon: '🌿', label: 'Retired or taking time out', main: 'free' }
  ];
  var GENERIC = { time: 1, work: 1, role: 1, group: 1, job: 1, the: 1, and: 1, for: 1, with: 1, my: 1, part: 1, full: 1 };

  function roles() { return (S().roles || []).filter(function (r) { return r.active !== false; }); }
  function role(id) { return (S().roles || []).filter(function (r) { return r.id === id; })[0] || null; }
  function mainName() { var m = S().settings.mode || 'shifts'; return m === 'free' ? '' : (S().settings.workLabel || 'Work'); }
  function areaName(id) { if (!id) return 'Personal'; if (id === 'main') return mainName() || 'Work'; var r = role(id); return r ? r.name : 'Personal'; }
  function areaColor(id) {
    if (!id) return null;
    var list = S().roles || [], i = list.findIndex(function (r) { return r.id === id; });
    if (id === 'main') return 'var(--c5)';
    return i >= 0 ? 'var(--c' + ((i + 1) % 8 + 1) + ')' : null;
  }
  // Options for "Area" pickers.
  function areaOptions() {
    var out = [['', 'Personal']];
    if (mainName()) out.push(['main', mainName() + ((S().settings.mode || 'shifts') === 'shifts' ? ' (shifts)' : '')]);
    (S().roles || []).forEach(function (r) { out.push([r.id, r.name + (r.active === false ? ' (paused)' : '')]); });
    return out;
  }
  // Guess the area from what someone typed or said.
  function detect(text) {
    var t = ' ' + String(text || '').toLowerCase() + ' ', best = '', score = 0;
    function test(id, words, weight) {
      words.forEach(function (w) {
        w = w.trim().toLowerCase();
        if (w.length < 3 || GENERIC[w]) return;
        if (t.indexOf(' ' + w) >= 0 && weight + w.length > score) { score = weight + w.length; best = id; }
      });
    }
    (S().roles || []).forEach(function (r) {
      test(r.id, [r.name.toLowerCase()].concat(r.name.split(/[\s()&,/-]+/), (r.keywords || '').split(','), ((PERSONAS.filter(function (p) { return p.id === r.persona; })[0] || {}).words || '').split(' ')), r.name.split(' ').length > 1 ? 20 : 10);
      test(r.id, [r.name.toLowerCase()], 40);
    });
    if (mainName()) test('main', [mainName().toLowerCase(), 'at work', 'office', 'shift'], 15);
    return best;
  }

  function newRole(tpl, persona) {
    return St.cleanRole(Object.assign({ id: 'a' + St.uid().slice(0, 10), persona: persona || '', allow: { off: 'yes', recovery: 'yes', day: 'yes', night: 'yes' } }, JSON.parse(JSON.stringify(tpl))));
  }
  function togglePersona(p) {
    A().change(function () {
      var st = S(), set = st.settings.personas || (st.settings.personas = []);
      var on = set.indexOf(p.id) < 0;
      if (on) set.push(p.id); else set.splice(set.indexOf(p.id), 1);
      var hasShift = set.indexOf('shift') >= 0;
      if (on) {
        if (p.main === 'shifts') { st.settings.mode = 'shifts'; if (st.settings.shifts.day.start === '09:00') st.settings.shifts.day = { start: '07:00', end: '19:00' }; }
        else if (p.main === 'regular' && !hasShift) {
          st.settings.mode = 'regular'; st.settings.workLabel = 'Work'; st.settings.workDays = [1, 2, 3, 4, 5]; st.settings.shifts.day = { start: '09:00', end: '17:00' };
        } else if (p.main === 'free' && !hasShift && set.indexOf('fulltime') < 0) st.settings.mode = 'free';
        if (p.role && !(p.main === 'regular' && !hasShift)) st.roles.push(newRole(p.role, p.id));
        if (p.also) st.roles.push(newRole(p.also, p.id));
      } else {
        st.roles = st.roles.filter(function (r) { return r.persona !== p.id; });
        if (p.main === 'shifts' || p.main === 'regular') st.settings.mode = set.indexOf('shift') >= 0 ? 'shifts' : set.indexOf('fulltime') >= 0 ? 'regular' : 'free';
      }
    });
  }

  function renderPersonaPicker() {
    var set = S().settings.personas || [];
    return h('div', { class: 'stack' },
      h('p', { class: 'small muted', text: 'Pick everything that’s part of your life right now. Each becomes an area with its own colour, and you can rename or change any of it.' }),
      h('div', { class: 'persona-grid', role: 'group', 'aria-label': 'What’s part of your life' }, PERSONAS.map(function (p) {
        var on = set.indexOf(p.id) >= 0;
        return h('button', { type: 'button', class: 'persona' + (on ? ' on' : ''), 'aria-pressed': String(on), onclick: function () { togglePersona(p); } },
          h('span', { class: 'pi', 'aria-hidden': 'true', text: p.icon }), h('span', { text: p.label }));
      })));
  }

  function dayPicker(sel, onToggle) {
    return h('div', { class: 'row daypick' }, [1, 2, 3, 4, 5, 6, 0].map(function (d) {
      var on = sel.indexOf(d) >= 0;
      return h('button', { type: 'button', class: 'dp' + (on ? ' on' : ''), 'aria-pressed': String(on), onclick: function () { onToggle(d); } }, A().dayLabel(Sch.addDays('2026-11-08', d), { weekday: 'short' }).slice(0, 2));
    }));
  }
  function edit(r, fn, msg) { A().change(function () { var x = role(r.id); if (x) fn(x); }, msg); }

  function renderAreaCard(r) {
    var shifts = (S().settings.mode || 'shifts') === 'shifts';
    var card = A().tint(h('div', { class: 'area' + (r.active === false ? ' paused' : '') }), areaColor(r.id));
    var name = h('input', { type: 'text', value: r.name, 'aria-label': 'Area name', onchange: function (e) { var v = e.target.value.trim().slice(0, 40); if (v) edit(r, function (x) { x.name = v; }); } });
    card.append(h('div', { class: 'spread' }, h('span', { class: 'swatch', 'aria-hidden': 'true' }), name,
      h('div', { class: 'seg' }, [['fixed', 'Fixed times'], ['flexible', 'Hours a week']].map(function (o) {
        return h('button', { type: 'button', 'aria-pressed': String(r.type === o[0]), onclick: function () { edit(r, function (x) { x.type = o[0]; }); } }, o[1]);
      }))));
    if (r.type === 'fixed') {
      card.append(dayPicker(r.days || [], function (d) { edit(r, function (x) { var i = x.days.indexOf(d); if (i >= 0) x.days.splice(i, 1); else x.days.push(d); }); }),
        h('div', { class: 'fields' },
          h('label', { class: 'field' }, h('span', {}, 'From'), h('input', { type: 'time', value: r.start, onchange: function (e) { var v = e.target.value; if (v) edit(r, function (x) { x.start = v; }); } })),
          h('label', { class: 'field' }, h('span', {}, 'To'), h('input', { type: 'time', value: r.end, onchange: function (e) { var v = e.target.value; if (v) edit(r, function (x) { x.end = v; }); } })),
          h('label', { class: 'field' }, h('span', {}, 'Travel each way (min)'), h('input', { type: 'number', min: '0', max: '240', step: '5', value: String(r.commuteMin || 0), onchange: function (e) { var v = Math.max(0, Math.min(240, Number(e.target.value) || 0)); edit(r, function (x) { x.commuteMin = v; }); } }))));
    } else {
      card.append(h('div', { class: 'fields' },
        h('label', { class: 'field' }, h('span', {}, 'Hours a week'), h('input', { type: 'number', min: '0', max: '80', step: '0.5', value: String(r.weeklyHours || 0), onchange: function (e) { var v = Math.max(0, Math.min(80, Number(e.target.value) || 0)); edit(r, function (x) { x.weeklyHours = v; }, 'Saved. Plan recalculated.'); } })),
        h('label', { class: 'field' }, h('span', {}, 'Per sitting (min)'), h('input', { type: 'number', min: '30', max: '240', step: '15', value: String(r.session || 90), onchange: function (e) { var v = Math.max(30, Math.min(240, Number(e.target.value) || 90)); edit(r, function (x) { x.session = v; }); } }))),
        h('p', { class: 'small muted', text: r.weeklyHours ? 'Tasks you add to this area count towards the ' + r.weeklyHours + ' h; ShiftRhythm adds general “' + r.name + ' time” for the rest.' : 'No weekly target: this area just groups its tasks and one-off bookings, like gigs.' }));
    }
    var rules = [['off', shifts ? 'Normal off days' : 'Days off'], ['day', shifts ? 'Day shifts' : mainName() + ' days'], ['night', 'Night shifts']]
      .filter(function (x) { return shifts || x[0] === 'off' || ((S().settings.mode || '') === 'regular' && x[0] === 'day'); });
    card.append(h('details', {}, h('summary', { class: 'small', text: 'Allowed on' }),
      h('div', { class: 'fields' }, rules.map(function (x) {
        return h('label', { class: 'field' }, h('span', {}, x[1]), h('select', { onchange: function (e) { var v = e.target.value; edit(r, function (y) { y.allow[x[0]] = v; if (x[0] === 'off' && shifts) y.allow.recovery = v; }); } },
          [['yes', 'Yes'], ['no', 'No'], ['weekend', 'Weekends only']].map(function (o) { return h('option', { value: o[0], selected: r.allow[x[0]] === o[0] }, o[1]); })));
      }))));
    var del = h('button', { class: 'btn small danger', type: 'button', onclick: function () {
      if (!del.dataset.armed) { del.dataset.armed = '1'; del.textContent = 'Tap again to remove'; return; }
      A().change(function () { S().roles = S().roles.filter(function (x) { return x.id !== r.id; }); }, 'Area removed. Its tasks are kept, now under Personal.');
    } }, 'Remove');
    card.append(h('div', { class: 'row' },
      h('button', { class: 'btn small', type: 'button', onclick: function () { edit(r, function (x) { x.active = x.active === false; }, r.active === false ? 'Area resumed.' : 'Area paused. Nothing from it is planned until you resume it.'); } }, r.active === false ? 'Resume' : 'Pause'),
      del));
    return card;
  }
  function renderAreas() {
    var box = h('div', { class: 'stack' });
    var list = S().roles || [];
    if (!list.length) box.append(h('p', { class: 'empty', text: 'No areas yet. Pick what’s part of your life above, or add one.' }));
    list.forEach(function (r) { box.append(renderAreaCard(r)); });
    box.append(h('div', { class: 'row' },
      h('button', { class: 'btn', type: 'button', onclick: function () { A().change(function () { S().roles.push(newRole({ type: 'flexible', name: 'New area', weeklyHours: 2, session: 60 })); }); } }, '+ Area with hours a week'),
      h('button', { class: 'btn', type: 'button', onclick: function () { A().change(function () { S().roles.push(newRole({ type: 'fixed', name: 'New commitment', days: [6], start: '10:00', end: '12:00' })); }); } }, '+ Area with fixed times')));
    return box;
  }

  // Hours by area for the calendar week that contains today.
  function renderHours(plan) {
    var t = A().todayIso(), ws = Sch.weekStart(t, S().settings.weekStartsOn), we = Sch.addDays(ws, 6);
    var sums = {}, order = [];
    function add(id, m) { if (!(id in sums)) { sums[id] = 0; order.push(id); } sums[id] += m; }
    plan.blocks.forEach(function (b) {
      if (b.date < ws || b.date > we) return;
      if (b.kind === 'task') add(b.role || (b.during ? 'main' : ''), b.minutes);
      else if (b.kind === 'commit') add(b.role, b.minutes);
      else if (b.kind === 'shift') add('main', b.minutes);
    });
    if (plan.from > ws) { // shifts and fixed commitments earlier this week
      var past = Sch.buildPlan(S(), { today: ws, nowMin: 0, days: Sch.diffDays(ws, plan.from) });
      past.blocks.forEach(function (b) {
        if (b.date < ws || b.date >= plan.from) return;
        if (b.kind === 'shift') add('main', b.minutes); else if (b.kind === 'commit') add(b.role, b.minutes);
      });
    }
    Object.keys(S().log || {}).forEach(function (k) { // finished earlier this week, before today
      var L = S().log[k];
      if (L.status !== 'done' || !L.date || L.date < ws || L.date >= plan.from) return;
      var a = Sch.hm(L.start), b = Sch.hm(L.end);
      if (a != null && b != null) add(L.role || '', Math.max(5, b - a));
    });
    roles().forEach(function (r) { if (r.weeklyHours && !(r.id in sums)) add(r.id, 0); });
    if (!order.length) return null;
    var max = Math.max.apply(null, order.map(function (id) { var r = role(id); return Math.max(sums[id], r && r.weeklyHours ? r.weeklyHours * 60 : 0); })) || 1;
    order.sort(function (a, b) { return sums[b] - sums[a]; });
    var rows = order.map(function (id) {
      var r = role(id), target = r && r.type === 'flexible' && r.weeklyHours ? r.weeklyHours * 60 : 0;
      var bar = A().tint(h('i'), areaColor(id) || 'var(--muted)'); bar.style.width = (100 * sums[id] / max).toFixed(1) + '%';
      var track = h('div', { class: 'hbar' }, bar);
      if (target) { var mk = h('b', { class: 'mark', 'aria-hidden': 'true' }); mk.style.left = (100 * target / max).toFixed(1) + '%'; track.append(mk); }
      return h('div', { class: 'hrow' }, h('span', { class: 'hname', text: areaName(id) }), track,
        h('span', { class: 'hval mono', text: A().dur(sums[id]) + (target ? ' / ' + A().dur(target) : '') }));
    });
    return h('section', { class: 'card', 'aria-labelledby': 'hoursH' },
      h('div', { class: 'spread' }, h('h2', { id: 'hoursH', text: 'Hours by area this week' }), h('span', { class: 'small muted', text: A().dayLabel(ws) + ' – ' + A().dayLabel(we) })),
      h('div', { class: 'hours' }, rows),
      h('p', { class: 'small muted', text: 'Planned and done, including your ' + ((S().settings.mode || 'shifts') === 'shifts' ? 'shifts' : 'fixed commitments') + '. The line marks each area’s weekly target.' }));
  }

  root.SR = root.SR || {};
  root.SR.areas = { PERSONAS: PERSONAS, renderPersonaPicker: renderPersonaPicker, renderAreas: renderAreas, renderHours: renderHours, areaName: areaName, areaColor: areaColor, areaOptions: areaOptions, detect: detect, role: role, roles: roles };
})(this);
