import Image from "next/image";
import { APP_VERSION } from "@/lib/app-version";

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
              <div className="page-header-title-row">
                <h1>Spoken <span>Page</span></h1>
                <span className="app-version">v{APP_VERSION}</span>
              </div>
              <p>Subtitle-ready listening synced with Audiobookshelf</p>
            </div>
          </div>
        </div>

      </div>
    </header>
  );
}
