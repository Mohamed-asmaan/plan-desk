/* App line icons: 20px grid, 1.5 stroke, round caps (class .nav-icon). */
const PATHS = {
  plan: <><rect x="3" y="4.5" width="14" height="12" rx="2.5" /><path d="M3 8.5h14M7 2.75v3.5M13 2.75v3.5" /></>,
  focus: <><circle cx="10" cy="11" r="6.25" /><path d="M10 7.75V11l2.25 1.5M8 2.75h4" /></>,
  notes: <><path d="M4.5 3.5h11v8.25L11.75 15.5H4.5z" /><path d="M11.5 15.25V11.5h3.75M7.5 7.5h5M7.5 10h3" /></>,
  board: <><rect x="2.75" y="3.5" width="14.5" height="10.5" rx="2" /><path d="M6.5 10.5c1.4-2.6 2.6-3.6 3.5-2.4.8 1 1.8.4 3.5-1.6M7 17l3-3 3 3" /></>,
  code: <path d="M7.25 6.25 3.75 10l3.5 3.75M12.75 6.25 16.25 10l-3.5 3.75M11.25 4.75l-2.5 10.5" />,
  settings: <><circle cx="10" cy="10" r="2.5" /><path d="M10 2.75v2M10 15.25v2M2.75 10h2M15.25 10h2M4.87 4.87l1.42 1.42M13.71 13.71l1.42 1.42M4.87 15.13l1.42-1.42M13.71 6.29l1.42-1.42" /></>,
  stats: <path d="M4 16.25V11M10 16.25V4.75M16 16.25V8" />
};

export function Icon({ name }) {
  return <svg className="nav-icon" viewBox="0 0 20 20" aria-hidden="true">{PATHS[name]}</svg>;
}

/** The hand-drawn GSoC star (see the design skill). */
export function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 26 26" aria-hidden="true">
      <rect className="brand-star" x="4.1" y="4.1" width="17.8" height="17.8" />
      <path className="brand-star" d="M13 .4 25.6 13 13 25.6.4 13z" />
      <circle className="brand-core" cx="13" cy="13" r="7.3" />
      <path className="brand-glyph" d="M10.5 10.9 8.6 13l1.9 2.1M15.5 10.9l1.9 2.1-1.9 2.1M10.2 13h5.6" />
    </svg>
  );
}
