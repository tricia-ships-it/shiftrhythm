# ShiftRhythm

A private, offline planner that fits **your** week, whatever it looks like:

- **Shift workers:** rotating day and night shifts, a new roster each month.
- **Regular schedules:** a 9-to-5, school, lectures, any set days and hours (you name it).
- **Your time is your own:** freelancing, at home, retired, between jobs, or simply planning your life.

You tell it the things you want to do (workouts, study, practice, chores, side projects, family time) and what's coming up. It builds each day and week around your commitments, your sleep and your attention span, breaks big jobs into steps before their deadlines, plays a soft chime when it's time to switch, and rewards the days you show up with streaks and coins.

Everything runs on your own device. There is no account, server or analytics, and nothing leaves your device unless you turn on encrypted sync.

## What it does

- **Every hat you wear.** Pick what's part of your life: shift work, a full-time or part-time job, studies, freelancing, running an organisation, a community role, creative gigs, choir or faith group, family, job hunting, retirement. Each becomes an *area* with its own colour:
  - **Fixed-time areas** (classes, a part-time job, rehearsals) are blocked out every week, with travel. Tap *Not this time* to skip one.
  - **Flexible areas** ("about 6 hours a week" for your NGO or freelance work) get sessions in your free time. Tasks you add to the area count towards its hours.
  - The Week view shows **hours by area**, against each area's target.

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


## Step-by-step guide

### Step 1. Install it

Pick one place to run the app on each device. The installed app has its **own storage**, separate from the browser tab you installed it from, so do your setup inside the installed app.

**Laptop (Windows, macOS or Linux), easiest:**
1. Open your GitHub Pages link (for example `https://<your-username>.github.io/shiftrhythm/`) in **Chrome or Edge**.
2. Click the **Install** icon at the right of the address bar (a screen with a down arrow), or open the ⋮ menu → **Cast, save and share → Install page as app**.
3. ShiftRhythm now opens in its own window and from your Start menu, Dock or app launcher, and works offline.

**Laptop, fully local (no website at all):**
1. Download this repository (green **Code** button → **Download ZIP**) and unzip it.
2. Start it: double-click `start.bat` on Windows, or run `./start.sh` on macOS / Linux. You need Python 3.
3. Your browser opens at `http://127.0.0.1:8642/`. Keep the small terminal window open while you use it. You can install it from there too, the same way as above.

The local server only answers on `127.0.0.1`, only serves the app's own files, and sends strict security headers.

**iPhone (iOS 16.4 or later):**
1. Open your link in **Safari** (not Chrome, which can't install apps on iPhone).
2. Tap the **Share** button → **Add to Home Screen** → **Add**.
3. Open ShiftRhythm from the new home-screen icon. Allow notifications when it asks.

**Android (including Huawei phones with Google services or Petal/Huawei Browser):**
1. Open your link in **Chrome** (or Huawei Browser).
2. Tap ⋮ → **Install app** or **Add to Home screen**.
3. Open ShiftRhythm from the new icon and allow notifications.

### Step 2. Set it up the first time

The welcome screen walks you through it in about three minutes:

1. **Welcome.** If you already use ShiftRhythm on another device, choose **Already using ShiftRhythm on another device? → Sync from your other device** and skip to Step 6. To move a backup file across, choose **Restore a backup file**.
2. **Your life.** Tap everything that's part of your week (shift work, full-time job, studies, freelancing, an organisation you run, choir, family…). Each one becomes an *area*. Then choose your **main schedule**: rotating shifts, a regular week, or free time.
3. **Areas.** For each area, choose:
   - **Fixed time**: the same slot every week (for example *Choir, Thursday 19:00–21:00, 30 min travel*), and which kinds of day it's allowed on; or
   - **Flexible**: a weekly target (for example *about 6 hours a week*) that ShiftRhythm fits into your free time.
   You can pause an area at any time without deleting it.
4. **Your shifts or work hours.** Enter your start and end times, travel time and getting-ready time. For shifts, set up your rotation pattern, or import this month's roster (Step 5).
5. **Sleep and focus.** Set your wake times, bedtime, rest after a night shift and your focus rhythm (for example 30 min focus, 15 min break).
6. **Tasks.** Start from the examples or add your own. Then turn on alarms.

### Step 3. Use it every day

- **Today** shows what's happening now, a countdown to the next thing, your progress ring and your streak. Tap **Done** as you finish each block. When a chime rings, it's time to switch.
- On a fixed-area block, tap **Not this time** to skip it just this once; the rest of the day is replanned.
- **Week** shows the whole week day by day, plus **hours by area** against each area's target.
- Check the **briefing** at the top of Today each morning: your shift, when to leave, what's left, how each project is going.

### Step 4. Add things as they come up

1. On **Today**, open **What's coming up?** and type or (if you've turned on voice) speak, for example:
   *"Plan the Builders Circle event by 28 Nov, about 8 hours. Call the venue tomorrow at 3pm. Gym 3 times a week."*
2. ShiftRhythm shows a card for each item: its deadline, length, area, whether it repeats, and, for bigger jobs, the **steps** it will break it into with a date window for each.
3. Change anything that's wrong (the area, the length, a step), then tap **Add task**, **Add project to my plan** or **Add all**. The rest of your plan is recalculated around it.
4. Projects appear in the **Projects** list, showing whether each one is on track.

