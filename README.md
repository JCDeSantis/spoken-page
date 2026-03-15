# Spoken Page

![Spoken Page logo](public/spoken-page-logo-trimmed.png)

Spoken Page is a subtitle-first web companion for [Audiobookshelf](https://github.com/advplyr/audiobookshelf).

It lets you browse your Audiobookshelf library from a responsive website, open an audiobook, and listen with synchronized `.srt` subtitles from either:

- subtitle files attached to the audiobook in Audiobookshelf
- a local `.srt` file you upload in the browser

The app is designed for desktop and iPad use, with a library view, a focused subtitle reading experience, and playback progress synced back to Audiobookshelf.

## Version

Current release: `v0.8`

## What It Does

- Connects to an Audiobookshelf server using a user API token
- Loads book libraries and item metadata from Audiobookshelf
- Starts real Audiobookshelf playback sessions
- Streams audio through a local Next.js proxy
- Detects attached Audiobookshelf `.srt` subtitle files automatically
- Supports manual `.srt` upload as a fallback
- Keeps progress synced back to Audiobookshelf
- Includes manual `Pull latest server progress` and `Force sync to Audiobookshelf` actions
- Works with multi-track audiobooks on one shared timeline
- Provides dark and light themes
- Includes a focused player route and pop-out player window

## Why It Exists

Audiobookshelf is excellent for hosting and organizing audiobooks, but there are cases where a dedicated subtitle-aware listening surface is helpful:

- read-along listening
- accessibility support
- subtitle timing adjustments
- desktop or tablet listening with a cleaner subtitle-first layout

Spoken Page fills that gap without replacing Audiobookshelf itself. It uses Audiobookshelf as the source of truth for the library, playback sessions, and progress.

## How It Works

Spoken Page is built as a Next.js app with a small server-side proxy layer.

That server layer is used to:

- store the Audiobookshelf connection in an `httpOnly` cookie
- proxy API requests to Audiobookshelf
- proxy audio streams and cover images
- keep the user API token out of browser-side JavaScript

This makes the app easier to run across browsers and devices without depending on direct browser-to-Audiobookshelf CORS behavior.

## Sync Behavior

Spoken Page uses Audiobookshelf for both playback sessions and progress updates.

Current sync strategy:

- starts a real Audiobookshelf playback session when playback begins
- refreshes latest book progress when a player is opened from the library
- auto-syncs during playback on a measured interval
- syncs again when playback ends or the session is closed
- lets the user manually force a sync at any time

The current auto-sync cadence is intentionally conservative so it stays reliable without being noisy:

- every 20 seconds
- only while playback is actively playing
- only after at least 5 seconds of new progress has accumulated

## Tech Stack

- Next.js 15
- React 19
- TypeScript
- Audiobookshelf API

## Local Development

1. Install dependencies:

```bash
npm install
```

2. Start the dev server:

```bash
npm run dev
```

3. Open:

```text
http://localhost:3000
```

4. Connect the app to your Audiobookshelf server:

- enter your Audiobookshelf base URL
- paste a user API token
- choose a library
- open a book

## Testing On iPad Or Another Device

Run the dev server with a host binding:

```bash
npm run dev -- --hostname 0.0.0.0
```

Then open the app from another device on the same network using your PC's local IP.

## Subtitle Support

Spoken Page currently supports `.srt` subtitle files.

Subtitle sources:

- Audiobookshelf-attached subtitle files detected from the selected item
- local `.srt` upload from the browser

Subtitle features:

- active line display
- subtitle source switching
- subtitle offset adjustment
- automatic subtitle loading when supported files are attached to the book

## Current Scope

This release is focused on audiobook playback.

Included:

- audiobook libraries
- synced progress
- subtitle-aware player
- focused reading/listening UI

Not included:

- podcast support
- user login UI beyond API token connection
- cloud subtitle editing
- offline/PWA install flow

## Project Structure

Key areas of the app:

- `src/app/api/*`
  Next.js proxy routes for Audiobookshelf requests
- `src/components/dashboard.tsx`
  library browsing and player shell behavior
- `src/components/player-panel.tsx`
  synced player, subtitle rendering, session handling, and sync logic
- `src/lib/audiobookshelf.ts`
  Audiobookshelf request helpers
- `src/app/globals.css`
  theme, layout, and component styling

## Notes

- This app expects an existing Audiobookshelf server
- Subtitle parsing currently targets `.srt`
- Favorites and recent books are stored locally in the browser
- The token is stored for this site in an `httpOnly` cookie

## Roadmap Ideas

- installable PWA support
- saved subtitle offsets per book
- login flow instead of token paste
- richer subtitle styling controls
- chapter jump menu
- better mobile compact-player interactions

## License

No license has been added yet.
