# ShiftRhythm

A private, offline planner that fits **your** week, whatever it looks like:

- **Shift workers:** rotating day and night shifts, a new roster each month.
- **Regular schedules:** a 9-to-5, school, lectures, any set days and hours (you name it).
- **Your time is your own:** freelancing, at home, retired, between jobs, or simply planning your life.

You tell it the things you want to do (workouts, study, practice, chores, side projects, family time) and what's coming up. It builds each day and week around your commitments, your sleep and your attention span, breaks big jobs into steps before their deadlines, plays a soft chime when it's time to switch, and rewards the days you show up with streaks and coins.

Everything runs on your own device. There's no account, server, analytics or network access.

## What it does

- **Say it, it plans it.** Type or speak what's coming up, for example *"Plan the Builders Circle event by 28 Nov, about 8 hours. Call the venue tomorrow at 3pm. Gym 3 times a week."* ShiftRhythm works out each item: the deadline, how long it takes, whether it's a work task, whether it repeats, and how urgent it is.
- **Automatic project breakdown.** A task with a deadline is broken into sensible steps for its kind of work (events, content, security assessments, writing, study, outreach). Each step gets its own window of days, finishing a little before the deadline, and is fitted around your shifts. You see where every step will land, and if it won't all fit, the smallest deadline that would work.
- **Daily briefing.** Your shift, when to leave, recovery sleep, what's left today, how each project is going (on track or behind), and your weekly goals so far.
- **Optional extras inside Claude.** When opened inside Claude, there's also a *Refine steps with Claude* button and an *Ask Claude how to approach today* button. The standalone app never uses them.
- **Shift-aware days that follow how you actually sleep.** It handles day shifts, night shifts that cross midnight, travel time and time to get ready. You set your own times for:
  - waking on a normal off day (for example 06:00);
  - waking the morning after a day shift (for example 10:00);
  - after a night shift, staying up for a while and then resting in the afternoon (for example 12:30–17:00) before sleeping again at bedtime;
  - sleeping through the day between back-to-back nights, and a nap before the first night of a run.
- **Settling-in and handover.** Work tasks keep clear of the first and last part of each shift, and follow your focus rhythm in between.
- **Morning routine.** Tasks set to *first thing after waking* run back to back from your wake time, in order: for example exercise, wash, breakfast, cleaning, voice training.
- **Two kinds of off day.** Each task can be allowed or blocked separately on a normal off day and on the first off day after a shift, alongside day-shift and night-shift days.
- **Monthly roster import.** Paste your codes for the month (`D D N N O O…` or `1 D, 2 N…`), check them on a calendar, and apply. Inside Claude you can upload a photo of the roster instead, and Claude reads your row.
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
- **Encrypted sync between your devices.** Your phone and laptop share the same plan through a private GitHub repository of your own. Everything is encrypted on the device with your passphrase (AES-GCM 256), so GitHub only stores scrambled data. The token you create can only touch that one repository. Ticks and new tasks from both devices are merged, and nothing you finished is lost.
- **Streaks, coins and freezes.** A day counts when you finish more than half of its tasks. It earns a coin, or two if you finish everything. Count your days in a row, collect bonus coins at 7, 14, 30, 60 and 100 days, and when a day slips, 3 coins freeze it automatically so your streak survives. Frozen days get a snowflake on your two-week tracker.
- **Colourful light and dark themes.** The day's colours follow your shift: sunrise for day shifts, twilight for nights, fresh greens for off days. There's a progress ring, a streak counter and a little confetti when you finish something. Switch between Auto, Light and Dark from the top bar.
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

## Sync your phone and laptop

1. On GitHub, create a new **private** repository called `shiftrhythm-data` and leave it empty.
2. Create a fine-grained token at <https://github.com/settings/personal-access-tokens/new>:
   - Repository access: **Only select repositories → shiftrhythm-data**
   - Permissions → Repository permissions: **Contents: Read and write**. Nothing else.
3. In ShiftRhythm, open **Settings → Sync your devices**. Enter your username, the token and a passphrase, then connect.
4. Do the same on your other device with the **same passphrase**.

The app syncs when you open it, when you come back to it, and a few seconds after each change. If you forget the passphrase, nobody can read the synced copy, but each device still keeps its own.

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

- **Voice typing is opt-in.** The *Speak* button uses your browser's speech recognition only after you turn it on. Chrome and Edge send that audio to Google or Microsoft. Your keyboard's own dictation works without it.
- **One allowed destination.** The page's Content Security Policy only lets the app contact `api.github.com`, and only for sync. It only allows its own scripts. With sync off, it makes no network requests at all.
- **End-to-end encrypted sync.** The key comes from your passphrase (PBKDF2-SHA-256, 310,000 rounds) and is stored in the browser as a *non-extractable* key. Data is sealed with AES-GCM, so tampering is detected. The passphrase is never stored, and the token is never written into your plan or backups.
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
js/smart.js           understands typed/spoken tasks and breaks projects into steps (local rules)
js/capture.js         capture panel, projects, daily briefing, voice typing, roster import
js/sync.js            end-to-end encrypted sync via a private GitHub repository
js/rewards.js         streaks, coins and streak freezes
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