For a recurring task, open **Tasks**, add or edit it and choose how often it repeats (per day, week or month), which kinds of day it may go on, whether it's outside or during your shift, the preferred time of day, and the priority.

### Step 5. Import your roster each month (shift workers)

1. Open **Shifts → Import this month's roster**.
2. Paste your codes, for example `D D N N O O O D D N N O O O…` or `1 D, 2 N, 3 O…`. (Inside Claude you can upload a photo of the roster instead.)
3. Check the preview calendar, then **Apply to my calendar**. Tap any single day on the calendar to change it later.

### Step 6. Sync your phones and laptop

Sync keeps one plan across all your devices. It is **end-to-end encrypted**: your devices encrypt everything with your passphrase before uploading, so GitHub only ever stores scrambled data.

**Once (on GitHub):**
1. Turn on **two-factor authentication** for your GitHub account (Settings → Password and authentication). This protects both your data and the app itself.
2. Create a new **private** repository called `shiftrhythm-data`. Leave it empty.

**On each device (laptop, iPhone, Android), inside the installed app:**
1. Create a **fine-grained** token for that device at <https://github.com/settings/personal-access-tokens/new>:
   - Name: the device, for example *ShiftRhythm – iPhone*. Expiry: up to 1 year.
   - Repository access: **Only select repositories → shiftrhythm-data**.
   - Permissions → Repository permissions → **Contents: Read and write**. Nothing else.
   - **Generate token** and copy it (it starts with `github_pat_`). Classic `ghp_` tokens are refused because they can reach all your repositories.
2. In ShiftRhythm open **Settings → Sync your devices** and enter your GitHub username, the repository name, the token, and your **sync passphrase**.
   - The first device creates the passphrase. Use **at least 12 characters**, ideally three or four random words. Write it down somewhere safe; nobody can recover it.
   - Every other device uses the **same passphrase**.
   - Tick **Remember the key on this device** on your own phones and laptop, so they sync automatically.
3. Tap **Connect and sync**. The first device uploads your plan. The others download it, then everything stays in step.

The app syncs when you open it, when you come back to it, and a few seconds after each change. If both devices change things while offline, the changes are merged: tasks from both are kept, and anything ticked done on either device stays done.

On a device where you didn't tick *Remember the key*, you'll be asked for the passphrase when you open the app. Tap **Disconnect this device** in Settings to remove the token and key from a device (for example before selling it), and delete that device's token on GitHub.

### Step 7. Keep reminders reliable

- Alarms ring while ShiftRhythm is open or recently in the background. Phones pause web apps after a while.
- For reminders when the app is closed, tap **Send to phone calendar (.ics)** once a week and open the file. Your phone's calendar then rings for each block.

### Step 8. Streaks and coins

A day counts when you finish more than half of its tasks: 1 coin, or 2 if you finish everything. Bonus coins arrive at 7, 14, 30, 60 and 100 days in a row. When a day slips, 3 coins freeze it automatically so your streak survives (you can turn this off in Settings).

### Step 9. Back up

Every few weeks, open **Settings → Backup**, enter a passphrase and tap **Save backup** to get an **encrypted** file. Keep it somewhere other than your phone. **Restore** brings it back on any device.

## How the scheduler works

`js/scheduler.js` is a pure function with no browser code, so it's easy to test and reuse:

1. It lays down shifts, travel, getting-ready time, sleep and naps for each day.
2. It works out the free time left in each day, plus the quiet time inside shifts (after a settling-in period) for work tasks.
3. It expands recurring tasks into instances: per day, per calendar week spread across the allowed days, or per month spread across the month.
4. It places them in order: fixed times first, then priority, then overdue, then deadline, then tasks with the fewest options, then the longest. Each one is split into focus sessions with a break after each.
5. It reports anything it couldn't place, and why.

The planning window runs from today to the end of next week, so weekly goals are always planned against whole weeks.


## Privacy and security

- **Your data stays on your devices**, in the browser's storage. With sync off, the app makes no network requests at all.
- **One allowed destination.** The Content Security Policy only lets the app contact `api.github.com`, and only for sync. It only runs its own scripts, and refuses to run inside another site's frame.
- **End-to-end encrypted sync.** The key comes from your passphrase (PBKDF2-SHA-256, 600,000 rounds, as OWASP recommends) and is kept as a *non-extractable* browser key. Data is sealed with AES-GCM, so any tampering is detected, and an older copy put back on GitHub is ignored. Synced data is validated like an imported file before it's used.
- **Least-privilege token.** Only fine-grained tokens limited to one repository are accepted. The token is stored encrypted on the device and never goes into your plan, backups or synced data.
- **No dependencies.** Plain JavaScript with no frameworks, packages, CDNs or web fonts, so there's no third-party supply chain.
- **Untrusted input is handled safely.** All text is rendered with `textContent`, never `innerHTML`. Imported backups and synced data are validated field by field, with size limits and protection against prototype pollution.
- **Voice typing is opt-in.** Chrome and Edge send that audio to Google or Microsoft. Your keyboard's own dictation works without it.
- **Protect your devices and GitHub account.** Anyone with your unlocked device can read your plan, so use a screen lock. Turn on two-factor authentication on GitHub, because whoever controls the account that hosts the app controls its code.

See [SECURITY.md](SECURITY.md) for the full threat model and how to report a problem.

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
js/areas.js           life areas: personas, fixed and flexible areas, hours by area
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
