# ShiftRhythm

A private, offline planner for people who work **rotating day and night shifts**.

Most planners assume you wake at 7 and work 9 to 5. ShiftRhythm starts from your rota instead. You enter your shifts and the things you want to do regularly (workouts, practice, rehearsals, side projects, admin). It then builds each day and week around your work, your sleep and your attention span, and plays a soft chime when it's time to switch tasks.

Everything runs on your own device. There's no account, server, analytics or network access.

## What it does

- **Shift-aware days.** It handles day shifts, night shifts that cross midnight, travel time, time to get ready, sleep after a night shift, and a nap before the first night of a run.
- **Recurring tasks, scheduled automatically.** Set something to repeat *n* times per day, week or month. ShiftRhythm spreads it across the allowed days and resets each day, week and month.
- **Rules for each task:**
  - which kinds of day it's allowed on: off days, day-shift days, night-shift days, each set to yes, no or *weekends only* (for example, choir rehearsal only on off days or on weekend shifts);
  - whether it happens **outside your shift** (personal), **during your shift** (work tasks), or either;
  - preferred time of day, an optional fixed start time, priority, and *keep in one block* (for workouts and rehearsals).
- **Your focus rhythm.** Pick an attention span such as 30 min focus and 15 min break. Long tasks are split into sessions with breaks between them.
- **Daily limits.** Shift days get a smaller budget for personal tasks, so you aren't overloaded after a 12-hour shift. Work tasks done during the shift don't count towards it.
- **Something new came up?** Add it from Today and the rest of the day or week is recalculated.
- **Could not fit.** Anything that doesn't fit is listed with the reason.
- **Alarms.** A chime (bells, marimba or bubbles, all synthesized in the browser) and a notification when a focus session, break, getting ready, travel, nap or bedtime starts. There's an optional heads-up a few minutes before tasks, plus snooze.
- **Send to phone calendar.** Exports the plan as an `.ics` file with alarms, so your phone's calendar can remind you even when ShiftRhythm is closed.
- **Backups.** Save your data to a file, optionally encrypted with a passphrase (AES-GCM 256, PBKDF2-SHA-256), and restore it on another device.
- **Works offline** and can be installed as an app (PWA).

## Run it on your computer

You need Python 3, which macOS and most Linux systems already have. On Windows, install it from python.org or the Microsoft Store.

1. Download or clone this folder.
2. Start it:
   - **Windows:** double-click `start.bat`
   - **macOS / Linux:** run `./start.sh`
3. Your browser opens at `http://127.0.0.1:8642/`. Keep the small terminal window open while you use it.

The server listens on `127.0.0.1` only, so other devices on your network can't reach it.

You can also double-click `index.html` to open it straight from the file. Planning works that way, but browsers block notifications and offline install for files, so the launcher is better.

## Use it on your phone

ShiftRhythm is static files, so you can host your own copy on **GitHub Pages**: go to Settings → Pages and deploy from the `main` branch. Open the link on your phone and choose *Add to Home screen*.

The page only delivers the code. Your shifts and tasks are stored in that phone's browser and never go to GitHub or anywhere else.

> **About alarms on phones:** browsers can only ring while the app is open, either in the foreground or recently backgrounded. For alarms you can rely on with the app closed, tap **Send to phone calendar (.ics)** each week and open the file. Your phone's calendar then rings for each task.

## How the scheduler works

`js/scheduler.js` is a pure function with no browser code, so it's easy to test and reuse:

1. It lays down shifts, travel, getting-ready time, sleep and naps for each day.
2. It works out the free time left in each day, plus the quiet time inside shifts (after a settling-in period) for work tasks.
3. It expands recurring tasks into instances: per day, per calendar week spread across the allowed days, or per month spread across the month.
4. It places them in order: fixed times first, then priority, then overdue, then deadline, then tasks with the fewest options, then the longest. Each one is split into focus sessions with a break after each.
5. It reports anything it couldn't place, and why.

The planning window runs from today to the end of next week, so weekly goals are always planned against whole weeks.

## Privacy and security

- **No network.** The page's Content Security Policy sets `connect-src 'none'` and only allows its own scripts. Even a bug or an injected script can't send data anywhere.
- **No dependencies.** It's plain JavaScript with no frameworks, packages, CDNs or web fonts, so there's no supply chain to compromise. The whole app is under 2,000 lines you can read.
- **Untrusted input is handled safely.** All text is rendered with `textContent`, never `innerHTML`, and imported backups are validated field by field.
- **Your data stays local** in the browser's `localStorage` on your device. Anyone with access to your unlocked device and browser profile can read it, so use your device's screen lock. Encrypted backups protect the files you save.

See [SECURITY.md](SECURITY.md) to report a problem.

## Development

```sh
npm test                  # scheduler unit tests (Node 18+, no installs needed)
./start.sh                # run locally
```

Project layout:

```
index.html            app shell and Content Security Policy
css/app.css           styles (light and dark)
js/scheduler.js       planning engine (pure, testable in Node)
js/store.js           local storage, validation, encrypted backups
js/alarm.js           chimes (Web Audio) and notifications
js/ics.js             calendar export
js/app.js             user interface
sw.js                 offline cache
tests/                unit tests
```

Ideas and pull requests are welcome. Good next steps: custom shift types (for example a 10-hour evening shift), per-day hour overrides, drag-to-reschedule, and translations.

## License

MIT. See [LICENSE](LICENSE).
