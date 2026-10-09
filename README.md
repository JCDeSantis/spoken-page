# Spoken Page

[![Version](https://img.shields.io/badge/version-v1.4.1-ff5664?style=for-the-badge)](https://github.com/JCDeSantis/spoken-page/releases/tag/v1.4.1)
![License](https://img.shields.io/badge/license-MIT-163434?style=for-the-badge)

![Spoken Page logo](public/spoken-page-logo-trimmed.png)

Spoken Page is a responsive, subtitle-first web player for [Audiobookshelf](https://github.com/advplyr/audiobookshelf). It keeps Audiobookshelf as the source of truth while adding a focused library and listening experience for desktop, tablet, and installable PWA use.

## What v1.4 adds

Version 1.4 adds matching library and fullscreen player controls, customizable subtitle fonts and alignment, fullscreen backgrounds, larger text and a Fill screen option. Chapter markers, a chapter popup, seek undo, remembered volume and subtitle click shortcuts make playback easier to navigate. The Spoken Page logo now appears in browser tabs.

Version 1.4.1 keeps fullscreen subtitles in the same position and at the same size when controls appear or hide, including Fill screen mode.

The release also retains complete-library search, Audiobookshelf-derived listening status, Want to listen preferences, remembered library views and series handling from v1.3. See [the library upgrades review](docs/LIBRARY_UPGRADES_REVIEW.md) and [initial validation report](docs/PHASE_0_2_REPORT.md). Offline downloads remain outside this release.

- A responsive cover gallery with a black and dark red theme
- Compact Pinned books that sync with your account and carry forward existing saved books
- Continue listening with progress, remaining time, Resume, and Mark complete
- Cleaner spacing from phone to wide desktop screens while keeping the Spoken Page logo and version pill

See [PATCH_NOTES.md](PATCH_NOTES.md) for the complete release notes, including earlier versions.

## Highlights

### Library

- Browse every audiobook library available to your Audiobookshelf account
- Search the complete selected library and filter by author, narrator, genre, series and listening status
- Sort books and keep frequently used titles in a synced Pinned books section
- Resume the most recently updated unfinished book or mark it complete in Audiobookshelf
- Open a book without changing its listening history; a title becomes recent only after playback starts
- See Not started, In progress or Completed from Audiobookshelf; save Want to listen independently
- Expand long synopses directly in the book details modal
- Queue the next book in a series
- Remember the selected library, search, sort direction, listening status and filters for your account; explicit search links override the saved view
- Handle multiple series memberships and numeric book positions, including decimal sequences
- Preview the next available book in a series with its cover and open its details directly, independently of shelf filters

### Player

- Keep routine sync messages quiet; show progress-save failures and retry temporary failures while the player remains open, including when paused. Failed saves are not retained after closing the page.

- Start and resume native Audiobookshelf playback sessions
- Keep progress synchronized with Audiobookshelf across multi-track books
- Use matching library and fullscreen controls, with chapter markers, a chapter selection popup and a stable book timeline
- Toggle the right-hand time display between remaining and total time; undo the latest seek or chapter jump
- Change playback speed and volume, with a speaker button that mutes and restores the previous volume; saved volume applies before playback starts
- Open the compact sleep menu by clicking its icon or timer
- Choose the default, black, custom-color or cover-art fullscreen background; controls hide automatically during playback
- Click the subtitle area to play/pause or double-click to enter/leave fullscreen
- Open a focused player route or a separate player window
- Use keyboard shortcuts and Media Session controls where the browser supports them

### Subtitles

- Automatically find attached Audiobookshelf `.srt` and `.vtt` files
- Upload a local subtitle file when the server has none
- Display the current and previous lines without revealing upcoming subtitles; library subtitles use a black background
- Choose a font, horizontal and vertical alignment, text size up to 120px, and fullscreen Fill screen sizing from Player options
- Save subtitle source and timing offset separately for each book

### Accounts and sync

Spoken Page uses your existing Audiobookshelf account; it does not maintain a second user database. Your password is forwarded once to Audiobookshelf and is never stored. Spoken Page stores an opaque session cookie in the browser and an encrypted Audiobookshelf token in its persistent data directory. Preferences are keyed to the Audiobookshelf server and user account so they follow you across devices.

OpenID-only Audiobookshelf users can sign in with the API-token fallback.

## Quick start with Docker Compose

1. Clone this repository and enter its directory.
2. Copy `.env.example` to `.env`.
3. Set a strong secret and the Audiobookshelf URL reachable from the container:

```dotenv
SPOKEN_PAGE_SECRET=replace-with-a-long-random-value
SPOKEN_PAGE_ABS_BASE_URL=http://host.docker.internal:13378
```

4. Start the app:

```bash
docker compose up -d
```

5. Open `http://localhost:3000` and sign in with your Audiobookshelf account.

The Compose configuration creates a persistent `spoken-page-data` volume for encrypted sessions and synced preferences.

The versioned container for this release is `ghcr.io/jcdesantis/spoken-page:v1.4.1`; `latest` follows the newest build from `main`. See the [v1.4.1 release](https://github.com/JCDeSantis/spoken-page/releases/tag/v1.4.1) for the release notes.

### Choosing the Audiobookshelf URL

`SPOKEN_PAGE_ABS_BASE_URL` is the address Spoken Page reaches from inside its container—not necessarily the address in your browser.

| Deployment | Example |
| --- | --- |
| ABS on the Docker host | `http://host.docker.internal:13378` |
| Both apps in one Compose network | `http://audiobookshelf:80` |
| ABS on another LAN machine | `http://192.168.1.50:13378` |
| ABS behind HTTPS | `https://abs.example.com` |
| ABS behind a reverse-proxy subpath | `https://example.com/audiobookshelf` |

If several exact servers are permitted, set `SPOKEN_PAGE_ALLOWED_BASE_URLS` to a comma-separated allowlist. Avoid enabling `SPOKEN_PAGE_ALLOW_UNSAFE_CUSTOM_CONNECTIONS` on an internet-facing deployment.

## Run from source

Node.js 22 LTS is recommended.

```bash
npm install
npm run dev
```

For a production build:

```bash
npm run build
npm run start
```

The development server defaults to `http://localhost:3000`.

## Configuration

| Variable | Required | Purpose |
| --- | --- | --- |
| `SPOKEN_PAGE_SECRET` | Production | Stable high-entropy key used to encrypt stored sessions |
| `SPOKEN_PAGE_PREVIOUS_SECRETS` | No | Older comma-separated keys used during secret rotation |
| `SPOKEN_PAGE_ABS_BASE_URL` | Recommended | Locks the deployment to one Audiobookshelf server |
| `SPOKEN_PAGE_ALLOWED_BASE_URLS` | No | Allows additional exact Audiobookshelf base URLs |
| `SPOKEN_PAGE_ALLOW_UNSAFE_CUSTOM_CONNECTIONS` | No | Allows arbitrary user-entered server URLs; defaults to `false` |
| `SPOKEN_PAGE_DATA_DIR` | No | Persistent storage location; Compose uses `/app/data` |
| `SPOKEN_PAGE_VERBOSE_REQUEST_LOGS` | No | Log every API and Audiobookshelf request for troubleshooting; defaults to `false` |

Use HTTPS for public deployments and for reliable screen-wake behavior on iPad. Safari currently provides the strongest iPad PWA/fullscreen behavior.

## Security model

- Passwords are never persisted.
- Audiobookshelf access and refresh tokens are encrypted at rest with AES-256-GCM.
- Browsers receive only an opaque `httpOnly`, `sameSite` session cookie.
- Production connections require a stable secret and a locked or allowlisted Audiobookshelf URL.
- Proxy requests cannot leave the configured Audiobookshelf origin or configured base path.
- API responses containing user data use private, no-store caching.
- The Docker image runs as the unprivileged Node user.
- Health (`/api/health`) and readiness (`/api/ready`) endpoints support deployment checks.

Keep `.env` files private, rotate a compromised secret using `SPOKEN_PAGE_PREVIOUS_SECRETS`, and place internet-facing installations behind HTTPS and normal reverse-proxy protections.

## Validation

```bash
npm run typecheck
npm test
npm run build
npm audit --omit=dev
```

GitHub Actions runs type checking, tests, and the production build on pushes and pull requests. Pushes to `main` publish `ghcr.io/jcdesantis/spoken-page:latest`; version tags publish matching container tags.

## Project map

- `src/app/api` — authenticated Audiobookshelf proxy, preferences, health, and playback endpoints
- `src/components/dashboard.tsx` — library, shelves, filters, and book details
- `src/components/player-panel.tsx` — playback, subtitles, chapters, queue, and sleep timer
- `src/lib/audiobookshelf.ts` — connection policy and Audiobookshelf client
- `src/lib/session-store.ts` — encrypted persistent sessions
- `src/lib/user-settings.ts` — per-account cross-device preferences
- `compose.yml` and `Dockerfile` — production container deployment

## Companion project

[Audiobook Forge](https://github.com/JCDeSantis/audiobookforge) creates subtitle files that pair naturally with Spoken Page's subtitle-aware player.

## Credits

Spoken Page is a companion to [Audiobookshelf](https://www.audiobookshelf.org/) and depends on its library, metadata, playback session, and progress APIs. The project was built through AI-assisted development from an idea by a non-professional developer.

## License

MIT. See [LICENSE](LICENSE).
