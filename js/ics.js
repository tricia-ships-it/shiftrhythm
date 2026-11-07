/*
 * Export the plan as an .ics calendar file, with alarms, so your phone's own
 * calendar can ring even when ShiftRhythm is closed. The file is created on
 * your device; you import it yourself.
 */
(function (root) {
  'use strict';
  function esc(s) { return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }
  function stamp(date, time) { return date.replace(/-/g, '') + 'T' + time.replace(':', '') + '00'; }
  function fold(line) {
    var out = [];
    while (line.length > 74) { out.push(line.slice(0, 74)); line = ' ' + line.slice(74); }
    out.push(line);
    return out.join('\r\n');
  }

  // kinds: which block kinds to include. Times are "floating" (your local time).
  function build(plan, kinds, headsUpMin) {
    var now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    var lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ShiftRhythm//Local planner//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:ShiftRhythm'];
    plan.blocks.forEach(function (b) {
      if (kinds.indexOf(b.kind) < 0 || b.done) return;
      var title = b.kind === 'task' ? b.title + (b.part ? ' (' + b.part + ')' : '') : b.title;
      lines.push('BEGIN:VEVENT');
      lines.push('UID:' + esc(b.id.replace(/[^A-Za-z0-9@:#.-]/g, '-')) + '@shiftrhythm.local');
      lines.push('DTSTAMP:' + now);
      lines.push('DTSTART:' + stamp(b.date, b.startTime));
      lines.push('DTEND:' + stamp(b.endDate, b.endTime));
      lines.push(fold('SUMMARY:' + esc(title)));
      if (b.kind === 'task' || b.kind === 'break' || b.kind === 'commute' || b.kind === 'prep') {
        lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', fold('DESCRIPTION:' + esc(title)), 'TRIGGER:-PT0M', 'END:VALARM');
        if (headsUpMin > 0 && b.kind !== 'break') lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', fold('DESCRIPTION:' + esc('In ' + headsUpMin + ' min: ' + title)), 'TRIGGER:-PT' + headsUpMin + 'M', 'END:VALARM');
      }
      lines.push('END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    return lines.join('\r\n') + '\r\n';
  }

  root.SR = root.SR || {};
  root.SR.ics = { build: build };
})(this);
