"use client";

import { useEffect, useState } from "react";
import { PlayerPanel } from "@/components/player-panel";
import { ThemeToggleBar } from "@/components/theme-toggle-bar";
import { LibraryItemExpanded } from "@/lib/types";

type FocusPlayerShellProps = {
  itemId: string;
};

export function FocusPlayerShell({ itemId }: FocusPlayerShellProps) {
  const [item, setItem] = useState<LibraryItemExpanded | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  async function loadItem(targetItemId: string) {
    if (!targetItemId) {
      setItem(null);
      setState("error");
      setError("No Audiobookshelf item was selected.");
      return null;
    }

    setState("loading");
    setError(null);

    const response = await fetch(`/api/items/${targetItemId}`);
    const payload = (await response.json()) as LibraryItemExpanded | { error?: string };

    if (!response.ok || !("media" in payload)) {
      setState("error");
      setError(
        "error" in payload
          ? payload.error ?? "Unable to load the selected Audiobookshelf book."
          : "Unable to load the selected Audiobookshelf book.",
      );
      setItem(null);
      return null;
    }

    setItem(payload);
    setState("idle");
    return payload;
  }

  useEffect(() => {
    void loadItem(itemId);
  }, [itemId]);

  return (
    <main className="focus-page-shell">
      <div className="focus-topbar">
        <a className="button button-secondary" href="/">
          Back to library
        </a>
        <ThemeToggleBar className="theme-toolbar-inline" />
      </div>

      {state === "loading" ? <p className="status-message">Loading focused player...</p> : null}
      {error ? <p className="status-message status-error">{error}</p> : null}

      <div className="focus-player-frame">
        <PlayerPanel focusMode item={item} onItemRefresh={loadItem} />
      </div>
    </main>
  );
}
