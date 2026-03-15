import { SubtitleCue } from "@/lib/types";

function parseTimestamp(value: string) {
  const normalized = value.trim().replace(",", ".");
  const match = normalized.match(/^(\d{2}):(\d{2}):(\d{2})\.(\d{1,3})$/);

  if (!match) {
    return Number.NaN;
  }

  const [, hoursText, minutesText, secondsText, millisecondsText] = match;
  const hours = Number(hoursText);
  const minutes = Number(minutesText);
  const seconds = Number(secondsText);
  const milliseconds = Number(millisecondsText.padEnd(3, "0"));

  return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
}

export function parseSrt(text: string) {
  const normalized = text.replace(/\r/g, "").trim();

  if (!normalized) {
    return [] satisfies SubtitleCue[];
  }

  const blocks = normalized.split(/\n{2,}/);
  const cues: SubtitleCue[] = [];

  for (const block of blocks) {
    const lines = block.split("\n").map((line) => line.trimEnd());

    if (lines.length < 2) {
      continue;
    }

    let cursor = 0;
    if (/^\d+$/.test(lines[0] ?? "")) {
      cursor = 1;
    }

    const timeLine = lines[cursor];
    if (!timeLine) {
      continue;
    }

    const match = timeLine.match(
      /(\d{2}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{1,3})/,
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
