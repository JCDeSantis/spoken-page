import { listeningState, LISTENING_LABELS } from "@/lib/listening-status";
import { LibraryItemMinified } from "@/lib/types";
import { bookSeries } from "@/lib/series";

type Props = {
  item: LibraryItemMinified;
  compact?: boolean;
  favorite: boolean;
  selected: boolean;
  wantToListen?: boolean;
  onSelect: () => void;
  onSelectSeries: (name: string) => void;
  onToggleFavorite: () => void;
};

function PinIcon({ pinned }: { pinned: boolean }) {
  return <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <g transform="rotate(35 12 12)">
      <path d="M8 3h8l-1 7 3 3v2H6v-2l3-3z" fill={pinned ? "currentColor" : "none"} />
      <path d="M12 15v6" />
    </g>
  </svg>;
}

export function BookTile({ item, compact, favorite, selected, wantToListen, onSelect, onSelectSeries, onToggleFavorite }: Props) {
  const status = listeningState(item.userMediaProgress);
  const seriesEntries = bookSeries(item.media.metadata);
  const author = item.media.metadata.authorName ?? "Unknown author";
  const progress = item.userMediaProgress;
  const progressPercent = progress && progress.currentTime > 0
    ? Math.round(Math.min(100, progress.currentTime / (progress.duration || item.media.duration || 1) * 100))
    : 0;
  const statusLabel = `${LISTENING_LABELS[status]}${status === "in-progress" && progressPercent ? ` · ${progressPercent}%` : ""}${wantToListen ? " · Want to listen" : ""}`;
  if (compact) {
    return (
      <article className={`book-tile book-tile-compact ${selected ? "book-tile-active" : ""}`}>
        <button className="book-tile-compact-select" onClick={onSelect} type="button">
          <img alt="" className="book-tile-cover" src={`/api/items/${item.id}/cover`} />
          <span className="book-tile-compact-copy">
            <strong className="book-tile-title" title={item.media.metadata.title}>{item.media.metadata.title}</strong>
            <span className="book-tile-author" title={author}>{author}</span>
            {statusLabel ? <span className="book-progress-label">{statusLabel}</span> : null}
          </span>
        </button>
        <button aria-label={`Unpin ${item.media.metadata.title}`} title="Unpin book" aria-pressed="true" className="favorite-chip favorite-chip-active" onClick={onToggleFavorite} type="button"><PinIcon pinned /></button>
      </article>
    );
  }
  return (
    <article className={`book-tile ${selected ? "book-tile-active" : ""}`}>
      <button className="book-tile-select" onClick={onSelect} type="button">
        <img alt="" className="book-tile-cover" src={`/api/items/${item.id}/cover`} />
        <strong className="book-tile-title" title={item.media.metadata.title}>{item.media.metadata.title}</strong>
      </button>
      {seriesEntries.map(series => (
        <button key={series.id ?? series.name} className="book-tile-series" onClick={() => onSelectSeries(series.name)} title={`Filter by ${series.name}`} type="button">
          <span className="book-tile-series-name" title={series.name}>{series.name}</span>
          {series.number ? <span className="book-tile-series-number" title={`Book ${series.number}`}>#{series.number}</span> : null}
        </button>
      ))}
      <span className="book-tile-author" title={author}>{author}</span>
      {status && statusLabel ? (
        <span className={`book-progress-label book-progress-${status}`}>{statusLabel}</span>
      ) : statusLabel ? <span className="book-progress-label">{statusLabel}</span> : null}
      {progressPercent > 0 && !progress?.isFinished && status !== "finished" ? (
        <span className="book-tile-progress" role="progressbar" aria-label={`${item.media.metadata.title} listening progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercent}>
          <span style={{ width: `${progressPercent}%` }} />
        </span>
      ) : null}
      <button aria-label={favorite ? `Unpin ${item.media.metadata.title}` : `Pin ${item.media.metadata.title}`} title={favorite ? "Unpin book" : "Pin book"} aria-pressed={favorite} className={`favorite-chip ${favorite ? "favorite-chip-active" : ""}`} onClick={onToggleFavorite} type="button">
        <PinIcon pinned={favorite} />
      </button>
    </article>
  );
}
