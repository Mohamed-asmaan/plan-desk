/* Line icons on a 20px grid, 1.5 stroke, round caps: the same family as
   the nav icons. */
const PATHS = {
  select: <path d="M5.5 3.5 15.25 9.4l-4.5 1.35-2.1 4.25z" />,
  hand: <path d="M7 10.5V5.25a1.25 1.25 0 0 1 2.5 0V9.5M9.5 9V4a1.25 1.25 0 0 1 2.5 0v5M12 9.25V5.5a1.25 1.25 0 0 1 2.5 0v5.75a5.25 5.25 0 0 1-5.25 5.25h-.6a4.9 4.9 0 0 1-4-2.05L2.9 11.5a1.2 1.2 0 0 1 1.85-1.5L7 12.25" />,
  pen: <><path d="m13.25 3.75 3 3L7 16l-3.75.75L4 13z" /><path d="m11.5 5.5 3 3" /></>,
  highlighter: <><path d="m11.25 3.5 5.25 5.25-5.75 5.75H7.25v-3.5z" /><path d="m8.5 6.25 5.25 5.25M7.25 14.5 5 16.75H2.75M10 17h7.25" /></>,
  eraser: <><path d="M8.5 16.5h8.75" /><path d="M3.9 12.1 11.4 4.6a1.5 1.5 0 0 1 2.1 0l2.9 2.9a1.5 1.5 0 0 1 0 2.1L9.5 16.5H7.3l-3.4-3.4a.7.7 0 0 1 0-1z" /><path d="m7.5 8.5 4 4" /></>,
  rect: <rect x="3.25" y="4.75" width="13.5" height="10.5" rx="1.75" />,
  ellipse: <ellipse cx="10" cy="10" rx="7" ry="5.75" />,
  arrow: <path d="M4.25 15.75 15.5 4.5M9 4.25h6.75V11" />,
  line: <path d="M4.25 15.75 15.75 4.25" />,
  text: <path d="M4.5 6V4.25h11V6M10 4.25v11.5M7.75 15.75h4.5" />,
  note: <><path d="M4 4h12v8l-4 4H4z" /><path d="M11.75 15.75V12H15.5" /></>,
  undo: <path d="M7.25 4.75 3.75 8.25l3.5 3.5M4 8.25h8.25a4 4 0 0 1 0 8H9.5" />,
  redo: <path d="m12.75 4.75 3.5 3.5-3.5 3.5M16 8.25H7.75a4 4 0 0 0 0 8h2.75" />,
  minus: <path d="M5 10h10" />,
  plus: <path d="M10 5v10M5 10h10" />,
  fit: <path d="M4 7.5V4h3.5M12.5 4H16v3.5M16 12.5V16h-3.5M7.5 16H4v-3.5" />,
  more: <><circle cx="4.75" cy="10" r=".9" /><circle cx="10" cy="10" r=".9" /><circle cx="15.25" cy="10" r=".9" /></>,
  duplicate: <><rect x="7.25" y="7.25" width="9.25" height="9.25" rx="1.75" /><path d="M12.75 7.25V5.25a1.5 1.5 0 0 0-1.5-1.5h-6a1.5 1.5 0 0 0-1.5 1.5v6a1.5 1.5 0 0 0 1.5 1.5h2" /></>,
  trash: <path d="M3.75 5.75h12.5M8 5.75v-1.5h4v1.5M5.5 5.75l.65 9.6a1.5 1.5 0 0 0 1.5 1.4h4.7a1.5 1.5 0 0 0 1.5-1.4l.65-9.6M8.5 9v4.5M11.5 9v4.5" />,
  download: <path d="M10 3.5v9M6.25 9 10 12.75 13.75 9M4 16.25h12" />,
  keyboard: <><rect x="2.5" y="5" width="15" height="10" rx="2" /><path d="M5.75 8.25h.5M9.75 8.25h.5M13.75 8.25h.5M6.5 11.75h7" /></>,
  close: <path d="m5.5 5.5 9 9M14.5 5.5l-9 9" />,
  clear: <path d="M4.5 4.5h11v11h-11zM8 8l4 4M12 8l-4 4" />,
  fillNone: <><rect x="4" y="4" width="12" height="12" rx="2" /><path d="M5 15 15 5" /></>,
  fillTint: <rect x="4" y="4" width="12" height="12" rx="2" className="wb-icon-fill" />
};

export function Icon({ name }) {
  return (
    <svg className="wb-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      {PATHS[name]}
    </svg>
  );
}
