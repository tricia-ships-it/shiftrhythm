/*
 * ShiftRhythm encrypted sync through your own private GitHub repository.
 *
 * Security design
 *  - End-to-end encryption: your plan is sealed ON THIS DEVICE with AES-GCM-256 before it
 *    leaves. The key comes from your passphrase (PBKDF2-SHA-256, 600,000 rounds, random salt).
 *    GitHub only ever stores ciphertext; tampering is detected (GCM tag + associated data).
 *  - Least privilege: the fine-grained token is limited to ONE private repository with
 *    only "Contents: read and write".
 *  - Nothing readable at rest: the encryption key is stored as a NON-EXTRACTABLE key in
 *    IndexedDB (usable by the app, never readable by any script), and the GitHub token is
 *    itself encrypted with that key. The passphrase is never stored.
 *  - Rollback protection: a device refuses a synced copy older than one it has already seen.
 *  - Untrusted input: everything decrypted is validated field by field before use.
 *  - The page's Content Security Policy only allows connections to api.github.com.
 */
(function (root) {
  'use strict';
  var API = 'https://api.github.com';
  var FILE = 'shiftrhythm.sync.json';
  var CFG_KEY = 'shiftrhythm.sync';
  var ITER = 600000;              // OWASP 2023 guidance for PBKDF2-HMAC-SHA256
  var subtle = (root.crypto && root.crypto.subtle) || null;
  var AAD_DATA = 'ShiftRhythm/1', AAD_TOKEN = 'ShiftRhythm/token/1';

  // ---------- encoding ----------
  function b64(buf) { var s = '', a = new Uint8Array(buf); for (var i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s); }
  function unb64(s) { var bin = atob(s), a = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; }
  function rand(n) { return root.crypto.getRandomValues(new Uint8Array(n)); }
  function te(s) { return new TextEncoder().encode(s); }

  // ---------- crypto ----------
  function deriveKey(pass, salt, iter) {
    return subtle.importKey('raw', te(pass), 'PBKDF2', false, ['deriveKey']).then(function (k) {
      return subtle.deriveKey({ name: 'PBKDF2', salt: salt, iterations: iter || ITER, hash: 'SHA-256' }, k, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    });
  }
  function seal(key, salt, state, device, iter) {
    var iv = rand(12);
    return subtle.encrypt({ name: 'AES-GCM', iv: iv, additionalData: te(AAD_DATA) }, key, te(JSON.stringify(state))).then(function (ct) {
      return JSON.stringify({ app: 'ShiftRhythm', v: 1, kdf: 'PBKDF2-SHA256', iter: iter || ITER, salt: b64(salt), iv: b64(iv), data: b64(ct), updatedAt: new Date().toISOString(), device: String(device || '').slice(0, 40) });
    });
  }
  function unseal(key, env) {
    return subtle.decrypt({ name: 'AES-GCM', iv: unb64(env.iv), additionalData: te(AAD_DATA) }, key, unb64(env.data)).then(function (pt) {
      return JSON.parse(new TextDecoder().decode(pt));
    });
  }
  function sealToken(key, token) {
    var iv = rand(12);
    return subtle.encrypt({ name: 'AES-GCM', iv: iv, additionalData: te(AAD_TOKEN) }, key, te(token)).then(function (ct) { return { iv: b64(iv), ct: b64(ct) }; });
  }
  function openToken(key, enc) {
    return subtle.decrypt({ name: 'AES-GCM', iv: unb64(enc.iv), additionalData: te(AAD_TOKEN) }, key, unb64(enc.ct)).then(function (pt) { return new TextDecoder().decode(pt); });
  }
  // The synced file comes from the network: check its shape before trusting any of it.
  function validEnvelope(env) {
    if (!env || env.app !== 'ShiftRhythm' || env.v !== 1) return false;
    var iter = Number(env.iter || 310000);
    if (!(iter >= 100000 && iter <= 5000000)) return false;
    if (typeof env.salt !== 'string' || typeof env.iv !== 'string' || typeof env.data !== 'string') return false;
    try { return unb64(env.salt).length === 16 && unb64(env.iv).length === 12 && env.data.length < 8 * 1024 * 1024; } catch (e) { return false; }
  }
  function iterOf(env) { return Number(env.iter || 310000); }

  // Passphrase rules for a NEW sync space (joining an existing one just has to match).
  var COMMON = /^(password|passphrase|qwerty|letmein|iloveyou|welcome|admin|shiftrhythm|123456)/i;
  function passProblem(p) {
    p = String(p || '');
    if (p.length < 12) return 'Use at least 12 characters. A short sentence is easiest to remember.';
    if (/^\d+$/.test(p)) return 'Use words, not only numbers.';
    if (new Set(p.toLowerCase()).size < 6) return 'That passphrase repeats too few different characters.';
    if (COMMON.test(p.replace(/\s/g, ''))) return 'That passphrase is too common. Pick something only you would think of.';
    return '';
  }

  // ---------- merge ----------
  // Used only when BOTH devices changed since the last sync. Inputs are already validated.
  function merge(a, b) {
    var newer = (a.updatedAt || 0) >= (b.updatedAt || 0) ? a : b, older = newer === a ? b : a;
    var out = JSON.parse(JSON.stringify(newer));
    out.log = out.log || {};
    Object.keys(older.log || {}).forEach(function (k) {
      if (!Object.prototype.hasOwnProperty.call(older.log, k) || /^(__proto__|constructor|prototype)$/.test(k)) return;
      var x = Object.prototype.hasOwnProperty.call(out.log, k) ? out.log[k] : null, y = older.log[k];
      if (!x || (y.status === 'done' && x.status !== 'done')) out.log[k] = y;
    });
    ['recurring', 'oneoffs', 'roles'].forEach(function (list) {
      out[list] = out[list] || [];
      var ids = {}; out[list].forEach(function (x) { ids['#' + x.id] = true; });
      (older[list] || []).forEach(function (x) { if (!ids['#' + x.id]) out[list].push(x); });
    });
    var doneIds = {};
    (older.oneoffs || []).forEach(function (o) { if (o.done) doneIds['#' + o.id] = true; });
    out.oneoffs.forEach(function (o) { if (doneIds['#' + o.id]) o.done = true; });
    out.updatedAt = Math.max(a.updatedAt || 0, b.updatedAt || 0);
    return out;
  }

  // ---------- config & key storage ----------
  function loadCfg() { try { var c = JSON.parse(root.localStorage.getItem(CFG_KEY) || 'null'); return c && typeof c === 'object' ? c : {}; } catch (e) { return {}; } }
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
  var token = null; // decrypted token, kept in memory only
  function gh(cfg, path, opts, tok) {
    opts = opts || {};
    return root.fetch(API + path, {
      method: opts.method || 'GET',
      headers: { 'Authorization': 'Bearer ' + (tok || token), 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error'
    }).then(function (r) {
      if (r.status === 404 && opts.allow404) return null;
      if (!r.ok) { var e = new Error('GitHub said ' + r.status); e.status = r.status; throw e; }
      return r.json();
    });
  }
  function repoPath(cfg) { return '/repos/' + encodeURIComponent(cfg.owner) + '/' + encodeURIComponent(cfg.repo); }
  function getFile(cfg, tok) {
    return gh(cfg, repoPath(cfg) + '/contents/' + FILE, { allow404: true }, tok).then(function (j) {
      if (!j) return null;
      if (typeof j.content !== 'string' || typeof j.sha !== 'string' || j.content.length > 12 * 1024 * 1024) throw new Error('The sync file in that repository is damaged.');
      var env; try { env = JSON.parse(atob(j.content.replace(/\s/g, ''))); } catch (e) { env = null; }
      if (!validEnvelope(env)) throw new Error('The sync file in that repository isn’t a valid ShiftRhythm file.');
      return { sha: j.sha, env: env };
    });
  }
  function putFile(cfg, text, sha) {
    var body = { message: 'ShiftRhythm sync', content: btoa(text) };
    if (sha) body.sha = sha;
    return gh(cfg, repoPath(cfg) + '/contents/' + FILE, { method: 'PUT', body: body }).then(function (j) { return j.content.sha; });
  }

  // ---------- engine ----------
  var host = null;          // { getState, setState(state), clean(raw), onStatus() }
  var key = null, salt = null, iter = ITER;
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
  function connected(cfg) { return !!(cfg && cfg.owner && (cfg.tokenEnc || cfg.token)); }

  // Unlock with the stored key or a passphrase: recover the key, then the token.
  function useKey(k, cfg) {
    key = k;
    if (cfg.tokenEnc) return openToken(k, cfg.tokenEnc).then(function (t) { token = t; return true; });
    if (cfg.token) { // older versions kept the token in plain text: encrypt it now
      token = cfg.token;
      return sealToken(k, token).then(function (enc) { var c = loadCfg(); c.tokenEnc = enc; delete c.token; saveCfg(c); return true; });
    }
    return Promise.resolve(false);
  }

  function init(h) {
    host = h;
    var cfg = loadCfg();
    if (!connected(cfg)) { setStatus('off'); return; }
    if (cfg.salt) salt = unb64(cfg.salt);
    iter = Number(cfg.iter) || 310000;
    keyGet().then(function (k) {
      if (k && k.key) {
        if (!salt && k.salt) { salt = unb64(k.salt); var c = loadCfg(); c.salt = k.salt; c.iter = iter; saveCfg(c); }
        return useKey(k.key, loadCfg()).then(function () { setStatus('idle'); return syncNow('open'); });
      }
      setStatus('locked', 'Enter your passphrase to unlock sync on this device.');
    }).catch(function () { setStatus('locked', 'Enter your passphrase to unlock sync on this device.'); });
    root.addEventListener('online', function () { syncNow('online'); });
    root.document.addEventListener('visibilitychange', function () { if (!root.document.hidden) syncNow('focus'); });
  }

  function changed() {
    var cfg = loadCfg();
    if (!connected(cfg)) return;
    cfg.dirty = true; saveCfg(cfg);
    clearTimeout(timer);
    timer = setTimeout(function () { syncNow('change'); }, 2500);
  }

  function syncNow(reason, retry) {
    var cfg = loadCfg();
    if (!connected(cfg) || !key || !token) return Promise.resolve(false);
    if (running) return running;
    if (root.navigator.onLine === false) { setStatus('offline', 'Offline. Changes will sync when you’re back online.'); return Promise.resolve(false); }
    setStatus('syncing');
    running = getFile(cfg).then(function (remote) {
      var local = host.getState();
      if (!remote) return push(cfg, local, null);
      var remoteChanged = remote.sha !== cfg.lastSha;
      if (!remoteChanged && !cfg.dirty) return true;
      if (remote.env.salt !== b64(salt)) throw new Error('This repository was set up with a different passphrase. Reconnect with that passphrase.');
      return unseal(key, remote.env).then(function (raw) {
        var remoteState = host.clean(raw);
        // Rollback protection: never accept a copy older than one this device already saw.
        if (remoteChanged && cfg.lastRemoteAt && (remoteState.updatedAt || 0) < cfg.lastRemoteAt) {
          setStatus('error', 'The synced copy on GitHub is older than one this device has already seen, so it was ignored and your copy was uploaded again.');
          return push(cfg, local, remote.sha).then(function () { return 'rolled-back'; });
        }
        if (remoteChanged && !cfg.dirty) {
          host.setState(remoteState);
          var c = loadCfg(); c.lastSha = remote.sha; c.lastRemoteAt = Math.max(c.lastRemoteAt || 0, remoteState.updatedAt || 0); saveCfg(c);
          return true;
        }
        var next = remoteChanged ? host.clean(merge(local, remoteState)) : local;
        if (remoteChanged) host.setState(next);
        return push(cfg, next, remote.sha);
      });
    }).then(function (r) {
      if (r !== 'rolled-back') setStatus('ok', 'Synced');
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
    return seal(key, salt, state, cfg.device, iter).then(function (text) { return putFile(cfg, text, sha); }).then(function (newSha) {
      var c = loadCfg(); c.lastSha = newSha; c.dirty = false; c.lastRemoteAt = Math.max(c.lastRemoteAt || 0, state.updatedAt || 0); saveCfg(c); return true;
    });
  }

  // First-time set-up on a device.
  function connect(opts) {
    if (!subtle) return Promise.reject(new Error('Encryption needs the app to be opened from https or http://127.0.0.1.'));
    var cfg = { owner: String(opts.owner || '').trim(), repo: String(opts.repo || '').trim(), device: String(opts.device || 'This device').slice(0, 40), remember: opts.remember !== false };
    var tok = String(opts.token || '').trim();
    if (!NAME.test(cfg.owner) || !NAME.test(cfg.repo)) return Promise.reject(new Error('Check the GitHub username and repository name.'));
    if (!/^github_pat_[A-Za-z0-9_]{20,255}$/.test(tok)) {
      return Promise.reject(new Error(/^ghp_/.test(tok) ? 'That’s a classic token, which can reach your whole account. Please create a fine-grained token (it starts with github_pat_) limited to the sync repository.' : 'That doesn’t look like a fine-grained GitHub token. It should start with github_pat_.'));
    }
    if (!opts.pass) return Promise.reject(new Error('Enter your sync passphrase.'));
    setStatus('syncing', 'Checking the repository…');
    return gh(cfg, repoPath(cfg), {}, tok).then(function (repo) {
      if (!repo || repo.private !== true) throw new Error('That repository is public. Make it private first.');
      return getFile(cfg, tok);
    }).then(function (remote) {
      if (remote) {
        salt = unb64(remote.env.salt); iter = iterOf(remote.env);
        return deriveKey(opts.pass, salt, iter).then(function (k) {
          return unseal(k, remote.env).then(function (raw) {
            key = k;
            var remoteState = host.clean(raw), local = host.getState();
            var next = opts.useRemote || !local.setupDone ? remoteState : host.clean(merge(local, remoteState));
            host.setState(next);
            cfg.lastSha = remote.sha; cfg.dirty = next !== remoteState; cfg.lastRemoteAt = remoteState.updatedAt || 0;
          }, function () { throw new Error('Wrong passphrase for the data already in that repository.'); });
        });
      }
      var problem = passProblem(opts.pass);
      if (problem) throw new Error(problem);
      if (opts.pass !== opts.confirm) throw new Error('The two passphrases don’t match.');
      salt = rand(16); iter = ITER;
      return deriveKey(opts.pass, salt, iter).then(function (k) { key = k; cfg.dirty = true; });
    }).then(function () {
      token = tok;
      cfg.salt = b64(salt); cfg.iter = iter;
      return sealToken(key, tok);
    }).then(function (enc) {
      cfg.tokenEnc = enc;
      saveCfg(cfg);
      return opts.remember === false ? null : keyPut({ key: key, salt: cfg.salt });
    }).then(function () { return syncNow('connect'); })
      .catch(function (e) { key = null; token = null; setStatus('off'); throw e; });
  }
  // Unlock on a device that didn't remember the key. Works offline: salt and the encrypted token are local.
  function unlock(pass) {
    var cfg = loadCfg();
    setStatus('syncing', 'Unlocking…');
    var saltP = cfg.salt ? Promise.resolve({ salt: cfg.salt, iter: Number(cfg.iter) || 310000 })
      : (cfg.token ? getFile(cfg, cfg.token).then(function (r) { if (!r) throw new Error('No synced data found yet.'); return { salt: r.env.salt, iter: iterOf(r.env) }; }) : Promise.reject(new Error('Reconnect sync on this device.')));
    return saltP.then(function (si) {
      salt = unb64(si.salt); iter = si.iter;
      var c = loadCfg(); c.salt = si.salt; c.iter = si.iter; saveCfg(c);
      return deriveKey(pass, salt, iter);
    }).then(function (k) {
      return useKey(k, loadCfg()).then(function () { return loadCfg().remember === false ? null : keyPut({ key: k, salt: b64(salt) }).catch(function () {}); });
    }).then(function () { return syncNow('unlock'); })
      .catch(function (e) { key = null; token = null; var msg = e && e.name === 'OperationError' ? 'Wrong passphrase.' : friendly(e); setStatus('locked', msg); throw new Error(msg); });
  }
  function disconnect() {
    key = null; salt = null; token = null;
    try { root.localStorage.removeItem(CFG_KEY); } catch (e) {}
    return keyDel().then(function () { setStatus('off'); });
  }
  function info() { var c = loadCfg(); return { connected: connected(c), owner: c.owner, repo: c.repo, device: c.device, dirty: !!c.dirty, status: status }; }

  var EXPORTS = { init: init, changed: changed, syncNow: syncNow, connect: connect, unlock: unlock, disconnect: disconnect, info: info, merge: merge, seal: seal, unseal: unseal, deriveKey: deriveKey, sealToken: sealToken, openToken: openToken, validEnvelope: validEnvelope, passProblem: passProblem, FILE: FILE, ITER: ITER };
  if (typeof module !== 'undefined' && module.exports) module.exports = EXPORTS;
  else { root.SR = root.SR || {}; root.SR.sync = EXPORTS; }
})(typeof window !== 'undefined' ? window : globalThis);
