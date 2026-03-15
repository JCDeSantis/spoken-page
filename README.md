# Spoken Page

This is a Next.js starter app for a custom Audiobookshelf web player that:

- connects to your Audiobookshelf server with a user API token
- browses audiobook libraries from the web
- starts real Audiobookshelf playback sessions
- streams audio through a local proxy so browser CORS/auth are simpler
- syncs progress back to Audiobookshelf while you listen
- overlays `.srt` subtitles from Audiobookshelf-attached files or a local fallback upload
- defaults to a dark reading mode with a light-mode toggle
- includes a focused player route and popout option for subtitle-first listening
- includes a manual "force sync to Audiobookshelf" control in addition to timed syncs

## Why this shape

Because you want the app to work on PC and iPad, this project is built as a responsive website. Using Next.js gives us a lightweight backend for:

- storing the Audiobookshelf token in an `httpOnly` cookie
- proxying audio streams and cover images
- calling Audiobookshelf session/progress endpoints server-side

That avoids relying on Audiobookshelf CORS behavior from the browser and keeps the token out of front-end JavaScript.

## Local setup

1. Install dependencies:

```bash
npm install
```

2. Start the dev server:

```bash
npm run dev
```

3. Open `http://localhost:3000`
4. Paste your Audiobookshelf server URL and user API token
5. Pick a book, start synced playback, and either use a linked Audiobookshelf `.srt` file or load a local one

## Current MVP behavior

- Audiobook libraries are loaded from `GET /api/libraries`
- Books are loaded from `GET /api/libraries/:id/items`
- Book details come from `GET /api/items/:id?expanded=1&include=progress`
- Playback starts with `POST /api/items/:id/play`
- Session sync uses `POST /api/session/:id/sync`
- Session close uses `POST /api/session/:id/close`
- Progress is reinforced with `PATCH /api/me/progress/:itemId`

## Notes

- Subtitle files stay in the browser only.
- If an `.srt` is attached to the book in Audiobookshelf, the app will auto-detect it and let you switch between multiple subtitle files.
- This MVP is focused on audiobook playback, not podcasts.
- Multi-track audiobooks are handled by switching between Audiobookshelf track URLs while preserving a global timeline.
- If you want this to become an installable PWA next, the current structure is a good base for that.
