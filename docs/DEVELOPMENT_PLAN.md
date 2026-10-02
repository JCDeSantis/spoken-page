# Spoken Page development plan

Prepared October 1, 2026, against the current v1.2.1 implementation.

Current scope update: offline phases and player redesign were subsequently skipped by the user. The original proposal below is retained for historical reference; those phases are not authorized upcoming work. Version 1.3.0 delivers search, listening status, remembered library preferences, series improvements and progress-save feedback.

## 1. Goals and delivery order

Deliver three functional improvements before changing the player's visual design:

1. Search, filter, and sort the entire selected audiobook library.
2. Use consistent, understandable listening statuses throughout the app.
3. Download complete audiobooks for playback without a network connection and synchronize progress afterward.
4. In a later release, explore and implement improved mini-player and full-screen player designs.

Recommended sequence: validate Audiobookshelf capabilities → implement the shared status model → deliver complete-library search → build offline storage and playback → harden synchronization → release offline support → explore the player redesign. Status foundations come first internally because library queries need to use those same rules. Search and status can ship together.

This document is a proposed implementation specification, not a claim that these features have been built or tested. Release labels below are provisional.

## 2. Current implementation and implications

| Area | Current behavior | Required change |
| --- | --- | --- |
| Library browsing | Paginated requests default to 100 books. Search, filters, and sorting operate on the browser's loaded `items` array. | Query the full authorized collection before pagination; never report an exhaustive empty result from an incomplete subset. |
| Listening status | Manual `statusOverrides` drive status labels, filtering, and progress sorting. Audiobookshelf progress is separate. | Introduce one derived listening status, with planning intent kept separate. |
| Mark complete | The Continue listening action updates Audiobookshelf and a local status override. | Route completion actions through one shared progress service. |
| Playback | The player starts an Audiobookshelf session and submits checkpoints against that session. | Add local playback sessions that do not require an online session to exist. |
| Progress delivery | Client sequencing and server checkpoint maps are in memory. | Add durable local pending operations and server-side retry protection for offline synchronization. |
| Offline support | The service worker caches a fallback HTML page and logos, and bypasses API requests. | Provide an executable offline player shell, downloaded audio, metadata, and local state. |
| Startup | The home page authorizes against Audiobookshelf; the focused player fetches book details online. | Add an offline startup path that does not depend on either request succeeding. |
| Preferences | Server preferences are keyed by server/user identity; some browser scopes use only user ID. | Use a consistent, opaque server-and-user scope for all new browser data. |
| Player structure | Most playback logic and player layouts live in `player-panel.tsx`. | Extract a shared playback controller as needed for offline work; reuse it in the later redesign. |

Primary existing files: `src/components/dashboard.tsx`, `src/components/library/library-utils.ts`, `src/components/library/book-details.tsx`, `src/components/player-panel.tsx`, `src/components/focus-player-shell.tsx`, `src/components/pwa-status.tsx`, `src/lib/audiobookshelf.ts`, `src/lib/user-settings.ts`, `src/lib/types.ts`, `src/app/api/stream/route.ts`, and `public/sw.js`.

## 3. Product decisions to use as implementation defaults

| Decision | Recommended default |
| --- | --- |
| Meaning of “entire library” | Every book in the selected library that this account may access. Keep the existing library selector. Cross-library search is a later enhancement. |
| Search fields | Title, subtitle, author, narrator, and series. Preserve existing metadata filters. |
| Listening labels | Not started, In progress, Completed. Planning is a separate “Want to listen” toggle/filter. |
| Offline content | Complete books, their track/chapter metadata, cover, and selected subtitles. |
| Download location | This browser/device only; downloads do not transfer between devices. |
| Download execution | Foreground, resumable work. Do not promise completion after the browser is closed or the device suspends the app. |
| Playback preference | Use a verified local copy when available; otherwise stream. Never silently use the network for a book advertised as completely downloaded. |
| Supported targets | Qualify Chrome/Edge desktop, Android Chrome, and Safari/iPhone/iPad including installed PWA mode. Publish the combinations actually tested. |
| Offline identity | A previously authenticated local profile may play its downloads without a network connection. New sign-ins require a connection. |
| Player styling | Retain the current dark/red identity initially. Explore visual changes after the functional releases. |

## 4. Phase 0 — capability checks and shared foundations

**Deliverable:** a short compatibility report, representative fixtures, and settled interface contracts.

