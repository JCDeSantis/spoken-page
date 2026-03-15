import Image from "next/image";
import { ThemeToggleBar } from "@/components/theme-toggle-bar";

export function SpokenPageHeader() {
  return (
    <header className="page-header">
      <div className="page-header-shell">
        <div className="page-header-brand">
          <div className="page-header-logo">
            <Image
              alt="Spoken Page logo"
              className="page-header-logo-image"
              height={485}
              priority
              sizes="(max-width: 820px) 80px, 96px"
              src="/spoken-page-logo-trimmed.png"
              width={649}
            />
          </div>

          <div className="page-header-copy">
            <div className="page-header-title-block">
              <h1>Spoken <span>Page</span></h1>
              <p>Subtitle-ready listening synced with Audiobookshelf</p>
            </div>
          </div>
        </div>

        <ThemeToggleBar className="page-header-theme" compact />
      </div>
    </header>
  );
}
