"use client";

import { useEffect, useState } from "react";

type ThemeToggleBarProps = {
  className?: string;
  compact?: boolean;
};

export function ThemeToggleBar({ className = "", compact = false }: ThemeToggleBarProps) {
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("shelf-sync-theme");
    const nextTheme = savedTheme === "light" ? "light" : "dark";

    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("shelf-sync-theme", theme);
  }, [theme]);

  return (
    <div className={`theme-toolbar ${className}`.trim()}>
      <button
        className={`button button-secondary theme-toggle ${compact ? "theme-toggle-compact" : ""}`.trim()}
        onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
        type="button"
      >
        {compact
          ? theme === "dark"
            ? "Light mode"
            : "Dark mode"
          : theme === "dark"
            ? "Switch to light mode"
            : "Switch to dark mode"}
      </button>
    </div>
  );
}
