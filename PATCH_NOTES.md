# Spoken Page patch notes

## v1.1.2 — September 23, 2026

- Saved, recently played, and queued books now load into their shelves even when they are beyond the first page of the library.
- Kept the main library paginated so large collections still load in manageable pages.

## v1.1.1 — September 23, 2026

- Widened book cards and placed the series name and book number inside each card.
- Added clickable series names on cards and book details to filter the library.
- Added full-name hover text for book titles, authors, and series names on cards.
- Converted HTML-formatted book descriptions into readable text with paragraph breaks.

## v1.1.0 — July 3, 2026

Version 1.1 turns Spoken Page from a single-device companion player into a persistent, account-aware Audiobookshelf experience with a redesigned library and a substantially more capable player.

## New features

- Sign in with an Audiobookshelf username and password without copying an API key to every device.
- Keep encrypted login sessions across app restarts while never storing the Audiobookshelf password; users can sign in normally on each device without copying API keys.
- Sync favorites, recently played books, queues, reading status, subtitle choices, and player preferences through the Spoken Page data volume.
- Install Spoken Page as a PWA and use an offline fallback shell.
- Open a focused player route or pop playback into a separate window.
- Use Media Session controls, expanded keyboard shortcuts, playback speed controls, and a sleep timer.
- Queue the next title in a series.
- Use health and readiness endpoints for container monitoring.

## Library and book details

- Rebuilt the library into responsive, reusable shelves for all books, favorites, recently played, and saved titles.
- Added richer search, sorting, and metadata filters.
- Moved book information into a modal so selecting a title no longer jumps to content at the bottom of the library.
- Books enter Recently Played only after playback begins, not when their details are opened.
- Added expandable long synopses.
- Added manual reading statuses: Planned, In Progress, and Completed, with blank as the default.
- Added per-title favorite, dismiss, and queue actions.
- Standardized buttons, search fields, selectors, spacing, and interaction states across the application.
- Added the current app version to the header.

## Player and subtitles

- Improved multi-track playback and book-wide timeline handling.
- Added consolidated, ordered playback checkpoints to make progress syncing more reliable.
- Added automatic Audiobookshelf token refresh and retry for expired sessions.
- Improved chapter navigation, resume behavior, and player state restoration.
- Added `.vtt` support alongside `.srt`, plus remembered per-book subtitle source and timing offsets.
- Redesigned the sleep timer as a compact, touch-friendly pop-up.
- Updated Resume and Queue Next actions to use the same flat black treatment as player controls.
- Corrected modal close-button alignment and improved tablet sizing throughout the player.

## Deployment and security

- Added encrypted server-side session persistence using AES-256-GCM.
- Added stable secret rotation support with `SPOKEN_PAGE_PREVIOUS_SECRETS`.
- Locked production connections to a configured or allowlisted Audiobookshelf URL by default, reducing SSRF exposure.
- Kept tokens out of browser JavaScript with authenticated server-side proxy routes.
- Added input validation, request-size limits, login throttling, upstream timeouts, private/no-store responses, and structured request IDs.
- Added browser hardening headers for content sniffing, framing, referrers, and unused device permissions.
- Changed the production container to run as an unprivileged user and added persistent data storage plus health checks.
- Expanded CI and container publishing to run type checking, tests, and production builds before publishing.

## Fixes

- Improved reverse-proxy and subpath URL handling.
- Added clearer errors for unreachable, unauthorized, and incorrectly configured Audiobookshelf servers.
- Prevented cross-origin and cross-base-path upstream requests.
- Fixed stale or duplicate playback checkpoint ordering.
- Improved parsing of subtitle timing and malformed upstream responses.
- Fixed recent-book behavior, manual status persistence, modal layout, and several inconsistent control styles.

## Upgrade notes

Set these values before deploying v1.1:

```dotenv
SPOKEN_PAGE_SECRET=replace-with-a-long-random-value
SPOKEN_PAGE_ABS_BASE_URL=http://your-audiobookshelf-host:13378
```

Keep `SPOKEN_PAGE_SECRET` stable between restarts. The included Compose file automatically creates the persistent `/app/data` volume. Existing users should sign in once after upgrading from the older browser-token connection model.
