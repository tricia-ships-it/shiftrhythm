/*
 * ShiftRhythm alarms: soft synthesized chimes (no audio files, nothing downloaded)
 * and system notifications.
 */
(function (root) {
  'use strict';
  var ctx = null;

  function audio() {
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return null;
    if (!ctx) ctx = new AC();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  // Browsers only allow sound after the user has tapped the page once.
  function unlock() { try { audio(); } catch (e) {} }
  function unlocked() { return !!ctx && ctx.state === 'running'; }

  var NOTE = { C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880.0, C6: 1046.5, E6: 1318.5, G6: 1568.0 };
  var TUNES = {
    focus: ['C5', 'E5', 'G5', 'C6'],   // rising: let's go
    break: ['G5', 'E5', 'C5'],         // falling: rest now
    sleep: ['E5', 'D5', 'C5', 'G5'],   // lullaby-ish
    travel: ['C6', 'G5', 'C6', 'G5'],  // two-tone nudge
    heads: ['E6']                      // single "ting" heads-up
  };
  var VOICES = {
    bells: { type: 'sine', partial: 2.76, decay: 1.4, gap: 0.18 },
    marimba: { type: 'triangle', partial: 4, decay: 0.45, gap: 0.14 },
    bubbles: { type: 'sine', partial: 0, decay: 0.25, gap: 0.11, bend: true }
  };

  function play(kind, opts) {
    opts = opts || {};
    var a; try { a = audio(); } catch (e) { return; }
    if (!a) return;
    var v = VOICES[opts.chime] || VOICES.bells;
    var vol = Math.max(0, Math.min(1, opts.volume == null ? 0.6 : opts.volume)) * 0.35;
    var notes = TUNES[kind] || TUNES.focus;
    var t0 = a.currentTime + 0.05;
    var repeat = opts.repeat || 1;
    for (var r = 0; r < repeat; r++) {
      notes.forEach(function (n, i) {
        var t = t0 + r * (notes.length * v.gap + 0.6) + i * v.gap;
        tone(a, NOTE[n], t, v, vol);
        if (v.partial) tone(a, NOTE[n] * v.partial, t, Object.assign({}, v, { decay: v.decay * 0.4 }), vol * 0.18);
      });
    }
  }
  function tone(a, freq, t, v, vol) {
    var o = a.createOscillator(), g = a.createGain();
    o.type = v.type;
    o.frequency.setValueAtTime(v.bend ? freq * 0.7 : freq, t);
    if (v.bend) o.frequency.exponentialRampToValueAtTime(freq * 1.15, t + 0.12);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + v.decay);
    o.connect(g).connect(a.destination);
    o.start(t); o.stop(t + v.decay + 0.05);
  }

  function canNotify() { return 'Notification' in root; }
  function permission() { return canNotify() ? root.Notification.permission : 'unsupported'; }
  function askPermission() {
    if (!canNotify()) return Promise.resolve('unsupported');
    return Promise.resolve(root.Notification.requestPermission());
  }
  function notify(title, body, tag) {
    if (permission() !== 'granted') return;
    var opts = { body: body, tag: tag, icon: 'icons/icon.svg', badge: 'icons/icon.svg', renotify: true, silent: true };
    if (root.navigator.serviceWorker && root.navigator.serviceWorker.getRegistration) {
      root.navigator.serviceWorker.getRegistration().then(function (reg) {
        if (reg) return reg.showNotification(title, opts);
        new root.Notification(title, opts);
      }).catch(function () { try { new root.Notification(title, opts); } catch (e) {} });
    } else {
      try { new root.Notification(title, opts); } catch (e) {}
    }
  }

  root.SR = root.SR || {};
  root.SR.alarm = { play: play, unlock: unlock, unlocked: unlocked, notify: notify, askPermission: askPermission, permission: permission };
})(this);
