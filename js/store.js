/*
 * ShiftRhythm storage: everything lives in this browser's localStorage.
 * Nothing is ever sent anywhere. Backups are files you save yourself,
 * optionally encrypted with a passphrase (AES-GCM, key from PBKDF2-SHA-256).
 */
(function (root) {
  'use strict';
  var KEY = 'shiftrhythm.v1';
  var SCHEMA = 1;

  function blank() {
    return {
      schema: SCHEMA,
      setupDone: false,
      settings: JSON.parse(JSON.stringify(root.SR.scheduler.DEFAULT_SETTINGS)),
      shifts: {},
      recurring: [],
      oneoffs: [],
      roles: [],
      log: {},
      adjust: {}
    };
  }

  function uid() {
    var a = new Uint8Array(8);
    (root.crypto || {}).getRandomValues ? root.crypto.getRandomValues(a) : a.forEach(function (_, i) { a[i] = Math.random() * 256; });
    return Array.prototype.map.call(a, function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }

  // ---- validation: imported files are untrusted ----
  var ISO = /^\d{4}-\d{2}-\d{2}$/, HM = /^\d{1,2}:\d{2}$/;
  // Never let imported or synced data use these as keys or ids (prototype pollution).
  var RESERVED = /^(__proto__|constructor|prototype|hasOwnProperty|toString|valueOf)$/;
  function safeId(v, max) { var id = str(v, max || 40).replace(/[^a-zA-Z0-9_-]/g, ''); return RESERVED.test(id) ? '' : id; }
  var LOGKEY = /^[A-Za-z0-9_:@#.-]{1,120}$/;
  function str(v, max) { return typeof v === 'string' ? v.slice(0, max || 200) : ''; }
  function num(v, lo, hi, dflt) { v = Number(v); return isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt; }
  function oneOf(v, list, dflt) { return list.indexOf(v) >= 0 ? v : dflt; }
  function allow(a) {
    a = a || {};
    var off = oneOf(a.off, ['yes', 'no', 'weekend'], 'yes');
    return { off: off, recovery: oneOf(a.recovery, ['yes', 'no', 'weekend'], off), day: oneOf(a.day, ['yes', 'no', 'weekend'], 'yes'), night: oneOf(a.night, ['yes', 'no', 'weekend'], 'yes') };
  }
  function cleanTask(t, oneoff) {
    if (!t || typeof t !== 'object') return null;
    var out = {
      id: safeId(t.id) || uid(),
      title: str(t.title, 120).trim(),
      category: str(t.category, 40),
      durationMin: num(t.durationMin, 5, 720, 30),
      when: oneOf(t.when, ['outside', 'during', 'either'], 'outside'),
      timeOfDay: oneOf(t.timeOfDay, ['any', 'wake', 'morning', 'afternoon', 'evening'], 'any'),
      fixedTime: HM.test(t.fixedTime || '') ? t.fixedTime : '',
      keepWhole: !!t.keepWhole,
      priority: num(t.priority, 1, 3, 2),
      allow: allow(t.allow),
      notes: str(t.notes, 500),
      role: safeId(t.role)
    };
    if (!out.title) return null;
    out.weekdays = Array.isArray(t.weekdays) ? t.weekdays.map(Number).filter(function (x, i, a) { return x >= 0 && x <= 6 && a.indexOf(x) === i; }) : [];
    if (oneoff) {
      out.date = ISO.test(t.date || '') ? t.date : '';
      out.due = ISO.test(t.due || '') ? t.due : '';
      out.after = ISO.test(t.after || '') ? t.after : '';
      out.deadline = ISO.test(t.deadline || '') ? t.deadline : '';
      out.project = safeId(t.project);
      out.projectTitle = str(t.projectTitle, 120);
      out.step = num(t.step, 0, 500, 0);
      out.done = !!t.done;
    } else {
      out.per = oneOf(t.per, ['day', 'week', 'month'], 'week');
      out.times = num(t.times, 1, 14, 1);
      out.active = t.active !== false;
    }
    return out;
  }
  function cleanRole(r) {
    if (!r || typeof r !== 'object') return null;
    var out = {
      id: safeId(r.id) || uid(),
      name: str(r.name, 40).trim(),
      type: oneOf(r.type, ['fixed', 'flexible'], 'flexible'),
      persona: str(r.persona, 20).replace(/[^a-z]/g, ''),
      days: Array.isArray(r.days) ? r.days.map(Number).filter(function (x, i, a) { return x >= 0 && x <= 6 && a.indexOf(x) === i; }) : [],
      start: HM.test(r.start || '') ? r.start : '09:00',
      end: HM.test(r.end || '') ? r.end : '12:00',
      commuteMin: num(r.commuteMin, 0, 240, 0),
      weeklyHours: num(r.weeklyHours, 0, 80, 0),
      session: num(r.session, 30, 240, 90),
      allow: allow(r.allow),
      skip: Array.isArray(r.skip) ? r.skip.filter(function (d) { return ISO.test(d); }).slice(-200) : [],
      active: r.active !== false,
      keywords: str(r.keywords, 120)
    };
    return out.name ? out : null;
  }
  function clean(raw) {
    var s = blank();
    if (!raw || typeof raw !== 'object') return s;
    s.setupDone = !!raw.setupDone;
    s.updatedAt = num(raw.updatedAt, 0, 9e15, 0);
    var rw = raw.rewards;
    if (rw && typeof rw === 'object' && ISO.test(rw.start || '')) {
      var days = {}, snap = {};
      Object.keys(rw.days || {}).slice(-500).forEach(function (d) {
        var x = rw.days[d]; if (!ISO.test(d) || !x) return;
        days[d] = { s: oneOf(x.s, ['win', 'perfect', 'rest', 'frozen', 'missed'], 'rest'), p: num(x.p, 0, 500, 0), n: num(x.n, 0, 500, 0), c: num(x.c, -100, 100, 0) };
      });
      Object.keys(rw.snap || {}).slice(-30).forEach(function (d) {
        if (ISO.test(d) && Array.isArray(rw.snap[d])) snap[d] = rw.snap[d].filter(function (k) { return typeof k === 'string' && LOGKEY.test(k); }).slice(0, 200);
      });
      s.rewards = { start: rw.start, coins: num(rw.coins, 0, 100000, 0), through: ISO.test(rw.through || '') ? rw.through : rw.start, days: days, snap: snap, auto: rw.auto !== false, best: num(rw.best, 0, 100000, 0) };
    }
    var D = root.SR.scheduler.DEFAULT_SETTINGS, r = raw.settings || {};
    var st = s.settings;
    ['commuteMin', 'prepMin', 'napMin', 'handoverMin', 'shiftEndBufferMin', 'focusMin', 'breakMin', 'capOffDay', 'capShiftDay', 'capRecoveryDay', 'headsUpMin'].forEach(function (k) {
      st[k] = num(r[k], 0, 1440, D[k]);
    });
    ['wakeAfterDayShift', 'bedtime', 'postNightSleep', 'postNightWake'].forEach(function (k) { st[k] = HM.test(r[k] || '') ? r[k] : D[k]; });
    st.rosterName = str(r.rosterName, 60);
    st.name = str(r.name, 40);
    st.mode = oneOf(r.mode, ['shifts', 'regular', 'free'], 'shifts');
    st.workLabel = str(r.workLabel, 30).trim() || 'Work';
    st.workDays = Array.isArray(r.workDays) ? r.workDays.map(Number).filter(function (x, i, a) { return x >= 0 && x <= 6 && a.indexOf(x) === i; }) : D.workDays.slice();
    st.theme = oneOf(r.theme, ['auto', 'light', 'dark'], 'auto');
    st.sleepHours = num(r.sleepHours, 3, 12, D.sleepHours);
    st.volume = num(r.volume, 0, 1, D.volume);
    st.sound = r.sound !== false;
    st.voice = r.voice === true;
    st.maxSession = num(r.maxSession, 30, 480, D.maxSession);
    st.chime = oneOf(r.chime, ['bells', 'marimba', 'bubbles'], 'bells');
    st.wakeTime = HM.test(r.wakeTime || '') ? r.wakeTime : D.wakeTime;
    st.weekStartsOn = num(r.weekStartsOn, 0, 6, 1);
    st.weekendDays = Array.isArray(r.weekendDays) ? r.weekendDays.filter(function (x) { return x >= 0 && x <= 6; }).slice(0, 7) : D.weekendDays.slice();
    ['day', 'night'].forEach(function (k) {
      var x = (r.shifts || {})[k] || {};
      st.shifts[k] = { start: HM.test(x.start || '') ? x.start : D.shifts[k].start, end: HM.test(x.end || '') ? x.end : D.shifts[k].end };
    });
    Object.keys(raw.shifts || {}).forEach(function (d) {
      if (ISO.test(d) && ['day', 'night', 'off'].indexOf(raw.shifts[d]) >= 0) s.shifts[d] = raw.shifts[d];
    });
    // One-day changes: actual rest, busy time, work started early or finished late (minutes from that midnight).
    function mn(v) { return typeof v === 'number' && isFinite(v) && v >= 0 && v <= 2880 ? Math.round(v) : null; }
    Object.keys(raw.adjust || {}).slice(-60).forEach(function (d) {
      var a = raw.adjust[d];
      if (!ISO.test(d) || !a || typeof a !== 'object') return;
      var o = {}, any = false;
      if (Array.isArray(a.rest) && mn(a.rest[0]) != null && mn(a.rest[1]) != null && a.rest[1] > a.rest[0]) { o.rest = [mn(a.rest[0]), mn(a.rest[1])]; any = true; }
      if (Array.isArray(a.busy)) {
        o.busy = a.busy.filter(function (x) { return Array.isArray(x) && mn(x[0]) != null && mn(x[1]) != null && x[1] > x[0]; })
          .slice(0, 10).map(function (x) { return [mn(x[0]), mn(x[1]), str(x[2], 60)]; });
        if (o.busy.length) any = true; else delete o.busy;
      }
      if (a.shift && typeof a.shift === 'object') {
        var sh = {};
        if (mn(a.shift.start) != null) sh.start = mn(a.shift.start);
        if (mn(a.shift.end) != null) sh.end = mn(a.shift.end);
        if (sh.start != null || sh.end != null) { o.shift = sh; any = true; }
      }
      if (any) s.adjust[d] = o;
    });
    s.roles = (Array.isArray(raw.roles) ? raw.roles : []).map(cleanRole).filter(Boolean).slice(0, 24);
    st.personas = Array.isArray(r.personas) ? r.personas.filter(function (x) { return typeof x === 'string' && /^[a-z]{2,12}$/.test(x); }).slice(0, 20) : [];
    s.recurring = (Array.isArray(raw.recurring) ? raw.recurring : []).map(function (t) { return cleanTask(t, false); }).filter(Boolean).slice(0, 300);
    s.oneoffs = (Array.isArray(raw.oneoffs) ? raw.oneoffs : []).map(function (t) { return cleanTask(t, true); }).filter(Boolean).slice(0, 2000);
    Object.keys(raw.log || {}).slice(0, 20000).forEach(function (k) {
      var L = raw.log[k];
      if (!L || typeof L !== 'object' || !LOGKEY.test(k) || RESERVED.test(k)) return;
      s.log[k] = {
        status: oneOf(L.status, ['done', 'skipped'], 'done'),
        date: ISO.test(L.date || '') ? L.date : '',
        start: HM.test(L.start || '') ? L.start : '',
        end: HM.test(L.end || '') ? L.end : '',
        title: str(L.title, 120), taskId: str(L.taskId, 46).replace(/[^a-zA-Z0-9_:-]/g, ''), when: oneOf(L.when, ['outside', 'during', 'either'], 'outside'), role: safeId(L.role),
        at: num(L.at, 0, 9e15, 0)
      };
    });
    return s;
  }

  function load() {
    try {
      var raw = root.localStorage.getItem(KEY);
      return raw ? clean(JSON.parse(raw)) : blank();
    } catch (e) { return blank(); }
  }
  function save(state) {
    try { root.localStorage.setItem(KEY, JSON.stringify(state)); return true; }
    catch (e) { return false; }
  }
  function prune(state, today) {
    // keep the log and finished one-off tasks for 120 days
    var cutoff = root.SR.scheduler.addDays(today, -120);
    Object.keys(state.log).forEach(function (k) { if (state.log[k].date && state.log[k].date < cutoff) delete state.log[k]; });
    state.oneoffs = state.oneoffs.filter(function (o) { return !(o.done && (o.date || o.due || today) < cutoff); });
    Object.keys(state.shifts).forEach(function (d) { if (d < cutoff) delete state.shifts[d]; });
    var adjCut = root.SR.scheduler.addDays(today, -3);
    state.adjust = state.adjust || {};
    Object.keys(state.adjust).forEach(function (d) { if (d < adjCut) delete state.adjust[d]; });
  }

  // ---- backups ----
  function b64(buf) { var s = ''; new Uint8Array(buf).forEach(function (b) { s += String.fromCharCode(b); }); return btoa(s); }
  function unb64(s) { var bin = atob(s), a = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; }
  var BACKUP_ITER = 600000; // OWASP 2023 guidance for PBKDF2-HMAC-SHA256
  function deriveKey(pass, salt, iter) {
    var enc = new TextEncoder();
    return root.crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']).then(function (k) {
      return root.crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt, iterations: iter || BACKUP_ITER, hash: 'SHA-256' }, k, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    });
  }
  function exportBackup(state, pass) {
    var json = JSON.stringify({ app: 'ShiftRhythm', schema: SCHEMA, exportedAt: new Date().toISOString(), data: state });
    if (!pass) return Promise.resolve(json);
    if (!root.crypto || !root.crypto.subtle) return Promise.reject(new Error('Encryption needs the app to be opened from http://127.0.0.1 or https.'));
    var salt = root.crypto.getRandomValues(new Uint8Array(16)), iv = root.crypto.getRandomValues(new Uint8Array(12));
    return deriveKey(pass, salt).then(function (key) {
      return root.crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, new TextEncoder().encode(json));
    }).then(function (ct) {
      return JSON.stringify({ app: 'ShiftRhythm', encrypted: true, kdf: 'PBKDF2-SHA256', iter: BACKUP_ITER, salt: b64(salt), iv: b64(iv), data: b64(ct) });
    });
  }
  function importBackup(text, pass) {
    var outer;
    try { outer = JSON.parse(text); } catch (e) { return Promise.reject(new Error('That file is not a ShiftRhythm backup.')); }
    if (!outer || outer.app !== 'ShiftRhythm') return Promise.reject(new Error('That file is not a ShiftRhythm backup.'));
    if (!outer.encrypted) return Promise.resolve(clean(outer.data));
    if (!pass) return Promise.reject(new Error('This backup is encrypted. Enter its passphrase.'));
    var iter = Number(outer.iter) || 310000; // older backups used 310,000
    if (iter < 100000 || iter > 5000000 || typeof outer.salt !== 'string' || typeof outer.iv !== 'string' || typeof outer.data !== 'string') return Promise.reject(new Error('That backup file is damaged.'));
    return deriveKey(pass, unb64(outer.salt), iter).then(function (key) {
      return root.crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(outer.iv) }, key, unb64(outer.data));
    }).then(function (pt) {
      return clean(JSON.parse(new TextDecoder().decode(pt)).data);
    }, function () { throw new Error('Wrong passphrase, or the file is damaged.'); });
  }

  root.SR = root.SR || {};
  root.SR.store = { cleanRole: cleanRole, load: load, save: save, blank: blank, clean: clean, cleanTask: cleanTask, uid: uid, prune: prune, exportBackup: exportBackup, importBackup: importBackup, KEY: KEY };
})(this);
