# Spoken Page

![Version](https://img.shields.io/badge/version-v1.0-ff5664?style=for-the-badge)

![Spoken Page logo](public/spoken-page-logo-trimmed.png)

Spoken Page is a subtitle-first web companion for [Audiobookshelf](https://github.com/advplyr/audiobookshelf).

It gives Audiobookshelf users a focused browser-based listening surface with synced playback, chapter navigation, and `.srt` subtitle support for desktop and tablet reading-listening workflows.

## Built With AI

Spoken Page was built almost entirely through AI-assisted development.

I am not a professional developer, and this project exists because modern AI tools made it possible to design, build, and iterate on an idea that otherwise would have been out of reach.

## Why Spoken Page Exists

Audiobookshelf is already excellent at organizing, hosting, and syncing audiobook playback. Spoken Page does not try to replace it.

Instead, Spoken Page adds a cleaner subtitle-aware listening experience on top of Audiobookshelf for situations like:

- read-along listening
- accessibility support
- subtitle timing adjustment
- subtitle-first playback on desktop and iPad
- quick browsing and re-entry into active books

Audiobookshelf remains the source of truth for:

- libraries
- item metadata
- playback sessions
- chapter data
- progress syncing

## Features

- Connect to an Audiobookshelf server using a user API token
- Browse audiobook libraries from a responsive web UI
- Open a book and start a real Audiobookshelf playback session
- Stream audio through a local Next.js proxy
- Automatically detect attached Audiobookshelf `.srt` subtitle files
- Upload a local `.srt` file as a fallback
- Display active subtitles in a dedicated subtitle-first player
- Adjust subtitle timing offsets
- Sync playback progress back to Audiobookshelf
- Pull the latest server progress on demand
- Continue across multi-track audiobooks on one shared timeline
- Jump between chapters from transport controls or the chapter list
- Use dark mode or light mode
- Save favorites locally in the browser
- Maintain a recent-books shelf with individual dismiss controls
- Open a focused player route for a cleaner reading/listening mode
- Pop the player out into its own browser window
- Run as a Docker container or a direct Windows Node.js server

## Quick Start

### Docker Compose

This is the easiest deployment path for most users once the published container image is available.

1. Clone the repo.
2. Set the runtime environment values. The quickest path is to use the examples in `.env.example`.

Minimum recommended values:

```text
SPOKEN_PAGE_SECRET=replace-this-with-a-long-random-string
SPOKEN_PAGE_ABS_BASE_URL=http://host.docker.internal:13378
```

Use `SPOKEN_PAGE_ALLOWED_BASE_URLS` instead if you want to allow more than one exact Audiobookshelf URL.

3. From the project directory, run:

```bash
docker compose up -d
```

4. Open:

```text
http://localhost:3000
```

5. Enter a user API token in the app. If you did not lock the deployment to one ABS URL, enter the allowed server URL there as well.

Included files:

- [Dockerfile](Dockerfile)
- [compose.yml](compose.yml)
- [.env.example](.env.example)

Published image:

```text
ghcr.io/jcdesantis/spoken-page:latest
```

If you want to pull it manually:

```bash
docker pull ghcr.io/jcdesantis/spoken-page:latest
```

If you want to build locally instead of pulling the published image:

```bash
docker build -t spoken-page .
docker run --rm -p 3000:3000 --env-file .env spoken-page
```

### Windows Server Run

If you do not want Docker, Spoken Page also runs directly as a Node.js server on Windows.

Prerequisite:

- Node.js 22 LTS recommended

Recommended environment variables before starting:

```powershell
$env:SPOKEN_PAGE_SECRET="replace-this-with-a-long-random-string"
$env:SPOKEN_PAGE_ABS_BASE_URL="http://192.168.1.20:13378"
```

Install and start:

```bash
npm install
npm run build
npm run start
```

Then open:

```text
http://localhost:3000
```

To expose it on your local network:

```bash
npm run start -- --hostname 0.0.0.0 --port 3000
```

## Deployment Notes

Spoken Page supports two main deployment styles:

- Docker for repeatable, self-contained deployments
- direct Node.js server run for simple local Windows installs

Recommendation:

- use Docker when you want the cleanest deployment story
- use direct Node.js on Windows when you want the fewest moving parts

The app server itself is stateless. Spoken Page does not need its own persistent app-data volume to run. It depends on your Audiobookshelf server for actual library and playback state.

Security defaults:

- Set `SPOKEN_PAGE_SECRET` in production so saved connections survive restarts and the stored connection cookie is signed with your own secret.
- Set `SPOKEN_PAGE_ABS_BASE_URL` to lock the app to one Audiobookshelf server.
- Set `SPOKEN_PAGE_ALLOWED_BASE_URLS` if you want to allow a short list of exact ABS URLs instead.
- `SPOKEN_PAGE_ALLOW_UNSAFE_CUSTOM_CONNECTIONS=true` restores the older behavior that lets users type any URL, but that is less safe and is not recommended for public deployments.

## GitHub Container Publishing

This repo is set up to publish a container image to GitHub Container Registry through GitHub Actions:

- validation workflow: [.github/workflows/ci.yml](.github/workflows/ci.yml)
- workflow: [.github/workflows/publish-container.yml](.github/workflows/publish-container.yml)
- image: `ghcr.io/jcdesantis/spoken-page`

Publishing behavior:

- pushes to `main` publish `:latest`
- version tags like `v1.0.0` publish a matching tag
- workflow dispatch can publish on demand

GitHub-side note:

- after the first publish, confirm the package visibility is set to `Public` in GitHub Packages if GitHub does not inherit public visibility automatically

## Local Development

1. Install dependencies:

```bash
npm install
```

2. Start the development server:

```bash
npm run dev
```

3. Open:

```text
http://localhost:3000
```

For testing on another device on your network:

```bash
npm run dev -- --hostname 0.0.0.0
```

## Subtitle Support

Spoken Page currently supports `.srt` subtitle files.

Subtitle sources:

- subtitle files attached to the audiobook in Audiobookshelf
- a local `.srt` file uploaded in the browser

Subtitle features:

- active subtitle line display
- subtitle source switching
- subtitle offset adjustment
- automatic subtitle loading when supported files are attached to the selected book

## Companion App

If you want help creating subtitle files for your Audiobookshelf library, see [Audiobook Forge](https://github.com/JCDeSantis/audiobookforge).

Audiobook Forge is a companion app for generating subtitle files for Audiobookshelf-friendly workflows, which pairs naturally with Spoken Page's subtitle-aware player.

## How It Works

Spoken Page is built as a Next.js app with a small server-side proxy layer.

That server layer is responsible for:

- storing the Audiobookshelf connection in a signed `httpOnly` cookie
- proxying Audiobookshelf API requests
- proxying audio streams and cover images
- keeping the Audiobookshelf token out of browser-side JavaScript

This keeps the frontend simpler and avoids depending on direct browser-to-Audiobookshelf CORS behavior.

## Project Structure

Key parts of the app:

- `src/app/api/*`
  Next.js proxy routes for Audiobookshelf requests
- `src/components/dashboard.tsx`
  library browsing, filtering, recents, favorites, and player shell behavior
- `src/components/player-panel.tsx`
  playback control, subtitle rendering, chapter controls, and sync logic
- `src/lib/audiobookshelf.ts`
  Audiobookshelf request helpers
- `src/app/globals.css`
  theme, layout, and component styling

## Credits

Spoken Page is built specifically to work with Audiobookshelf, and this project would not exist without it.

- Audiobookshelf GitHub: [advplyr/audiobookshelf](https://github.com/advplyr/audiobookshelf)
- Audiobookshelf site: [audiobookshelf.org](https://www.audiobookshelf.org/)

Audiobookshelf is the self-hosted server that provides the library, playback session, chapter, and progress infrastructure that Spoken Page builds on top of.

## Notes

- Spoken Page expects an existing Audiobookshelf server
- Favorites and recent books are stored locally in the browser
- The Audiobookshelf token is stored for this site in a signed `httpOnly` cookie
- Production installs should set `SPOKEN_PAGE_SECRET`
- Spoken Page is a companion surface for Audiobookshelf, not a replacement for it

## License

MIT License. See [LICENSE](LICENSE).
