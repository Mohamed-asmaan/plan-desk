# Plan desk

A plan desk is a finite plan of days, and one place to do the day you are on. The calendar is the tool. The open day is the work. A focus timer and notes sit beside it.

This repository is that desk, loaded with one plan: two months of GSoC preparation, 26 October through 25 December 2026. The plan is the content. The desk is the product. Another plan can replace `plan.js` without turning this into a to-do list or a course site.

Progress stays in this browser. There is no account and no server.

## Open it

The app is static files. From this folder:

```bash
python -m http.server 8765
```

Then open `http://127.0.0.1:8765`. Opening `index.html` directly also works. Fonts load from Google Fonts, so the first view needs a network.

## The desk

- **Plan.** Month calendars on the left, one card per day on the right. The day you are on is highlighted, and scrolling the cards moves that highlight. Drag the handle between the two sides. Each side stops at a minimum width and reflows until then.
- **Edit** on the left pane reorders tiles, hides them, and sets Half or Full where a tile allows it. Month grids keep one size. Layout choices are saved on this device.
- **Focus.** A timer for the work in front of you. Hours land on the day.
- **Notes.** A note on a day remembers when it was written.
- **Calendar file.** Export an `.ics` from Google Calendar or Outlook and add it here. Events show on the matching date. This page cannot read those calendars live.
- **Settings.** Download a backup, or restore one, to move progress between your phone and your laptop.

## Files

| File | What it is |
| --- | --- |
| `index.html` | The page |
| `styles.css` | Layout and theme |
| `app.js` | The desk |
| `plan.js` | The plan: dates, tasks, and links |
| `favicon.svg` | The icon |

`plan.js` holds the plan text. The desk reads it. Study progress is not in these files.

## Your data

Saved in `localStorage` on this device:

| Key | What it holds |
| --- | --- |
| `gsoc-study-desk-v1` | Tasks done, day notes, focus log, timer, reminders |
| `gsoc-study-tiles` | Tile order, hidden tiles, sizes |
| `gsoc-study-layout` | Calendar pane width |
| `gsoc-study-rail` | Sidebar open or closed |
| `gsoc-study-cal` | Events from a calendar file you added |

A backup file is the way to move the study data. Clearing site data for this origin deletes it.
