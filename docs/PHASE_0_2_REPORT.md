# Phases 0–2 review

Implemented for review on October 1, 2026. No production deployment or release version change. Offline downloads and player visual changes await user approval.

## Delivered

- Full search across the selected library, including titles, subtitles, authors, narrators and series. Filters combine with search; sorting happens before pagination. Matching totals, preparation feedback, retries and a manual refresh make the search scope visible. Search choices survive browser Back/Forward.
- Listening status comes from Audiobookshelf: Not started, In progress and Completed. Want to listen is a separate preference. Mark complete preserves position; Mark unfinished preserves position; Start over confirms before resetting progress. Cards, details and Continue listening share the status model.
- Preferences migrate to schema 2, retaining existing pins, recent books and queue entries. Planned labels become Want to listen. Other previous manual labels remain available for review without overriding actual playback. A pre-migration settings backup is saved once; older clients cannot overwrite the new fields.
- Shared progress and offline manifest/operation contracts prepare later work. No download interface, offline storage or player redesign is included.

## Compatibility findings

The credential-free runtime report is [ABS_CAPABILITIES.json](ABS_CAPABILITIES.json). Your server is Audiobookshelf 2.36.1. Authenticated reads confirmed its 117-book catalog across both pages, account progress, expanded track/chapter metadata and HTTP 206 audio range responses with a validator. Native search provides category results without a complete total, so this implementation builds a complete authorized catalog before searching.

Catalogs are scoped by server, account, library and access permissions. Every query checks access and joins current progress. A catalog is published only after two matching complete scans, with a maximum of three attempts. Cache lifetime is 60 seconds, up to eight in-memory catalogs; a cold restart requires preparation again. A continually changing or unavailable library shows a retryable error rather than claiming an exhaustive empty result. This is a complete-catalog fallback, not a persistent database index; large real-world catalog preparation should be measured before release.

2.36.1 is the verified version, not a claim that all older versions are supported. Session import/replay has not been called against your live account because it changes listening history. Its retry and reconciliation behavior, cold offline launch, storage limits and target-browser support remain qualification gates for the later offline phase. Audio range support alone does not prove offline readiness.

## Verification

- 50 automated tests pass; the opt-in live-server test is skipped during normal runs and passed separately against your server.
- Production build and TypeScript validation pass.
- Query tests include 10,000 entries, combined filters, Unicode matching, stable sorting, pagination, access/cache isolation, failed preparation and migration backups.
- Browser checks use an isolated 1,205-book library: a subtitle search finds the last-page book; Want to listen retains Not started; completion/unfinished/reset update status controls and cards. Real-account progress mutations were not used for testing.
- End-to-end real-audio playback and multiple-device status changes still need user review. The isolated browser fixture does not serve playable audio.

## Review

Open http://127.0.0.1:4321 and sign in normally if prompted. This preview uses your actual server: playback and status controls will update your account when you use them.

1. Search for a book beyond the first page; combine author/series/status filters, then use Clear and browser Back.
2. Confirm pins still appear in matching search results and Continue listening reflects current progress.
3. On a suitable book, toggle Want to listen and confirm position/status stays unchanged. Review Mark complete, Mark unfinished and the Start over confirmation.
4. Play/resume a book and check that status updates consistently between cards, details and the player.
5. Confirm migrated preferences and any legacy-label notice look appropriate.

The isolated UI screenshot is [phase-0-2-review.png](phase-0-2-review.png).

For repeatable isolated checks: `node scripts/dev-fixture.cjs` opens port 4320 (fixture/fixture). The local fixture server uses port 4319. For the read-only capability probe after signing in: `node scripts/check-abs-capabilities.cjs https://audiobook.bananapizza.org`. The probe uses the existing session client and saves only capability metadata.

Stop here until the user confirms Phases 0–2. Next authorized work must be agreed after this review; offline behavior and mini/full-screen player visuals remain future work in [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md).

## UI review adjustments

The review also includes series sorting by name and numeric book order, a Want to listen entry in Status, and sort arrows at the right of the toolbar. Filters include Hide completed with accurate full-library totals and browser-history restoration. Clear all shares the popup's bottom row with Hide completed; redundant headings are removed and dropdowns have enough vertical room for their labels.

Cover frames are square throughout the library and player, with complete artwork contained inside them. Continue listening uses a larger square cover. Pin controls use translucent thumbtack icons with a filled red pinned state. A book's red selection highlight is limited to when its details or player is open. Local review screenshots other than the isolated fixture illustration are kept outside version control.
