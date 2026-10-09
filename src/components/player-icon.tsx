const paths = {
  play: "M7 4.5 16 10l-9 5.5Z",
  pause: "M7 5v10M13 5v10",
  back: "M6 5v4H2M3 9a7 7 0 1 1 2 6",
  forward: "M14 5v4h4M17 9a7 7 0 1 0-2 6",
  chapters: "M7 5h10M7 10h10M7 15h10M3 5h.1M3 10h.1M3 15h.1",
  fullscreen: "M3 8V3h5M12 3h5v5M17 12v5h-5M8 17H3v-5",
  exit: "M8 3v5H3M17 8h-5V3M12 17v-5h5M3 12h5v5",
  options: "M3 5h5M12 5h5M3 10h9M16 10h1M3 15h1M8 15h9M8 3v4M12 8v4M4 13v4",
  undo: "M6 4 2 8l4 4M2 8h10a5 5 0 0 1 0 10",
  close: "M5 5l10 10M15 5 5 15",
  popup: "M11 3h6v6M9 11l8-8M8 4H4v13h13v-5",
  keyboard: "M2 5h16v10H2ZM5 8h.1M8 8h.1M11 8h.1M14 8h.1M5 11h.1M8 11h6",
  sync: "M16 4v4h-4M4 16v-4h4M16 8a6 6 0 0 0-10-4M4 12a6 6 0 0 0 10 4",
  pull: "M10 3v10M6 9l4 4 4-4M3 13v4h14v-4",
  left: "M12 5l-5 5 5 5",
  right: "M8 5l5 5-5 5",
  moon: "M16 12a7 7 0 0 1-8-9A7 7 0 1 0 16 12Z",
  speaker: "M3 7h4l4-4v14l-4-4H3ZM14 6a6 6 0 0 1 0 8M16 3a10 10 0 0 1 0 14",
  muted: "M3 7h4l4-4v14l-4-4H3ZM14 7l4 6M18 7l-4 6",
} as const;

export function PlayerIcon({ name }: { name: keyof typeof paths }) {
  return <svg aria-hidden="true" viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>;
}
