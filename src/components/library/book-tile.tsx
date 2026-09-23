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
  onDismiss?: () => void;
};

export function BookTile({ item, compact, favorite, selected, status: savedStatus, onSelect, onSelectSeries, onToggleFavorite, onDismiss }: Props) {
  const status = selectedBookStatus(savedStatus);
  const series = seriesDisplay(item.media.metadata.seriesName);
  const author = item.media.metadata.authorName ?? "Unknown author";
  const statusLabel = status === "finished"
    ? "Completed"
    : status === "in-progress"
      ? "In progress"
      : status === "planned"
        ? "Planned"
        : status === "unstarted"
          ? "Not started"
          : null;
  return (
    <article className={`book-tile ${selected ? "book-tile-active" : ""} ${compact ? "book-tile-compact" : ""}`}>
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
      ) : null}
      {onDismiss ? <button aria-label="Remove from recent books" className="recent-chip" onClick={onDismiss} title="Remove from recent books" type="button" /> : null}
      <button aria-label={favorite ? "Remove from saved books" : "Save this book"} className={`favorite-chip ${favorite ? "favorite-chip-active" : ""}`} onClick={onToggleFavorite} type="button">
        <span className="favorite-chip-label"><span className="favorite-chip-text favorite-chip-text-default">{favorite ? "Saved" : "Save"}</span>{favorite ? <span className="favorite-chip-text favorite-chip-text-hover">Remove</span> : null}</span>
      </button>
    </article>
  );
}
