import type { Chapter, SubtitleCue } from "./types";

export const SUBTITLE_FONTS = {
  default: "Arial, sans-serif",
  georgia: "Georgia, serif",
  verdana: "Verdana, sans-serif",
  trebuchet: '"Trebuchet MS", sans-serif',
  times: '"Times New Roman", serif',
} as const;

export type PlayerAppearance = {
  subtitleFont: keyof typeof SUBTITLE_FONTS;
  subtitleAlignment: "left" | "center" | "right";
  subtitleVerticalAlignment: "top" | "middle" | "bottom";
  subtitleSize: number;
  subtitleSizeMode: "manual" | "fill";
  showPreviousSubtitle: boolean;
  fullscreenBackground: "default" | "black" | "custom" | "cover";
  fullscreenCustomColor: string;
};

export function normalizePlayerAppearance(value: Partial<PlayerAppearance> & { subtitleScale?: string; subtitlePosition?: string } = {}): PlayerAppearance {
  return {
    subtitleFont: value.subtitleFont && Object.hasOwn(SUBTITLE_FONTS, value.subtitleFont) ? value.subtitleFont : "default",
    subtitleAlignment: value.subtitleAlignment === "left" || value.subtitleAlignment === "right" ? value.subtitleAlignment : "center",
    subtitleVerticalAlignment: value.subtitleVerticalAlignment === "top" || value.subtitleVerticalAlignment === "bottom" || value.subtitleVerticalAlignment === "middle"
      ? value.subtitleVerticalAlignment
      : value.subtitlePosition === "lower-third" ? "bottom" : value.subtitlePosition === "raised" ? "top" : "middle",
    subtitleSize: typeof value.subtitleSize === "number" && Number.isFinite(value.subtitleSize) ? Math.min(120, Math.max(22, value.subtitleSize)) : value.subtitleScale === "standard" ? 28 : value.subtitleScale === "x-large" ? 38 : 34,
    subtitleSizeMode: value.subtitleSizeMode === "fill" ? "fill" : "manual",
    showPreviousSubtitle: value.showPreviousSubtitle !== false,
    fullscreenBackground: value.fullscreenBackground === "black" || value.fullscreenBackground === "custom" || value.fullscreenBackground === "cover" ? value.fullscreenBackground : "default",
    fullscreenCustomColor: /^#[0-9a-f]{6}$/i.test(value.fullscreenCustomColor ?? "") ? value.fullscreenCustomColor! : "#302432",
  };
}

export function useDarkSubtitleText(color: string) {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return false;
  const channels = color.slice(1).match(/../g)!.map(value => {
    const channel = parseInt(value, 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]! > 0.18;
}

export function previousSubtitle(cues: SubtitleCue[], time: number, active?: SubtitleCue | null) {
  let previous: SubtitleCue | null = null;
  for (const cue of cues) {
    if (cue !== active && cue.end <= time && (!previous || cue.end > previous.end)) previous = cue;
  }
  return previous;
}

export function chapterMarkers(chapters: Chapter[], duration: number) {
  if (!(duration > 0)) return [];
  return chapters.flatMap((chapter, index) => Number.isFinite(chapter.start) && chapter.start >= 0 && chapter.start < duration ? [{ index, percent: chapter.start / duration * 100 }] : []);
}

/** One undo target per intentional jump; an entire slider gesture has one origin. */
export class SeekUndoHistory {
  private origin: number | null = null;
  private previous: number | null = null;
  private previousBeforeGesture: number | null = null;

  begin(time: number) {
    if (this.origin === null) {
      this.origin = time;
      this.previousBeforeGesture = this.previous;
    }
  }
  remember(from: number, to: number) {
    const origin = this.origin ?? from;
    if (Math.abs(origin - to) > 0.01) this.previous = origin;
    else if (this.origin !== null) this.previous = this.previousBeforeGesture;
  }
  end() { this.origin = null; this.previousBeforeGesture = null; }
  target() { return this.previous; }
  undo() { const target = this.previous; this.clear(); return target; }
  clear() { this.previous = null; this.origin = null; this.previousBeforeGesture = null; }
}
