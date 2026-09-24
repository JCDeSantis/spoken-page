import { LibraryItemMinified } from "@/lib/types";
import { BookProgressStatus, selectedBookStatus, seriesDisplay } from "./library-utils";

type Props = {
  item: LibraryItemMinified;
  compact?: boolean;
  favorite: boolean;
  selected: boolean;
  status?: BookProgressStatus;
  onSelect: () => void;
  onSelectSeries: () => void;
  onToggleFavorite: () => void;
};

export function BookTile({ item, compact, favorite, selected, status: savedStatus, onSelect, onSelectSeries, onToggleFavorite }: Props) {
  const status = selectedBookStatus(savedStatus);
  const series = seriesDisplay(item.media.metadata.seriesName);
  const author = item.media.metadata.authorName ?? "Unknown author";
  const progress = item.userMediaProgress;
  const progressPercent = progress && progress.currentTime > 0
    ? Math.round(Math.min(100, progress.currentTime / (progress.duration || item.media.duration || 1) * 100))
    : 0;
  const statusLabel = status === "finished"
    ? "Completed"
    : status === "in-progress"
      ? `In progress${progressPercent ? ` · ${progressPercent}%` : ""}`
      : status === "planned"
        ? "Planned"
        : status === "unstarted"
          ? "Not started"
          : progress?.isFinished
            ? "Completed"
            : progressPercent > 0
              ? `In progress · ${progressPercent}%`
              : null;
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
        <button aria-label={`Unpin ${item.media.metadata.title}`} aria-pressed="true" className="favorite-chip favorite-chip-active" onClick={onToggleFavorite} type="button">Unpin</button>
      </article>
    );
  }
  return (
    <article className={`book-tile ${selected ? "book-tile-active" : ""}`}>
      <button className="book-tile-select" onClick={onSelect} type="button">
        <img alt="" className="book-tile-cover" src={`/api/items/${item.id}/cover`} />
        <strong className="book-tile-title" title={item.media.metadata.title}>{item.media.metadata.title}</strong>
      </button>
      {series.name ? (
        <button className="book-tile-series" onClick={onSelectSeries} title={`Filter by ${series.name}`} type="button">
          <span className="book-tile-series-name" title={series.name}>{series.name}</span>
          {series.number ? <span className="book-tile-series-number" title={`Book ${series.number}`}>#{series.number}</span> : null}
        </button>
      ) : null}
      <span className="book-tile-author" title={author}>{author}</span>
      {status && statusLabel ? (
        <span className={`book-progress-label book-progress-${status}`}>{statusLabel}</span>
      ) : statusLabel ? <span className="book-progress-label">{statusLabel}</span> : null}
      {progressPercent > 0 && !progress?.isFinished && status !== "finished" ? (
        <span className="book-tile-progress" role="progressbar" aria-label={`${item.media.metadata.title} listening progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercent}>
          <span style={{ width: `${progressPercent}%` }} />
        </span>
      ) : null}
      <button aria-label={favorite ? `Unpin ${item.media.metadata.title}` : `Pin ${item.media.metadata.title}`} aria-pressed={favorite} className={`favorite-chip ${favorite ? "favorite-chip-active" : ""}`} onClick={onToggleFavorite} type="button">
        <span className="favorite-chip-label"><span className="favorite-chip-text favorite-chip-text-default">{favorite ? "Pinned" : "Pin"}</span>{favorite ? <span className="favorite-chip-text favorite-chip-text-hover">Unpin</span> : null}</span>
      </button>
    </article>
  );
}