Check the deployed Audiobookshelf version and determine the minimum version to support. Test against a development account/library, including a library large enough to span many pages. Do not alter production progress for capability testing.

Verify:

- Whether upstream text search supports exhaustive retrieval, its pagination/limits, matching fields, and exact totals.
- Which item-list filters and sort combinations are supported, including user progress and combined metadata filters.
- Whether item responses include reliable progress, file lengths, track offsets, content versions, and stable file identifiers.
- Download permissions, direct-file access, byte-range responses, and the handling of unsupported audio formats.
- Whether local-session import supports stable client IDs, retries, timestamps, and separate progress reconciliation.
- How reauthentication and revoked library access surface through the existing proxy.

Audiobookshelf documents library search, filtered item listing, local progress synchronization, and local session synchronization. These are integration candidates; their exact behavior must be verified on supported versions. [Audiobookshelf API reference](https://api.audiobookshelf.org/)

Extract shared types for `LibraryQuery`, `ListeningState`, `ProgressSnapshot`, `DownloadManifest`, and `PendingPlaybackOperation`. Keep user/account scoping explicit in storage interfaces.

**Exit gate:** choose the complete-library query strategy and the offline session import strategy based on observed behavior, with tests reproducing upstream limits and retry responses.

## 5. Phase 1 — clearer listening status

### User-facing behavior

Replace the optional “Reading status” dropdown with an automatic “Listening status” display and explicit actions:

- **Not started:** no listening history or active position.
- **In progress:** playback has begun and the book is not completed. Rewinding to zero does not erase its listening history.
- **Completed:** Audiobookshelf records completion, or a pending local completion action has not yet synchronized.
- **Want to listen:** independent planning intent; selecting it never changes playback position.

Opening book details or downloading a book must not start it. Clear Want to listen when playback first begins, using a preference operation that can synchronize later.

Expose “Mark complete,” “Mark unfinished,” and “Start over” in book details. Mark unfinished clears completion while retaining the position. Start over resets the position and clears completion/history fields that the supported upstream API permits; confirm this explicit reset and offer undo when feasible. Continuing playback from the end should offer a restart, not silently reset the book.

### Shared derivation and writes

Use one status resolver for tiles, details, filters, sorting, Continue listening, the player, and Downloads:

1. Apply pending local progress/actions over the last acknowledged server snapshot.
2. If the resulting record is finished, display Completed.
3. Otherwise, if it contains actual listening history or a nonzero position, display In progress.
4. Otherwise display Not started.

Use a versioned progress model with provenance, last acknowledged server state, and local pending changes. Missing data must remain “unknown/loading” internally rather than being interpreted as Not started.

Centralize completion policy. Initially preserve the current near-end threshold to avoid an unrelated behavior change, but evaluate it on playback advancement/end events rather than making a paused scrub alone mark a book complete. Explicit Mark complete remains available at any position. Add regression coverage for short books and final multi-track boundaries.

All changes use a shared progress service that updates every visible copy of a book, rolls back failed online changes, and later supports durable offline pending actions. Replace the manual status-based progress sort with actual listening percentage, then a stable title/ID tie-breaker.

### Migration

- Back up existing preference documents before schema migration; migration must be repeatable.
- Convert `planned` overrides to Want to listen.
- Preserve all original overrides in a legacy field for recovery.
- Derive actual status from Audiobookshelf instead of converting manual `finished`, `unstarted`, or `in-progress` labels into server writes.
- When an old manual label disagrees with progress, show a dismissible explanation in book details with an explicit correction action. Never mass-complete or reset books during migration.
- Keep a preference schema version and a rollback path; mixed-version clients must not overwrite the new fields through whole-document saves.

**Acceptance:** a newly played book immediately becomes In progress everywhere; a completion made in Audiobookshelf appears after refresh; planning never changes playback; migration preserves recoverable data and does not modify server history.

## 6. Phase 2 — search the entire library

### Query contract

Extend the existing library-items route with a validated query object: `q`, metadata filters, listening status, Want to listen, sort, direction, page/cursor, and page size. Return books, total matching count when known, continuation information, and freshness/completeness metadata.

Matching and ordering must happen before pagination. Search and metadata/status filters combine with AND; a text query may match any supported text field. Define case-insensitive, Unicode-aware matching and stable title/ID tie-breakers. Empty queries behave as normal full-library browsing.

### Complete retrieval strategy

Prefer upstream querying where it satisfies the entire contract. Do not take a small result set from upstream search and apply local filters to it as if it were complete.

If upstream combinations or search limits prevent exhaustive results, build a server-side metadata catalog from all authorized item pages, then query that catalog. Use a dedicated, versioned catalog store, not the 128 KB preference namespace. Scope catalog entries to server, account, and library until permission-equivalent sharing is proven safe. Keep per-user progress separate from book metadata.

Build catalog snapshots with bounded concurrency and atomic replacement. Mark an index complete only after all pages have been fetched successfully; detect changing totals and reconcile changes before publishing a new snapshot. Support invalidation after library changes, periodic refresh while active, and a manual Refresh library action. Refresh user progress on relevant events and window focus independently of catalog refresh.

During first-time indexing, show “Preparing library search” with progress. An interrupted or partial index must say it is incomplete and must never produce “No matches in your library.” Revalidate authorization for catalog requests and never expose cached results after access is revoked.

### Interface behavior

- Debounce typing approximately 250–300 ms; cancel stale requests and ignore late responses.
- Reset pagination when search, sort, filter, or library changes.
- Keep the previous results visible during refresh with an unobtrusive loading state.
- Show clear filter chips, Clear all, matching counts, retryable errors, and an honest empty state.
- Preserve query state in the URL so Back restores the same search.
- Keep search results complete even for pinned books. Pinning must not make a matching book disappear from the results area.
- Keep library query results separate from cached pinned/queued/recent book records.
- When offline, explicitly scope search to downloaded books. Do not suggest the full online catalog is available.

**Acceptance:** a book beyond the first loaded page is found without Load more; combined filters and sorting remain correct over multiple pages; rapid typing cannot replace newer results with stale results; counts describe matches, not loaded rows; accounts cannot see each other's catalog or progress.

**Performance targets:** measure 1,000- and 10,000-book fixtures. Aim for a warm query response below 500 ms on the reference deployment, excluding network latency, and no full-catalog browser download. These are engineering targets, not measured current performance.

## 7. Phase 3 — offline download foundation

### Scope of the first release

Download complete books in supported, browser-playable formats. Include all required audio tracks, chapter/track offsets, minimum display metadata, cover when available, and selected server or locally uploaded subtitles. Missing optional artwork/subtitles should be reported without invalidating otherwise complete audio.

Defer partial-book downloads, automatic next-book downloads, universal background downloading, and offline transcoding. A book requiring live transcoding is not eligible until a stable downloadable rendition is implemented and tested; show the reason.

### Storage design

Use IndexedDB for manifests, bounded audio chunks, cached metadata, progress, and pending operations. Use Cache Storage for versioned application-shell assets. Prototype bounded chunk reads and service-worker range responses on Safari before committing to the storage implementation; if another storage backend is required, keep it behind the same interface.

| Record | Required information |
| --- | --- |
| Local profile | Opaque server/account scope, display name, schema version; no Audiobookshelf credentials. |
| Book manifest | Book ID, library ID, revision, expected tracks, lengths, MIME types, timing offsets, chapters, selected subtitle, download state. |
| Audio chunk | Profile/book/track/revision identity, byte offset, expected/actual length, completion state. |
| Local progress | Position, started/finished state, base server snapshot, device/session identity, monotonic sequence. |
| Pending operation | Stable operation ID, payload version, action, retry state, sequence, acknowledgment. |

Write a completion marker only when required bytes are present and validated. Validate lengths and upstream validators; do not claim cryptographic integrity unless a trustworthy checksum is available. Never store multi-gigabyte audio in localStorage or materialize the whole book in memory.

Download state machine: Not downloaded → Queued → Downloading → Verifying → Downloaded. Explicit branches: Paused, Interrupted, Failed, Needs repair, and Removing. Persist each transition. Resume only against the same file revision; restart affected data if validators change. If upstream ranges are unavailable, restart the affected track and explain the limitation.

Use one active book download initially, bounded chunk sizes, backpressure, cancellation, and retry with backoff. Keep completed chunks after an interruption. On reopening, reconcile manifests with actual stored data and present Resume instead of claiming work continued while closed.

### Storage and account controls

Show estimated book size before download, download progress, total space used, and Remove download. Handle unknown size explicitly. Reserve headroom and stop cleanly on quota failure. Request persistent storage where supported, but handle denial and browser eviction. Browser quota and persistence behavior varies by browser. [MDN storage guidance](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria) and [persistent storage](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist).

Local downloads are private application data on the device, not DRM-protected files. Do not store tokens or authenticated HTML in the download cache. Verify download permissions server-side using book/track IDs, not arbitrary URLs. Keep ordinary API responses private/no-store; authorize explicit download acquisition separately.

Default logout behavior removes this profile's local downloads and metadata. If pending progress exists, offer synchronize first or explicitly discard it before clearing. Allow an offline local logout/clear action even when the server is unreachable. Account switching must not expose another account's local content. Revocation is enforced when the app next reconnects; immediate remote revocation cannot be guaranteed while a device is offline.

**Acceptance:** downloads survive reload, retry without restarting completed data, detect changed files, handle insufficient space without corrupting other books, and remove all associated bytes when requested.

## 8. Phase 4 — offline startup and playback

Build a dedicated client-driven offline entry route with all necessary scripts/styles included in a generated build asset manifest. The service worker should route offline navigation into that shell while preserving the intended book ID. The fallback must work after a complete browser close/reopen, not just while the current page stays loaded.

Do not cache personalized server-rendered home/player HTML. Load the permitted local profile and downloaded book metadata from IndexedDB. Show a Downloads view when the server is unavailable, whether caused by loss of internet or an unreachable home server. Distinguish server unreachability, authentication expiry, and lack of connectivity; `navigator.onLine` alone is insufficient.

Extract a playback controller and two source adapters: online stream and local download. Both expose the same book timeline, seeking, track transitions, playback speed, subtitles, sleep timer, and progress events. Keep one active audio owner across mini/full player views, and coordinate multiple tabs to prevent duplicate playback and duplicate synchronization.

Serve downloaded audio through a dedicated service-worker virtual media path backed by bounded chunk reads. Implement `HEAD`, full and single-range `GET`, suffix/open-ended ranges, correct `200`/`206`/`416` responses, MIME type, byte lengths, and cancellation. Multi-range requests need an explicit tested policy. Missing bytes fail clearly and offer repair; do not silently fetch a missing part while presenting the book as offline-ready.

Service-worker updates must distinguish shell caches from book storage. The current broad old-cache cleanup must be replaced with prefix/version-specific cleanup. Keep assets needed by open clients, defer disruptive activation during playback/download, and test upgrading from v1.2.1. Database migrations must preserve downloads and pending progress or provide a visible recovery path.

**Acceptance:** in airplane mode after a cold start, a downloaded book opens, plays, seeks across track boundaries, changes speed, shows selected subtitles, and resumes after restart. Online and offline playback retain equivalent timeline behavior. Test device lock/background playback directly on supported phones/tablets and document actual limitations.

## 9. Phase 5 — reconnect and progress reconciliation

Write playback checkpoints locally approximately every five seconds and on pause, seek completion, track transition, completion, and page visibility changes. Do not depend on unload events. Save pending operations before attempting network delivery; retain them until acknowledged. Unexpected process termination may lose the small interval since the last durable checkpoint, which should be bounded and tested.

Use stable local session IDs and per-session sequence numbers. Persist server-side synchronization receipts across restarts and scope them by authenticated account. Serialize imports for the same book/account and coordinate local tabs. Keep listening-time accounting separate from the selected resume position.

On reconnect or app focus:

1. Restore authentication for the same account; never submit one profile's work under another profile.
2. Fetch fresh server progress and compare it to the base snapshot saved before offline changes.
3. If server progress is unchanged, submit local progress and session history.
4. If only the server changed, adopt it locally.
5. If both changed incompatibly, preserve both and offer “Use this device” or “Use server position,” showing chapter/time and dates.
6. Acknowledge only confirmed operations and refresh status everywhere.

Do not resolve conflicts by choosing the largest timestamp or furthest position: clock skew, deliberate rewinds, restarts, and completion reversals make those rules unsafe. Continue playback from local state while a conflict awaits a decision, and avoid automatic position writes that would erase either choice.

Prefer Audiobookshelf local-session import if the Phase 0 spike verifies replay safety. A durable receipt alone does not guarantee exactly-once upstream effects: test the case where Audiobookshelf accepts a session but the response is lost before the receipt is saved. Require stable upstream session identity and reconciliation of uncertain outcomes before resending additive listening time. If this cannot be established, narrow the release to reliably synchronized position/completion and explicitly document the remaining listening-history limitation rather than double-counting sessions.

Handle partial batch success independently. Authentication failures pause delivery and request sign-in; transient failures retry with bounded backoff; removed books or revoked access retain a clear, actionable unresolved state. Provide Saved on this device, Waiting to sync, Synced, and Needs attention states without repetitive alerts.

Removing a download must not delete pending progress. Clearing all local data or signing out with unsynchronized work requires an explicit discard choice. Server receipts need a documented retention/compaction rule that cannot permit an old acknowledged session to be imported again.

**Acceptance:** offline progress survives browser and server restart; repeated delivery and lost responses do not duplicate listening time; completion/reset conflicts do not silently overwrite another device; reconnecting under a different account never leaks or replays data.

## 10. Proposed implementation backlog

Each row is a reviewable work package, not necessarily one commit.

| ID | Work package | Depends on | Completion evidence |
| --- | --- | --- | --- |
| FND-01 | Verify upstream query, download, and local-session behavior | — | Compatibility report and fixtures |
| STA-01 | Shared progress/status resolver and models | FND-01 | Resolver tests including missing data and rewinds |
| STA-02 | Status controls, shared writes, and preference migration | STA-01 | UI integration and reversible migration tests |
| LIB-01 | Validated full-library query service and complete retrieval | FND-01, STA-01 | Large-library and authorization tests |
| LIB-02 | Search/filter/sort interface, URL state, and counts | LIB-01, STA-02 | Multi-page browser tests |
| OFF-01 | Storage/range prototype on target devices | FND-01 | Large-file seeking and memory evidence |
| OFF-02 | Versioned download storage and permission-checked acquisition | OFF-01 | Persistence, corruption, and account-isolation tests |
| OFF-03 | Download queue, recovery, and Downloads interface | OFF-02 | Interrupted/resumed/quota scenarios |
| OFF-04 | Extract playback controller and source adapters | STA-01 | Existing playback regression checks |
| OFF-05 | Offline shell, service-worker routing, and local media playback | OFF-02, OFF-04 | Cold-start airplane-mode test |
| OFF-06 | Durable progress delivery, reconciliation, and receipts | STA-02, OFF-04, FND-01 | Retry/crash/conflict tests |
| OFF-07 | Integrate startup, logout, eviction, and application upgrades | OFF-03, OFF-05, OFF-06 | End-to-end upgrade and recovery suite |
| REL-01 | Documentation, support matrix, and staged release | LIB-02, OFF-07 | Release checklist completed |
| UX-01 | Mini/full-player design exploration | Stable offline release | Reviewable desktop/mobile concepts |
| UX-02 | Player visual implementation | UX-01 design selection | Accessibility and playback regression evidence |

Suggested new modules: `src/lib/listening-status.ts`, `src/lib/library-query.ts`, `src/lib/offline/` for schemas/storage/downloads/outbox, a shared player controller under `src/components/player/`, and a Downloads view. Final filenames may follow conventions discovered during implementation.

## 11. Validation and release gates

Use unit tests for state derivation, query normalization, migrations, range calculations, download transitions, and conflict policy. Use integration tests for upstream authorization, catalog completeness, downloads, durable receipts, and progress delivery. Add browser automation for user journeys; real-device testing is required for Safari/iOS storage and background behavior.

| Scenario | Required result |
| --- | --- |
| Search a 10,000-book library for a last-page title | Correct match without manually loading intervening pages |
| Apply text + author + status + sort | Correct results and totals across all pages |
| Upgrade existing manual labels | Recoverable labels, consistent status, no implicit ABS writes |
| Download a single-file book larger than available memory | Bounded memory and successful seek near its end |
| Download a multi-track book with subtitle offsets | Correct transitions and subtitle timing offline |
| Interrupt download / exhaust quota / evict stored bytes | Honest state and repair/retry without corruption |
| Cold-launch with no network or unavailable ABS server | Downloaded library and player remain usable |
| Expire login while offline | Local playback continues; synchronization waits for valid login |
| Lose acknowledgment after server accepts session | No duplicate listening-time import |
| Change progress on two devices | Both positions preserved until resolved |
| Log out, change accounts, or lose library permission | No cross-account content exposure |
| Update service worker during listening | No playback interruption or deleted downloads |

Run the repository's `npm run typecheck`, `npm test`, and `npm run build` for each implementation release, plus the new relevant integration/browser checks. Plan creation itself does not require running the application test suite.

Provisional releases:

- **v1.3 — library and status:** release after migration and full-library query gates pass.
- **v1.4 beta — offline:** opt-in testing on target browsers with download, restart, and reconciliation diagnostics.
- **v1.4 stable:** ship after cold-start, corruption, account isolation, upgrade, and duplicate-delivery gates pass.
- **v1.5 or later — player redesign:** scope and version finalized after design exploration.

Use independent flags for full-library queries and new download creation. Disabling download creation must still allow existing downloads to play, pending progress to synchronize, and users to remove local files. Back up preferences before migration; document schema compatibility before rolling back application versions. Update README, patch notes, deployment/storage notes, and the supported browser matrix.

Diagnostics should record timings, operation IDs, byte totals, and error categories without logging tokens, subtitle contents, or search terms. No third-party analytics are required.

## 12. Effort and highest-risk dependencies

Planning ranges for one developer familiar with the code, including tests and review; not calendar commitments:

| Milestone | Estimated focused development days |
| --- | --- |
| Capability checks and shared contracts | 2–3 |
| Status model, migration, and controls | 3–5 |
| Complete-library search and interface | 4–7 |
| Offline storage, download acquisition, and Downloads interface | 6–9 |
| Offline shell and playback integration | 5–8 |
| Durable synchronization and conflicts | 5–8 |
| Cross-device qualification, upgrade testing, and release docs | 3–5 |
| **Core scope total** | **28–45** |
| Later player design exploration | 2–4 |
| Later player implementation and verification | 4–7 |

The server catalog fallback, mobile large-file seeking, and upstream retry semantics are the largest uncertainties. Re-estimate after Phase 0 and the storage prototype. If time is constrained, ship search/status first and keep offline in beta until the reliability gates pass.

## 13. Future phase — mini-player and full-screen player

### Design objectives

Make playback controls immediately understandable, reduce visual competition with subtitles, and make transitions between player sizes feel continuous. Use the same controller and audio element across views so opening or closing a layout never restarts audio or changes position.

### Mini-player direction

- Persistent bottom dock with cover, title, a compact chapter/progress summary, rewind, prominent play/pause, forward, and expand.
- On narrow screens, prioritize title and essential transport; put speed, timer, queue, subtitle options, and detailed sync state in an accessible secondary sheet.
- Show download/sync problems only when actionable; normal operation should stay visually quiet.
- Reserve page space for the dock and device safe areas so it cannot cover library controls.
- Support long titles, keyboard focus, accessible control labels, and approximately 44-pixel touch targets.
- Expansion preserves playback and returns keyboard focus correctly when collapsed. Gestures may be added, but buttons must remain available.

### Full-screen direction

- Explore a **Read along** layout with subtitles as the primary element, clear type, comfortable line width, and subdued controls.
- Explore a **Listen** layout with stronger cover/title emphasis and optional subtitles for users who are primarily listening.
- Keep chapter position and whole-book position understandable without two competing timelines.
- Put chapters, speed, sleep timer, subtitle source/alignment, and display preferences in consistent sheets or side panels.
- Preserve existing subtitle size, contrast, spacing, and placement settings.
- Explore optional control auto-hide during playback, with immediate reveal on interaction and no hiding while keyboard focus or an open panel needs them.
- Support landscape, portrait, tablet split view, and a focused-page fallback when browser-native fullscreen is unavailable.

### Exploration and delivery

After the offline release, review the running app and capture the existing player states. Produce two layout directions for both player sizes at phone, tablet, and desktop widths. Include paused, playing, loading, no subtitles, downloaded, and sync-conflict states. Use realistic long titles and subtitles.

Compare concepts against five tasks: resume quickly, seek accurately, change speed, adjust subtitles, and inspect pending sync. Select one direction before visual implementation; this is the appropriate point for user design feedback. The earlier functional work need not wait for this decision.

Acceptance: no playback interruption on view changes; consistent controls; readable subtitles at supported sizes; keyboard and screen-reader access; reduced-motion support; no hidden controls behind the dock or mobile safe areas; passing online/offline playback regressions.

Do not bundle new transcript search, bookmarks, or unrelated library redesign into this phase. Those can be planned separately after the selected scope is delivered.
