/*
 * ShiftRhythm smart capture — runs entirely on your device.
 *
 *  parse(text)      turns "Plan the Builders Circle event by 28 Nov, about 8 hours"
 *                   into a task: title, deadline, total time, work/personal, priority.
 *  breakdown(task)  splits a task with a deadline into sensible steps and gives each
 *                   step a window of days, so the work is spread out before the deadline.
 *
 * No AI service and no network: it uses rules and templates. Inside Claude, the app can
 * optionally ask Claude to refine the step list; the scheduling still happens here.
 */
(function (root) {
  'use strict';
  var Sch = (typeof module !== 'undefined' && module.exports) ? require('./scheduler.js') : root.SR.scheduler;

  var MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  var DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  var MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
  var DAY_RE = '(sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?)';

  function pad(n) { return String(n).padStart(2, '0'); }
  function iso(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); }
  function validDay(y, m, d) { var dt = new Date(Date.UTC(y, m - 1, d)); return dt.getUTCMonth() === m - 1; }

  // ---------- types of work, with typical step lists ----------
  // weight = share of the total time; total = default estimate (minutes) when none is given
  var TYPES = [
    { id: 'event', label: 'Event', total: 480, words: /\b(event|meetup|meet-up|workshop|conference|summit|hackathon|webinar|launch|party|gathering|seminar|bootcamp|training session|programme|program)\b/,
      steps: [['Set goals, format and budget', 10], ['Confirm venue and date', 10], ['Invite speakers and partners', 15], ['Promotion plan and graphics', 15], ['Registration and logistics', 15], ['Agenda and run-of-show', 15], ['Final confirmations and reminders', 10], ['Materials and checklist for the day', 10]] },
    { id: 'content', label: 'Content', total: 300, words: /\b(video|content|reel|reels|shoot|film|filming|vlog|podcast|tiktok|youtube|post series|photoshoot|edit(?:ing)?)\b/,
      steps: [['Ideas, script and shot list', 20], ['Prepare location, outfit and gear', 10], ['Shoot', 25], ['Rough edit', 20], ['Final edit, captions and thumbnail', 15], ['Publish and promote', 10]] },
    { id: 'assessment', label: 'Security assessment', total: 600, words: /\b(vapt|pentest|pen test|penetration|vulnerability|assessment|audit|scan|red team)\b/,
      steps: [['Scope and rules of engagement', 10], ['Asset inventory and recon', 15], ['Testing session', 30], ['Validate findings and gather evidence', 15], ['Write the report', 20], ['Review and remediation plan', 10]] },
    { id: 'writing', label: 'Writing', total: 300, words: /\b(report|proposal|documentation|document|docs|policy|policies|article|newsletter|essay|letter|application|thesis|paper|write|writing|draft|sop|dpia|ropa|presentation|deck|slides)\b/,
      steps: [['Gather requirements and sources', 15], ['Outline', 10], ['Draft the first half', 25], ['Draft the second half', 25], ['Review and revise', 15], ['Final check and submit', 10]] },
    { id: 'study', label: 'Study', total: 720, words: /\b(exam|test|study|course|certification|certificate|cert|module|revise|revision|syllabus|learn|quiz)\b/,
      steps: [['Map the syllabus and plan', 5], ['Study block', 55], ['Practice questions', 20], ['Review weak areas', 10], ['Mock exam', 10]] },
    { id: 'outreach', label: 'Outreach', total: 300, words: /\b(outreach(?:es)?|campaign|community|visit|school visit|partnership|sponsors?|fundrais\w*|donors?|volunteers?)\b/,
      steps: [['Pick targets and goals', 15], ['Prepare materials and message', 25], ['Reach out and schedule', 20], ['Follow up', 15], ['Run it', 15], ['Debrief and next steps', 10]] },
    { id: 'project', label: 'Project', total: 240, words: /\b(plan|organi[sz]e|prepare|project|build|set up|setup|launch|design|create|develop|research|migrate|implement)\b/,
      steps: [['Clarify the goal and break it down', 10], ['Work session', 70], ['Review and finish', 20]] }
  ];
  var WORK_WORDS = /\b(at work|during (?:my |the )?shift|on shift|at the office|work task|for work)\b/;
  var HOME_WORDS = /\b(at home|after work|personal|off day|off-day)\b/;

  // ---------- dates ----------
  function nextWeekday(today, wd, forceNext) {
    var cur = Sch.weekday(today);
    var diff = (wd - cur + 7) % 7;
    if (diff === 0 && forceNext) diff = 7;
    return Sch.addDays(today, diff);
  }
  function monthIndex(word) { return MONTHS.indexOf(word.slice(0, 3)); }
  function dayIndex(word) { return DAYS.indexOf(word.slice(0, 3)); }

  // Finds the first date phrase. Returns {date, kind:'due'|'on', match, index} or null.
  function findDate(text, today, weekStartsOn) {
    var t = text.toLowerCase();
    var y0 = Number(today.slice(0, 4)), m0 = Number(today.slice(5, 7)), d0 = Number(today.slice(8, 10));
    var lead = '(?:(by|before|due|deadline(?: is)?|until|no later than|on|for|this|next)\\s+)?(?:the\\s+)?';
    var cands = [];
    function add(re, fn) {
      var m, rx = new RegExp(lead + re, 'g');
      while ((m = rx.exec(t))) { var d = fn(m); if (d) cands.push({ date: d, word: m[1] || '', match: m[0], index: m.index }); }
    }
    add('(today|tonight)\\b', function () { return today; });
    add('(day after tomorrow)\\b', function () { return Sch.addDays(today, 2); });
    add('(tomorrow|tmrw|tmr)\\b', function () { return Sch.addDays(today, 1); });
    add('in (\\d+|a|one|two|three|four|five|six) (day|days|week|weeks)\\b', function (m) {
      var n = { a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 }[m[2]] || Number(m[2]);
      return Sch.addDays(today, /week/.test(m[3]) ? n * 7 : n);
    });
    add('end of (?:the |this )?week\\b', function () { return Sch.addDays(Sch.weekStart(today, weekStartsOn), 6); });
    add('end of next week\\b', function () { return Sch.addDays(Sch.weekStart(today, weekStartsOn), 13); });
    add('end of (?:the |this )?month\\b', function () { var md = Sch.monthDates(today); return md[md.length - 1]; });
    add('(next|this) week\\b', function (m) { return m[2] === 'next' ? Sch.addDays(Sch.weekStart(today, weekStartsOn), 13) : Sch.addDays(Sch.weekStart(today, weekStartsOn), 6); });
    add('(\\d{4})-(\\d{2})-(\\d{2})\\b', function (m) { return validDay(+m[2], +m[3], +m[4]) ? iso(+m[2], +m[3], +m[4]) : null; });
    add('(\\d{1,2})(?:st|nd|rd|th)?(?: of)? ' + MONTH_RE + '\\b(?:,? (\\d{4}))?', function (m) {
      var d = +m[2], mo = monthIndex(m[3]) + 1, y = m[4] ? +m[4] : y0;
      if (!m[4] && (mo < m0 || (mo === m0 && d < d0))) y++;
      return validDay(y, mo, d) ? iso(y, mo, d) : null;
    });
    add(MONTH_RE + ' (\\d{1,2})(?:st|nd|rd|th)?\\b(?:,? (\\d{4}))?', function (m) {
      var mo = monthIndex(m[2]) + 1, d = +m[3], y = m[4] ? +m[4] : y0;
      if (!m[4] && (mo < m0 || (mo === m0 && d < d0))) y++;
      return validDay(y, mo, d) ? iso(y, mo, d) : null;
    });
    add('(\\d{1,2})/(\\d{1,2})(?:/(\\d{2,4}))?\\b', function (m) { // day/month (Ghana, UK)
      var d = +m[2], mo = +m[3], y = m[4] ? (m[4].length === 2 ? 2000 + +m[4] : +m[4]) : y0;
      if (!m[4] && (mo < m0 || (mo === m0 && d < d0))) y++;
      return mo >= 1 && mo <= 12 && validDay(y, mo, d) ? iso(y, mo, d) : null;
    });
    add(DAY_RE + '\\b', function (m) { return nextWeekday(today, dayIndex(m[2]), m[1] === 'next'); });
    add('the (\\d{1,2})(?:st|nd|rd|th)\\b', function (m) {
      var d = +m[2], y = y0, mo = m0;
      if (d < d0) { mo++; if (mo > 12) { mo = 1; y++; } }
      return validDay(y, mo, d) ? iso(y, mo, d) : null;
    });
    if (!cands.length) return null;
    cands.sort(function (a, b) { return b.match.length - a.match.length || a.index - b.index; });
    var c = cands[0];
    var dueWord = /^(by|before|due|deadline|until|no later than)/.test(c.word) || /\b(due|deadline|by)\b/.test(t.slice(Math.max(0, c.index - 12), c.index)) || /week|month/.test(c.match);
    return { date: c.date, kind: dueWord ? 'due' : 'on', match: c.match, index: c.index };
  }

  // "from 2pm to 6pm", "2-6pm", "14:00–18:00"
  function findRange(text) {
    var t = text.toLowerCase();
    var m = /\b(?:from\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|\u2013|to|till|until)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/.exec(t);
    if (!m || (!m[3] && !m[6] && !m[2] && !m[5])) return null;
    function to24(h, ap, other) { h = +h; ap = ap || other; if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0; return h; }
    var h1 = to24(m[1], m[3], m[6]), h2 = to24(m[4], m[6], null);
    if (!m[3] && m[6] === 'pm' && h1 + 12 <= h2 && +m[1] < 12) h1 = +m[1] + 12 <= h2 ? +m[1] + 12 : h1; // "2-6pm" -> 14-18
    var s1 = h1 * 60 + (m[2] ? +m[2] : 0), s2 = h2 * 60 + (m[5] ? +m[5] : 0);
    if (h1 > 23 || h2 > 23 || s2 <= s1) return null;
    return { time: pad(h1) + ':' + pad(m[2] ? +m[2] : 0), minutes: s2 - s1, match: m[0] };
  }

  function findTime(text) {
    var t = text.toLowerCase();
    var m = /\bat (\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\b/.exec(t) || /\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/.exec(t) || /\b(\d{1,2})\s*(am|pm)\b/.exec(t);
    if (!m) return null;
    var hh, mm, ap;
    if (m.length === 3 && /am|pm/.test(m[2] || '')) { hh = +m[1]; mm = 0; ap = m[2]; }
    else { hh = +m[1]; mm = m[2] ? +m[2] : 0; ap = m[3]; }
    if (ap) { ap = ap.replace(/\./g, ''); if (ap === 'pm' && hh < 12) hh += 12; if (ap === 'am' && hh === 12) hh = 0; }
    if (hh > 23 || mm > 59) return null;
    if (!ap && hh <= 6 && /\bat \d/.test(m[0])) hh += 12; // "at 3" means 3 pm
    return { time: pad(hh) + ':' + pad(mm), match: m[0] };
  }

  function findDuration(text) {
    var t = text.toLowerCase(), total = 0, matches = [], m;
    var words = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, half: 0.5 };
    var pre = '(?:(?:about|around|roughly|approx(?:imately)?|maybe|it(?:\'ll| will)? takes?|takes?|for|total(?:ly)?|of)\\s+)*';
    var post = '(?:\\s+(?:in total|total|altogether|of work))?';
    var rx = new RegExp(pre + '(?:' +
      '\\b(\\d+(?:\\.\\d+)?)\\s*(hours?|hrs?|h)(?:\\b|(?=\\d))(?:\\s*(?:and\\s*)?(\\d+)\\s*(?:minutes?|mins?|m)?\\b)?' + '|' +
      '\\b(\\d+)\\s*(minutes?|mins?|m)\\b' + '|' +
      '\\b(an?|one|two|three|four|five|six|half an?)\\s+(hours?|minutes?)\\b' + ')' + post, 'g');
    while ((m = rx.exec(t))) {
      var mins = 0;
      if (m[1]) mins = Number(m[1]) * 60 + (m[3] ? Number(m[3]) : 0);
      else if (m[4]) mins = Number(m[4]);
      else if (m[6]) { var n = /^half/.test(m[6]) ? 0.5 : words[m[6]]; mins = /^h/.test(m[7]) ? n * 60 : n; }
      if (mins > 0) { total += mins; matches.push(m[0]); }
    }
    var perSession = /\b(each|every|per session|a day|daily|each time)\b/.test(t);
    return total ? { minutes: Math.round(total), matches: matches, perSession: perSession } : null;
  }

  function cleanTitle(text, removals) {
    var t = ' ' + text + ' ';
    removals.forEach(function (r) { if (r) t = t.replace(new RegExp(r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), ' '); });
    t = t.replace(/\b(i need to|i have to|i must|i want to|i'd like to|i would like to|we need to|we have to|remind me to|don't forget to|please|let me|i should|i'm going to|i am going to|going to|gotta)\b/gi, ' ')
      .replace(/\b(it'll take|it will take|which takes|that takes|it takes|takes|should take|will take)\b/gi, ' ')
      .replace(/\b(urgent(?:ly)?|asap|as soon as possible|high priority|low priority|important|whenever|someday)\b/gi, ' ')
      .replace(/\b(at work|during (?:my |the )?shift|on shift|at the office|for work|at home|after work)\b/gi, ' ')
      .replace(/\b(by|before|due|deadline|until|on|for|this|next|the|about|around|roughly)\s*([,.;:!?]|$)/gi, '$2')
      .replace(/^\s*(also|and|then|plus|oh and)\b[,]?/i, ' ')
      .replace(/\s+([,.;:!?])/g, '$1').replace(/[,.;:!?\s]+$/g, '').replace(/^[,.;:!?\s-]+/g, '').replace(/\s{2,}/g, ' ').trim();
    t = t.replace(/\s+(by|before|due|on|for|and|about|around)$/i, '').trim();
    return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
  }

  // The type whose keyword appears first wins ("prepare the deck for the workshop" is writing).
  function detectType(text) {
    var t = text.toLowerCase(), best = null, bestAt = Infinity;
    for (var i = 0; i < TYPES.length; i++) {
      if (TYPES[i].id === 'project') continue;
      var m = TYPES[i].words.exec(t);
      if (m && m.index < bestAt) { best = TYPES[i]; bestAt = m.index; }
    }
    if (!best && TYPES[TYPES.length - 1].words.test(t)) best = TYPES[TYPES.length - 1];
    return best;
  }

  // "every day", "daily", "3 times a week", "twice a month", "every Monday and Thursday"
  function findRecurrence(text) {
    var t = text.toLowerCase(), m;
    var nums = { once: 1, twice: 2, thrice: 3, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };
    if ((m = /\b(every ?day|daily|each day)\b/.exec(t))) return { per: 'day', times: 1, match: m[0] };
    if ((m = /\b(once|twice|thrice|\d+|one|two|three|four|five|six|seven)(?: times)? (?:a|per|each|every) (day|week|month)\b/.exec(t)))
      return { per: m[2], times: nums[m[1]] || Number(m[1]) || 1, match: m[0] };
    if ((m = new RegExp('\\b(?:every|on) ' + DAY_RE + '(?:s)?(?:(?:,| and| &) ' + DAY_RE + '(?:s)?)*', 'g').exec(t)) && /every|s\b/.test(m[0])) {
      var wds = (m[0].match(new RegExp(DAY_RE, 'g')) || []).map(dayIndex);
      return { per: 'week', times: wds.length, weekdays: wds, match: m[0] };
    }
    if ((m = /\b(every ?week|weekly|each week)\b/.exec(t))) return { per: 'week', times: 1, match: m[0] };
    if ((m = /\b(every ?month|monthly|each month)\b/.exec(t))) return { per: 'month', times: 1, match: m[0] };
    return null;
  }

  // ---------- parse ----------
  function parseOne(text, today, settings) {
    settings = settings || {};
    var raw = String(text || '').trim();
    if (!raw) return null;
    var t = raw.toLowerCase();
    var ws = settings.weekStartsOn == null ? 1 : settings.weekStartsOn;
    var rec = findRecurrence(raw);
    var range = findRange(raw);
    var date = rec ? null : findDate(raw, today, ws), time = range || findTime(raw), dur = range ? { minutes: range.minutes, matches: [] } : findDuration(raw);
    var type = detectType(raw);
    var when = WORK_WORDS.test(t) ? 'during' : 'outside';
    if (!WORK_WORDS.test(t) && !HOME_WORDS.test(t) && type && type.id === 'assessment') when = 'during';
    var priority = /\b(urgent|asap|as soon as possible|high priority|important|critical)\b/.test(t) ? 1 : /\b(low priority|whenever|someday|no rush)\b/.test(t) ? 3 : 2;
    var removals = [];
    if (date) removals.push(date.match);
    if (rec) removals.push(rec.match);
    if (time) removals.push(time.match);
    if (dur) removals = removals.concat(dur.matches);
    var title = cleanTitle(raw, removals) || raw.slice(0, 80);

    var due = '', on = '';
    if (date) { if (date.kind === 'due') due = date.date; else on = date.date; }
    var totalMin = dur ? dur.minutes : 0;
    // A project = has a deadline (or a day far enough away) and is too big for one sitting
    var quick = /^\s*(?:(?:i need to|i have to|i must|remind me to|please|also|and)\s+)*(send|email|e-mail|call|phone|text|message|whatsapp|reply|respond|buy|book|pay|submit|print|pick up|collect|confirm|share|post|upload|schedule|register|sign|renew|check|ask|tell|remind|forward|download|order|return)\b/.test(t);
    var looksBig = !quick && (type && type.id !== 'project' ? true : /\b(plan|organi[sz]e|prepare|project)\b/.test(t));
    var deadline = due || (on && !time && looksBig ? on : '');
    var isProject = !!deadline && !time && ((totalMin >= 120 && !quick) || (!totalMin && looksBig));
    if (isProject && !totalMin) totalMin = (type || TYPES[TYPES.length - 1]).total;
    if (isProject) { due = deadline; on = ''; }
    if (rec) isProject = false;
    return {
      recurrence: rec ? { per: rec.per, times: Math.min(14, rec.times), weekdays: rec.weekdays || [] } : null,
      text: raw, title: title.slice(0, 120), type: type ? type.id : 'task', typeLabel: type ? type.label : 'Task',
      isProject: isProject, totalMin: totalMin || 30, durationMin: isProject ? null : Math.min(totalMin || 30, 600),
      due: due, date: on, fixedTime: time ? time.time : '', when: when, priority: priority,
      guessed: { duration: !dur, deadline: !date }
    };
  }

  // Several tasks in one go: split on new lines, "also", "then", semicolons and full stops.
  function parse(text, today, settings) {
    var parts = String(text || '').split(/\n+|;|\.\s+(?=[A-Z])|\b(?:and also|also,|plus|then i (?:need|have) to)\b/i)
      .map(function (s) { return (s || '').trim(); })
      .filter(function (s) { return s && s.length > 2; });
    return parts.map(function (p) { return parseOne(p, today, settings); }).filter(Boolean);
  }

  // ---------- breakdown ----------
  // Returns steps [{title, minutes, after, due}] spread from `start` to the deadline.
  function breakdown(task, opts) {
    opts = opts || {};
    var today = opts.today;
    var start = opts.start || today;
    var due = task.due || Sch.addDays(start, 6);
    var type = null;
    for (var i = 0; i < TYPES.length; i++) if (TYPES[i].id === task.type) type = TYPES[i];
    if (!type) type = TYPES[TYPES.length - 1];
    var total = Math.max(30, task.totalMin || type.total);
    var short = task.title.length > 38 ? task.title.slice(0, 36).trim() + '…' : task.title;
    var maxSession = Math.max(60, opts.maxSession || 120);

    var raw = (opts.steps && opts.steps.length ? opts.steps : type.steps.map(function (s) { return { title: s[0], weight: s[1] }; }));
    var weightSum = raw.reduce(function (a, s) { return a + (s.weight || (s.minutes ? 0 : 1)); }, 0) || 1;
    var steps = [];
    raw.forEach(function (s) {
      var mins = s.minutes ? s.minutes : Math.round(total * (s.weight || 1) / weightSum / 5) * 5;
      mins = Math.max(15, mins);
      var n = Math.max(1, Math.ceil(mins / maxSession));
      for (var k = 0; k < n; k++) {
        var each = Math.round(mins / n / 5) * 5;
        steps.push({ title: s.title + (n > 1 ? ' (' + (k + 1) + '/' + n + ')' : ''), minutes: Math.max(15, each), step: s.title });
      }
    });

    // Finish a little early so there is slack: one day early for 1–3 weeks, two days for longer.
    var span = Sch.diffDays(start, due) + 1;
    var slack = span >= 21 ? 2 : span >= 5 ? 1 : 0;
    var lastDay = Sch.addDays(due, -slack);
    var days = Math.max(1, Sch.diffDays(start, lastDay) + 1);
    var n = steps.length;
    steps.forEach(function (s, j) {
      var a = Math.floor(j * days / n), b = Math.max(a, Math.floor((j + 1) * days / n) - 1);
      s.after = Sch.addDays(start, a);
      s.due = Sch.addDays(start, b);
      s.label = s.title + ' · ' + short;
    });
    return { steps: steps, totalMin: steps.reduce(function (a, s) { return a + s.minutes; }, 0), start: start, due: due, finishBy: lastDay, typeLabel: type.label };
  }

  // ---------- roster codes ----------
  // Turns pasted roster codes for one month into {date: 'day'|'night'|'off'}.
  // Accepts a sequence ("D D N N O O O O ..." or "DDNNOOOO") starting on day 1,
  // or day/code pairs ("1 D, 2 D, 3 N" or "1:D 2:N").
  var CODE = {
    d: 'day', day: 'day', days: 'day', m: 'day', am: 'day', '7-19': 'day', '07-19': 'day', '7am-7pm': 'day',
    n: 'night', night: 'night', nights: 'night', nt: 'night', '19-7': 'night', '19-07': 'night', '7pm-7am': 'night',
    o: 'off', off: 'off', r: 'off', rest: 'off', x: 'off', '-': 'off', l: 'off', al: 'off', leave: 'off', h: 'off', hol: 'off', holiday: 'off', 'day off': 'off'
  };
  function parseRoster(text, month) {
    var out = {}, unknown = [];
    if (!/^\d{4}-\d{2}$/.test(month || '')) return { shifts: out, unknown: ['month'] };
    var dates = Sch.monthDates(month + '-01');
    var t = String(text || '').toLowerCase().replace(/day off/g, 'off');
    var pairs = [], m, rx = /\b(\d{1,2})\s*[:=.\-)]?\s*([a-z]+|\d{1,2}-\d{1,2}|-)(?=[\s,;]|$)/g;
    while ((m = rx.exec(t))) pairs.push(m);
    if (pairs.length >= 3) {
      pairs.forEach(function (p) {
        var day = Number(p[1]), code = CODE[p[2]];
        if (day >= 1 && day <= dates.length && code) out[dates[day - 1]] = code; else unknown.push(p[0].trim());
      });
    } else {
      var tokens = t.split(/[\s,;|\/]+/).filter(Boolean);
      if (tokens.length === 1 && /^[dnorx-]+$/.test(tokens[0]) && tokens[0].length > 3) tokens = tokens[0].split('');
      var i = 0;
      tokens.forEach(function (tok) {
        var code = CODE[tok];
        if (!code) { unknown.push(tok); return; }
        if (i < dates.length) out[dates[i++]] = code;
      });
    }
    return { shifts: out, unknown: unknown.slice(0, 10) };
  }

  var API = { findRange: findRange, parseRoster: parseRoster, parse: parse, parseOne: parseOne, breakdown: breakdown, findDate: findDate, findDuration: findDuration, findTime: findTime, TYPES: TYPES };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else { root.SR = root.SR || {}; root.SR.smart = API; }
})(this);
