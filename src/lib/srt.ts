import { SubtitleCue } from "@/lib/types";

function parseTimestamp(value: string) {
  const normalized = value.trim().replace(",", ".");
  const match = normalized.match(/^(?:(\d{1,3}):)?(\d{2}):(\d{2})\.(\d{1,3})$/);

  if (!match) {
    return Number.NaN;
  }

  const [, hoursText = "0", minutesText, secondsText, millisecondsText] = match;
  const hours = Number(hoursText);
  const minutes = Number(minutesText);
  const seconds = Number(secondsText);
  const milliseconds = Number(millisecondsText.padEnd(3, "0"));

  return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
}

/** Parses both SubRip (.srt) and WebVTT (.vtt) into the player's shared cue shape. */
export function parseSubtitle(text: string) {
  const normalized = text
    .replace(/^\uFEFF/, "")
    .replace(/\r/g, "")
    .replace(/^WEBVTT[^\n]*\n(?:\n)?/, "")
    .trim();

  if (!normalized) {
    return [] satisfies SubtitleCue[];
  }

  const blocks = normalized.split(/\n{2,}/);
  const cues: SubtitleCue[] = [];

  for (const block of blocks) {
    const lines = block.split("\n").map((line) => line.trimEnd());

    if (/^(NOTE|STYLE|REGION)(?:\s|$)/.test(lines[0] ?? "")) {
      continue;
    }

    if (lines.length < 2) {
      continue;
    }

    let cursor = 0;
    if (!lines[0]?.includes("-->") && lines[1]?.includes("-->")) {
      cursor = 1;
    }

    const timeLine = lines[cursor];
    if (!timeLine) {
      continue;
    }

    const match = timeLine.match(
      /((?:\d{1,3}:)?\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*((?:\d{1,3}:)?\d{2}:\d{2}[,.]\d{1,3})/,
    );

    if (!match) {
      continue;
    }

    const [, startText, endText] = match;
    const start = parseTimestamp(startText);
    const end = parseTimestamp(endText);
    const subtitleText = lines
      .slice(cursor + 1)
      .join("\n")
      .replace(/\{\\an\d\}/g, "")
      .replace(/<\/?(?:c(?:\.[^ >]+)?|i|b|u|ruby|rt|v|lang)(?:\s+[^>]*)?>/gi, "")
      .trim();

    if (!subtitleText || Number.isNaN(start) || Number.isNaN(end)) {
      continue;
    }

    cues.push({
      id: `${start}-${end}-${cues.length}`,
      start,
      end,
      text: subtitleText,
    });
  }

  return cues;
}

export const parseSrt = parseSubtitle;

export function findCueIndex(cues: SubtitleCue[], time: number) {
  let low = 0;
  let high = cues.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const cue = cues[mid];

    if (!cue) {
      return -1;
    }

    if (time < cue.start) {
      high = mid - 1;
      continue;
    }

    if (time > cue.end) {
      low = mid + 1;
      continue;
    }

    return mid;
  }

  return -1;
}
