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
      log: {}
    };
  }

  function uid() {
    var a = new Uint8Array(8);
    (root.crypto || {}).getRandomValues ? root.crypto.getRandomValues(a) : a.forEach(function (_, i) { a[i] = Math.random() * 256; });
    return Array.prototype.map.call(a, function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }

  // ---- validation: imported files are untrusted ----
  var ISO = /^\d{4}-\d{2}-\d{2}$/, HM = /^\d{1,2}:\d{2}$/;
  function str(v, max) { return typeof v === 'string' ? v.slice(0, max || 200) : ''; }
  function num(v, lo, hi, dflt) { v = Number(v); return isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt; }
  function oneOf(v, list, dflt) { return list.indexOf(v) >= 0 ? v : dflt; }
  function allow(a) {
    a = a || {};
    return { off: oneOf(a.off, ['yes', 'no', 'weekend'], 'yes'), day: oneOf(a.day, ['yes', 'no', 'weekend'], 'yes'), night: oneOf(a.night, ['yes', 'no', 'weekend'], 'yes') };
  }
  function cleanTask(t, oneoff) {
    if (!t || typeof t !== 'object') return null;
    var out = {
      id: str(t.id, 40).replace(/[^a-zA-Z0-9_-]/g, '') || uid(),
      title: str(t.title, 120).trim(),
      category: str(t.category, 40),
      durationMin: num(t.durationMin, 5, 720, 30),
      when: oneOf(t.when, ['outside', 'during', 'either'], 'outside'),
      timeOfDay: oneOf(t.timeOfDay, ['any', 'morning', 'afternoon', 'evening'], 'any'),
      fixedTime: HM.test(t.fixedTime || '') ? t.fixedTime : '',
      keepWhole: !!t.keepWhole,
      priority: num(t.priority, 1, 3, 2),
      allow: allow(t.allow),
      notes: str(t.notes, 500)
    };
    if (!out.title) return null;
    if (oneoff) {
      out.date = ISO.test(t.date || '') ? t.date : '';
      out.due = ISO.test(t.due || '') ? t.due : '';
      out.done = !!t.done;
    } else {
      out.per = oneOf(t.per, ['day', 'week', 'month'], 'week');
      out.times = num(t.times, 1, 14, 1);
      out.active = t.active !== false;
    }
    return out;
  }
  function clean(raw) {
    var s = blank();
    if (!raw || typeof raw !== 'object') return s;
    s.setupDone = !!raw.setupDone;
    var D = root.SR.scheduler.DEFAULT_SETTINGS, r = raw.settings || {};
    var st = s.settings;
    ['commuteMin', 'prepMin', 'napMin', 'handoverMin', 'focusMin', 'breakMin', 'capOffDay', 'capShiftDay', 'headsUpMin'].forEach(function (k) {
      st[k] = num(r[k], 0, 1440, D[k]);
    });
    st.sleepHours = num(r.sleepHours, 3, 12, D.sleepHours);
    st.volume = num(r.volume, 0, 1, D.volume);
    st.sound = r.sound !== false;
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
    s.recurring = (Array.isArray(raw.recurring) ? raw.recurring : []).map(function (t) { return cleanTask(t, false); }).filter(Boolean).slice(0, 300);
    s.oneoffs = (Array.isArray(raw.oneoffs) ? raw.oneoffs : []).map(function (t) { return cleanTask(t, true); }).filter(Boolean).slice(0, 2000);
    Object.keys(raw.log || {}).slice(0, 20000).forEach(function (k) {
      var L = raw.log[k];
      if (!L || typeof L !== 'object' || k.length > 120) return;
      s.log[k] = {
        status: oneOf(L.status, ['done', 'skipped'], 'done'),
        date: ISO.test(L.date || '') ? L.date : '',
        start: HM.test(L.start || '') ? L.start : '',
        end: HM.test(L.end || '') ? L.end : '',
        title: str(L.title, 120), taskId: str(L.taskId, 40), when: oneOf(L.when, ['outside', 'during', 'either'], 'outside'),
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
  }

  // ---- backups ----
  function b64(buf) { var s = ''; new Uint8Array(buf).forEach(function (b) { s += String.fromCharCode(b); }); return btoa(s); }
  function unb64(s) { var bin = atob(s), a = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; }
  function deriveKey(pass, salt) {
    var enc = new TextEncoder();
    return root.crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']).then(function (k) {
      return root.crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt, iterations: 310000, hash: 'SHA-256' }, k, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
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
      return JSON.stringify({ app: 'ShiftRhythm', encrypted: true, kdf: 'PBKDF2-SHA256-310000', salt: b64(salt), iv: b64(iv), data: b64(ct) });
    });
  }
  function importBackup(text, pass) {
    var outer;
    try { outer = JSON.parse(text); } catch (e) { return Promise.reject(new Error('That file is not a ShiftRhythm backup.')); }
    if (!outer || outer.app !== 'ShiftRhythm') return Promise.reject(new Error('That file is not a ShiftRhythm backup.'));
    if (!outer.encrypted) return Promise.resolve(clean(outer.data));
    if (!pass) return Promise.reject(new Error('This backup is encrypted. Enter its passphrase.'));
    return deriveKey(pass, unb64(outer.salt)).then(function (key) {
      return root.crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(outer.iv) }, key, unb64(outer.data));
    }).then(function (pt) {
      return clean(JSON.parse(new TextDecoder().decode(pt)).data);
    }, function () { throw new Error('Wrong passphrase, or the file is damaged.'); });
  }

  root.SR = root.SR || {};
  root.SR.store = { load: load, save: save, blank: blank, clean: clean, cleanTask: cleanTask, uid: uid, prune: prune, exportBackup: exportBackup, importBackup: importBackup, KEY: KEY };
})(this);
