# Library upgrades review

## Behavior

- A fresh visit restores the account's library, search, sort and direction, listening status, Want to listen, Hide completed, and metadata filters. URLs with explicit library controls override the saved view. A browser copy provides a fallback if account settings cannot be read; unavailable account settings are not overwritten.
- Series links use each membership separately. Structured Audiobookshelf series names and positions take precedence over combined display strings. Series sorting uses numeric positions, including decimals, and uses the chosen membership when filtering a series. Unknown positions and standalone books follow numbered entries.
- Book details show the next available higher numeric sequence in the same authorized library, with cover art and direct navigation. The first series with an available successor is used for books belonging to multiple series. Opening this preview does not remove a queued book or start playback. If sequence information is missing, no successor is guessed.
- The player shows saving, saved, and failed progress states even without subtitles. Temporary failures retry after 10, 20, 40, then at most 60 seconds, including while paused; reconnecting or Retry now can retry sooner. Authentication failures request sign-in and do not schedule automatic retries.

## Verification

- 63 automated tests passed, including complete-catalog next-book lookup, inaccessible items, catalog failure fallback, secondary series filtering and sorting, numeric positions, preference validation, authentication feedback, and retry delay limits. The opt-in live server probe was skipped in this run.
- Type checking and the production build passed.
- Browser verification used an isolated 1,205-book library: saved search, Series sort, author selection and Hide completed restored on a fresh visit; an explicit URL overrode the saved view. Details for book 1199 displayed book 1200 despite the search and author filter excluding it. Clicking the preview opened book 1200.
- Generated test audio and a simulated server failure verified visible errors without subtitles, manual retry while paused, and automatic recovery while paused. The recovered position was checked in the fixture's server progress record.
- The configured Audiobookshelf library was opened for a read-only visual check. Playback failure tests did not change real listening progress.

## Limits

- Retry state exists only while the player is open. Closing the page during a failed save does not retain a pending save; this work adds no offline progress storage or downloads.
- A cold complete-catalog lookup can delay book details. If that lookup fails, details remain usable and explain that the next book could not be checked.
- Combined series text without clear numbered boundaries can be ambiguous; structured series metadata avoids that ambiguity.
- Player redesign and offline phases remain excluded. These upgrades are included in v1.3.0.
