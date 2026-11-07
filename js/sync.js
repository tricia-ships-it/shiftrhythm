/*
 * ShiftRhythm encrypted sync through your own private GitHub repository.
 *
 *  - Your plan is encrypted ON THIS DEVICE (AES-GCM 256, key from your passphrase with
 *    PBKDF2-SHA-256, 310,000 rounds) before it leaves. GitHub only ever stores ciphertext.
 *  - The access token should be a fine-grained token limited to ONE private repository,
 *    with only "Contents: read and write". It can't touch anything else in your account.
 *  - The encryption key is kept in this browser as a non-extractable key: the app can use
 *    it, but no script can read it out. Your passphrase itself is never stored.
 *  - The only address the app may contact is api.github.com (enforced by the page's CSP).
 */
(function (root) {
  'use strict';
  var API = 'https://api.github.com';
  var FILE = 'shiftrhythm.sync.json';
  var CFG_KEY = 'shiftrhythm.sync';
  var ITER = 310000;
  var subtle = (root.crypto && root.crypto.subtle) || null;

  // ---------- encoding ----------
  function b64(buf) { var s = '', a = new Uint8Array(buf); for (var i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s); }
  function unb64(s) { var bin = atob(s), a = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; }
  function rand(n) { return root.crypto.getRandomValues(new Uint8Array(n)); }

  // ---------- crypto ----------
  function deriveKey(pass, salt) {
    return subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']).then(function (k) {
      return subtle.deriveKey({ name: 'PBKDF2', salt: salt, iterations: ITER, hash: 'SHA-256' }, k, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    });
  }
  function seal(key, salt, state, device) {
    var iv = rand(12);
    var aad = new TextEncoder().encode('ShiftRhythm/1');
    return subtle.encrypt({ name: 'AES-GCM', iv: iv, additionalData: aad }, key, new TextEncoder().encode(JSON.stringify(state))).then(function (ct) {
      return JSON.stringify({ app: 'ShiftRhythm', v: 1, kdf: 'PBKDF2-SHA256', iter: ITER, salt: b64(salt), iv: b64(iv), data: b64(ct), updatedAt: new Date().toISOString(), device: String(device || '').slice(0, 40) });
    });
  }
  function unseal(key, env) {
    var aad = new TextEncoder().encode('ShiftRhythm/1');
    return subtle.decrypt({ name: 'AES-GCM', iv: unb64(env.iv), additionalData: aad }, key, unb64(env.data)).then(function (pt) {
      return JSON.parse(new TextDecoder().decode(pt));
    });
  }

  // ---------- merge ----------
  // Used only when BOTH devices changed since the last sync.
  // The newer copy wins; nothing finished on either device is lost; tasks added on either side are kept.
  function merge(a, b) {
    var newer = (a.updatedAt || 0) >= (b.updatedAt || 0) ? a : b, older = newer === a ? b : a;
    var out = JSON.parse(JSON.stringify(newer));
    out.log = out.log || {};
    Object.keys(older.log || {}).forEach(function (k) {
      var x = out.log[k], y = older.log[k];
      if (!x || (y.status === 'done' && x.status !== 'done')) out.log[k] = y;
    });
    ['recurring', 'oneoffs'].forEach(function (list) {
      out[list] = out[list] || [];
      var ids = {}; out[list].forEach(function (x) { ids[x.id] = true; });
      (older[list] || []).forEach(function (x) { if (!ids[x.id]) out[list].push(x); });
    });
    var doneIds = {};
    (older.oneoffs || []).forEach(function (o) { if (o.done) doneIds[o.id] = true; });
    out.oneoffs.forEach(function (o) { if (doneIds[o.id]) o.done = true; });
    out.updatedAt = Math.max(a.updatedAt || 0, b.updatedAt || 0);
    return out;
  }

  // ---------- config & key storage ----------
  function loadCfg() { try { return JSON.parse(root.localStorage.getItem(CFG_KEY) || 'null') || {}; } catch (e) { return {}; } }
  function saveCfg(c) { try { root.localStorage.setItem(CFG_KEY, JSON.stringify(c)); } catch (e) {} }
  function idb() {
    return new Promise(function (res, rej) {
      if (!root.indexedDB) { rej(new Error('no-idb')); return; }
      var r = root.indexedDB.open('shiftrhythm', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('keys'); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function keyPut(k) { return idb().then(function (db) { return new Promise(function (res, rej) { var tx = db.transaction('keys', 'readwrite'); tx.objectStore('keys').put(k, 'sync'); tx.oncomplete = res; tx.onerror = function () { rej(tx.error); }; }); }); }
  function keyGet() { return idb().then(function (db) { return new Promise(function (res) { var tx = db.transaction('keys', 'readonly'), q = tx.objectStore('keys').get('sync'); q.onsuccess = function () { res(q.result || null); }; q.onerror = function () { res(null); }; }); }).catch(function () { return null; }); }
  function keyDel() { return idb().then(function (db) { return new Promise(function (res) { var tx = db.transaction('keys', 'readwrite'); tx.objectStore('keys').delete('sync'); tx.oncomplete = res; tx.onerror = res; }); }).catch(function () {}); }

  // ---------- GitHub ----------
  var NAME = /^[A-Za-z0-9_.-]{1,100}$/;
  function gh(cfg, path, opts) {
    opts = opts || {};
    return root.fetch(API + path, {
      method: opts.method || 'GET',
      headers: { 'Authorization': 'Bearer ' + cfg.token, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer'
    }).then(function (r) {
      if (r.status === 404 && opts.allow404) return null;
      if (!r.ok) { var e = new Error('GitHub said ' + r.status); e.status = r.status; throw e; }
      return r.json();
    });
  }
  function repoPath(cfg) { return '/repos/' + encodeURIComponent(cfg.owner) + '/' + encodeURIComponent(cfg.repo); }
  function getFile(cfg) {
    return gh(cfg, repoPath(cfg) + '/contents/' + FILE, { allow404: true }).then(function (j) {
      if (!j) return null;
      var env = JSON.parse(atob(String(j.content || '').replace(/\s/g, '')));
      if (!env || env.app !== 'ShiftRhythm') throw new Error('The sync file in that repository isn’t a ShiftRhythm file.');
      return { sha: j.sha, env: env };
    });
  }
  function putFile(cfg, text, sha) {
    var body = { message: 'ShiftRhythm sync', content: btoa(text) };
    if (sha) body.sha = sha;
    return gh(cfg, repoPath(cfg) + '/contents/' + FILE, { method: 'PUT', body: body }).then(function (j) { return j.content.sha; });
  }

  // ---------- engine ----------
  var host = null;          // { getState, setState(state), onStatus() }
  var key = null, salt = null;
  var status = { state: 'off', message: '', lastSync: 0 };
  var timer = null, running = null;

  function setStatus(s, msg) {
    status.state = s; status.message = msg || '';
    if (s === 'ok') status.lastSync = Date.now();
    if (host && host.onStatus) host.onStatus(status);
  }
  function friendly(e) {
    if (!e) return 'Sync failed.';
    if (e.status === 401) return 'GitHub rejected the token. It may have expired: create a new one and reconnect.';
    if (e.status === 403) return 'The token can’t write to that repository. Give it “Contents: Read and write”.';
    if (e.status === 404) return 'Repository not found. Check the name, and that the token includes it.';
    if (e.status === 409 || e.status === 422) return 'Another device saved at the same moment. Trying again…';
    if (e.name === 'OperationError') return 'Wrong passphrase for this sync space.';
    if (e.name === 'TypeError') return 'Can’t reach GitHub. You’re probably offline; it will sync later.';
    return e.message || 'Sync failed.';
  }

  function init(h) {
    host = h;
    var cfg = loadCfg();
    if (!cfg.token || !cfg.owner) { setStatus('off'); return; }
    keyGet().then(function (k) {
      if (k && k.key && k.salt) { key = k.key; salt = unb64(k.salt); setStatus('idle'); syncNow('open'); }
      else setStatus('locked', 'Enter your passphrase to unlock sync on this device.');
    });
    root.addEventListener('online', function () { syncNow('online'); });
    root.document.addEventListener('visibilitychange', function () { if (!root.document.hidden) syncNow('focus'); });
  }

  // Called by the app after every local change.
  function changed() {
    var cfg = loadCfg();
    if (!cfg.token) return;
    cfg.dirty = true; saveCfg(cfg);
    clearTimeout(timer);
    timer = setTimeout(function () { syncNow('change'); }, 2500);
  }

  function syncNow(reason, retry) {
    var cfg = loadCfg();
    if (!cfg.token || !key) return Promise.resolve(false);
    if (running) return running;
    if (root.navigator.onLine === false) { setStatus('offline', 'Offline. Changes will sync when you’re back online.'); return Promise.resolve(false); }
    setStatus('syncing');
    running = getFile(cfg).then(function (remote) {
      var local = host.getState();
      if (!remote) return push(cfg, local, null);
      var remoteChanged = remote.sha !== cfg.lastSha;
      if (!remoteChanged && !cfg.dirty) return true;
      if (remote.env.salt !== b64(salt)) throw new Error('This repository was set up with a different passphrase. Reconnect with that passphrase.');
      return unseal(key, remote.env).then(function (remoteState) {
        if (remoteChanged && !cfg.dirty) { host.setState(remoteState); cfg.lastSha = remote.sha; saveCfg(cfg); return true; }
        var next = remoteChanged ? merge(local, remoteState) : local;
        if (remoteChanged) host.setState(next);
        return push(cfg, next, remote.sha);
      });
    }).then(function () {
      setStatus('ok', 'Synced');
      return true;
    }).catch(function (e) {
      running = null;
      if ((e.status === 409 || e.status === 422) && !retry) return syncNow(reason, true);
      setStatus('error', friendly(e));
      return false;
    }).then(function (r) { running = null; return r; });
    return running;
  }
  function push(cfg, state, sha) {
    return seal(key, salt, state, cfg.device).then(function (text) { return putFile(cfg, text, sha); }).then(function (newSha) {
      var c = loadCfg(); c.lastSha = newSha; c.dirty = false; saveCfg(c); return true;
    });
  }

  // First-time set-up on a device.
  function connect(opts) {
    if (!subtle) return Promise.reject(new Error('Encryption needs the app to be opened from https or http://127.0.0.1.'));
    var cfg = { owner: String(opts.owner || '').trim(), repo: String(opts.repo || '').trim(), token: String(opts.token || '').trim(), device: String(opts.device || 'This device').slice(0, 40) };
    if (!NAME.test(cfg.owner) || !NAME.test(cfg.repo)) return Promise.reject(new Error('Check the GitHub username and repository name.'));
    if (!/^(github_pat_|ghp_)[A-Za-z0-9_]{20,}$/.test(cfg.token)) return Promise.reject(new Error('That doesn’t look like a GitHub token. Fine-grained tokens start with github_pat_.'));
    if (String(opts.pass || '').length < 10) return Promise.reject(new Error('Use a passphrase of at least 10 characters. A short sentence works well.'));
    setStatus('syncing', 'Checking the repository…');
    return gh(cfg, repoPath(cfg)).then(function (repo) {
      if (!repo.private) throw new Error('That repository is public. Make it private first (your data would still be encrypted, but private is safer).');
      return getFile(cfg);
    }).then(function (remote) {
      if (remote) {
        salt = unb64(remote.env.salt);
        return deriveKey(opts.pass, salt).then(function (k) {
          return unseal(k, remote.env).then(function (remoteState) {
            key = k;
            var local = host.getState();
            var next = opts.useRemote || !local.setupDone ? remoteState : merge(local, remoteState);
            host.setState(next);
            cfg.lastSha = remote.sha; cfg.dirty = next !== remoteState;
            return next;
          }, function () { throw new Error('Wrong passphrase for the data already in that repository.'); });
        });
      }
      if (opts.pass !== opts.confirm) throw new Error('The two passphrases don’t match.');
      salt = rand(16);
      return deriveKey(opts.pass, salt).then(function (k) { key = k; cfg.dirty = true; });
    }).then(function () {
      saveCfg(cfg);
      return opts.remember === false ? null : keyPut({ key: key, salt: b64(salt) });
    }).then(function () { return syncNow('connect'); });
  }
  function unlock(pass) {
    var cfg = loadCfg();
    setStatus('syncing', 'Unlocking…');
    return getFile(cfg).then(function (remote) {
      if (!remote) throw new Error('No synced data found in the repository yet.');
      salt = unb64(remote.env.salt);
      return deriveKey(pass, salt).then(function (k) { return unseal(k, remote.env).then(function () { key = k; return keyPut({ key: k, salt: remote.env.salt }); }); },
        function () { throw new Error('Wrong passphrase.'); });
    }).then(function () { return syncNow('unlock'); }).catch(function (e) { setStatus('locked', e.name === 'OperationError' ? 'Wrong passphrase.' : friendly(e)); throw e; });
  }
  function disconnect() {
    key = null; salt = null;
    try { root.localStorage.removeItem(CFG_KEY); } catch (e) {}
    return keyDel().then(function () { setStatus('off'); });
  }
  function info() { var c = loadCfg(); return { connected: !!c.token, owner: c.owner, repo: c.repo, device: c.device, dirty: !!c.dirty, status: status }; }

  var EXPORTS = { init: init, changed: changed, syncNow: syncNow, connect: connect, unlock: unlock, disconnect: disconnect, info: info, merge: merge, seal: seal, unseal: unseal, deriveKey: deriveKey, FILE: FILE };
  if (typeof module !== 'undefined' && module.exports) module.exports = EXPORTS;
  else { root.SR = root.SR || {}; root.SR.sync = EXPORTS; }
})(typeof window !== 'undefined' ? window : globalThis);
