# Spoken Page

![Version](https://img.shields.io/badge/version-v1.1.1-ff5664?style=for-the-badge)
![License](https://img.shields.io/badge/license-MIT-163434?style=for-the-badge)

![Spoken Page logo](public/spoken-page-logo-trimmed.png)

Spoken Page is a responsive, subtitle-first web player for [Audiobookshelf](https://github.com/advplyr/audiobookshelf). It keeps Audiobookshelf as the source of truth while adding a focused library and listening experience for desktop, tablet, and installable PWA use.

## What v1.1 adds

- Audiobookshelf account sign-in with encrypted, persistent server-side sessions
- Cross-device favorites, recents, queues, reading status, and player preferences
- A redesigned library with search, sorting, filters, saved and recently played shelves
- Book detail modals with expandable synopses and manual reading status
- A compact, tablet-friendly player with chapters, queue controls, speed, sleep timer, and keyboard shortcuts
- Subtitle discovery and local `.srt`/`.vtt` upload with per-book timing offsets
- PWA installation, offline shell support, health/readiness endpoints, and Docker persistence

See [PATCH_NOTES.md](PATCH_NOTES.md) for the complete v1.1 release notes.

## Highlights

### Library

- Browse every audiobook library available to your Audiobookshelf account
- Search and filter by author, narrator, genre, series, and manual reading status
- Sort books and browse favorites, recently played titles, and saved queues
- Open a book without adding it to recents; a title becomes recent only after playback starts
- Set a book to Planned, In Progress, or Completed—or leave its status blank
- Expand long synopses directly in the book details modal
- Queue the next book in a series

### Player

- Start and resume native Audiobookshelf playback sessions
- Keep progress synchronized with Audiobookshelf across multi-track books
- Navigate chapters or jump through the complete book timeline
- Change playback speed and subtitle timing
- Use a compact pop-up sleep timer designed for touch screens
- Open a focused player route or a separate player window
- Use keyboard shortcuts and Media Session controls where the browser supports them

### Subtitles

- Automatically find attached Audiobookshelf `.srt` and `.vtt` files
- Upload a local subtitle file when the server has none
- Display the active line in a subtitle-focused reading view
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
