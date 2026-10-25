# Plan desk

A plan desk is a finite plan of days, and one place to do the day you are on. The calendar is the tool. The open day is the work. A focus timer, notes and a whiteboard sit beside it.

This repository is that desk, loaded with one plan: two months of GSoC preparation, 26 October through 25 December 2026. The plan is the content. The desk is the product. Another plan can replace `plan.js` without turning this into a to-do list or a course site.

Progress stays in this browser. To keep a phone and a laptop in step, turn on sync (below). There is no server of our own.

## Open it

Published at <https://mohamed-asmaan.github.io/plan-desk/>. On a phone, use "Add to Home Screen" to install it. It then opens full screen and works offline.

To run it locally:

```bash
npm install
npm run dev
```

`npm run build` writes the site into `dist/`, and `npm run preview` serves that build. Fonts load from Google Fonts, so the first view needs a network.

Each address keeps its own progress: the local dev server and the published site do not share it. Use sync, or Download / Restore a backup, to move it.

## Deploy

Every push to `main` runs `.github/workflows/deploy.yml`, which builds the app and publishes it to GitHub Pages. In the repository settings, Pages must use "GitHub Actions" as its source.

## Sync between devices

Settings → Sync devices. Make a GitHub token with only the **gist** scope, paste it in, and press Connect. Do this on each device with the same token.

- Progress is mirrored to one private Gist named "GSoC plan desk sync" on your account.
- The app pulls when it opens, when you return to it, when it comes back online, and every two minutes. It pushes a few seconds after each change.
- Changes merge per task and per note, so a tick on the phone and a different tick on the laptop both survive. The focus timer and the whiteboard stay on each device.
- The token is stored in this browser only. Disconnect removes it.

## The desk

- **Plan.** Month calendars and progress on the left, one card per day on the right. The day you are on is highlighted, and scrolling the cards moves that highlight. Arrow keys move between days.
- **Phones.** One full-width month and one day card, with Previous / Today / Next. Progress, streak and key dates open from the % button in the header.
- **Focus.** A pomodoro timer and stopwatch. Time lands on the task you started it from. Daily reminders.
- **Notes.** A note remembers when it was written and last edited.
- **Board.** A whiteboard with pen, highlighter, shapes, arrows, text and sticky notes, zoom and pan, undo, and PNG export. Press `?` for shortcuts.
- **Settings.** Sync devices, and Download or Restore a backup.

## Files

| File | What it is |
| --- | --- |
| `index.html` | The page Vite loads |
| `src/` | The React app (see `.claude/skills/plan-desk-design` for the map) |
| `src/styles.css` | Layout and theme tokens |
| `plan.js` | The plan: dates, tasks, and links |
| `public/` | Icons, install manifest, offline service worker |

`plan.js` holds the plan text. Study progress is not in these files.

## Your data

Saved in `localStorage` on this device:

| Key | What it holds |
| --- | --- |
| `gsoc-study-desk-v1` | Tasks done, day notes, notes, focus log, timer, reminders |
| `gsoc-study-tiles` | Overview tile order, hidden tiles, sizes |
| `gsoc-study-layout` | Calendar pane width |
| `gsoc-study-rail` | Sidebar open or closed |
| `gsoc-study-board` | Whiteboard |
| `gsoc-study-sync` | Sync token, Gist id and the last synced copy |

A backup file or sync moves the study data. Clearing site data for this origin deletes it.
