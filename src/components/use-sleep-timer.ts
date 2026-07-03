"use client";

import { useEffect, useRef, useState } from "react";

export type SleepTimerSelection = "off" | "chapter" | 15 | 30 | 45 | 60;

export function formatSleepTimer(seconds: number) {
  const minutes = Math.floor(Math.max(seconds, 0) / 60);
  const remainder = Math.max(seconds, 0) % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

export function useSleepTimer(
  bookId: string | undefined,
  currentTime: number,
  chapterEnd: number | undefined,
  onExpire: () => void,
) {
  const [selection, setSelectionState] = useState<SleepTimerSelection>("off");
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [chapterTarget, setChapterTarget] = useState<number | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  function setSelection(next: SleepTimerSelection) {
    setSelectionState(next);
    if (typeof next === "number") {
      const deadline = Date.now() + next * 60_000;
      setExpiresAt(deadline);
      setChapterTarget(null);
      setRemainingSeconds(next * 60);
    } else {
      setExpiresAt(null);
      const target = next === "chapter" ? (chapterEnd ?? currentTime) : null;
      setChapterTarget(target);
      setRemainingSeconds(target === null ? 0 : Math.max(0, Math.ceil(target - currentTime)));
    }
  }

  useEffect(() => {
    setSelectionState("off");
    setExpiresAt(null);
    setChapterTarget(null);
    setRemainingSeconds(0);
  }, [bookId]);

  useEffect(() => {
    if (selection === "chapter") {
      const remaining = Math.max(0, Math.ceil((chapterTarget ?? currentTime) - currentTime));
      setRemainingSeconds(remaining);
      if (chapterTarget !== null && currentTime >= chapterTarget - 0.15) {
        setSelectionState("off");
        setChapterTarget(null);
        onExpireRef.current();
      }
      return;
    }

    if (!expiresAt) return;
    const update = () => {
      const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      setRemainingSeconds(remaining);
      if (remaining === 0) {
        setExpiresAt(null);
        setSelectionState("off");
        onExpireRef.current();
      }
    };
    update();
    const interval = window.setInterval(update, 1000);
    return () => window.clearInterval(interval);
  }, [chapterTarget, currentTime, expiresAt, selection]);

  return { selection, setSelection, remainingSeconds };
}
