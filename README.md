# Plan desk

A plan desk is a finite plan of days, and one place to do the day you are on. The calendar is the tool. The open day is the work. A focus timer and notes sit beside it.

This repository is that desk, loaded with one plan: two months of GSoC preparation, 26 October through 25 December 2026. The plan is the content. The desk is the product. Another plan can replace `plan.js` without turning this into a to-do list or a course site.

Progress stays in this browser. To keep a phone and a laptop in step, turn on sync (below). There is no server of our own.

## Open it

Published with GitHub Pages at <https://mohamed-asmaan.github.io/plan-desk/>. On a phone, use "Add to Home Screen" to install it. It then opens full screen and works offline.

To run it locally from this folder:

```bash
python -m http.server 8765
```

Then open `http://127.0.0.1:8765`. Fonts load from Google Fonts, so the first view needs a network.

Each address keeps its own progress. Progress at `127.0.0.1:8765` does not appear on the published site. Use sync, or Download / Restore a backup, to move it.

## Sync between devices

Settings → Sync devices. Make a GitHub token with only the **gist** scope, paste it in, and press Connect. Do this on each device with the same token.

- Progress is mirrored to one private Gist named "GSoC plan desk sync" on your account.
- The app pulls when it opens, when you return to it, and every two minutes. It pushes a few seconds after each change.
- Changes merge per task and per note, so a tick on the phone and a different tick on the laptop both survive. The focus timer stays on each device.
- The token is stored in this browser only. Disconnect removes it.

## The desk

- **Plan.** Month calendars on the left, one card per day on the right. The day you are on is highlighted, and scrolling the cards moves that highlight. Drag the handle between the two sides. Each side stops at a minimum width and reflows until then.
- **Edit** on the left pane reorders tiles, hides them, and sets Half or Full where a tile allows it. Month grids keep one size. Layout choices are saved on this device.
- **Focus.** A timer for the work in front of you. Hours land on the day.
- **Notes.** A note on a day remembers when it was written.
- **Phones.** One full-width month and one day card, with Previous / Today / Next. Progress, streak and key dates open from the % button in the header.
- **Settings.** Sync devices, and Download or Restore a backup.

## Files

| File | What it is |
| --- | --- |
| `index.html` | The page |
| `styles.css` | Layout and theme |
| `app.js` | The desk |
| `plan.js` | The plan: dates, tasks, and links |
| `favicon.svg` | The icon |
| `manifest.webmanifest`, `icons/` | Install to home screen |
| `sw.js` | Offline support (network first) |

`plan.js` holds the plan text. The desk reads it. Study progress is not in these files.

## Your data

Saved in `localStorage` on this device:

| Key | What it holds |
| --- | --- |
| `gsoc-study-desk-v1` | Tasks done, day notes, focus log, timer, reminders |
| `gsoc-study-tiles` | Tile order, hidden tiles, sizes |
| `gsoc-study-layout` | Calendar pane width |
| `gsoc-study-rail` | Sidebar open or closed |
| `gsoc-study-sync` | Sync token, Gist id and the last synced copy |

A backup file is the way to move the study data. Clearing site data for this origin deletes it.
