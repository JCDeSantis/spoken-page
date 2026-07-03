import { LibraryItemMinified } from "@/lib/types";
import { BookProgressStatus, selectedBookStatus } from "./library-utils";

type Props = {
  item: LibraryItemMinified;
  compact?: boolean;
  favorite: boolean;
  selected: boolean;
  status?: BookProgressStatus;
  onSelect: () => void;
  onToggleFavorite: () => void;
  onDismiss?: () => void;
};

export function BookTile({ item, compact, favorite, selected, status: savedStatus, onSelect, onToggleFavorite, onDismiss }: Props) {
  const status = selectedBookStatus(savedStatus);
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
        <div className="book-tile-copy">
          <strong>{item.media.metadata.title}</strong>
          <span>{item.media.metadata.authorName ?? "Unknown author"}</span>
          {status && statusLabel ? (
            <span className={`book-progress-label book-progress-${status}`}>{statusLabel}</span>
          ) : null}
        </div>
      </button>
      {onDismiss ? <button aria-label="Remove from recent books" className="recent-chip" onClick={onDismiss} title="Remove from recent books" type="button" /> : null}
      <button aria-label={favorite ? "Remove from saved books" : "Save this book"} className={`favorite-chip ${favorite ? "favorite-chip-active" : ""}`} onClick={onToggleFavorite} type="button">
        <span className="favorite-chip-label"><span className="favorite-chip-text favorite-chip-text-default">{favorite ? "Saved" : "Save"}</span>{favorite ? <span className="favorite-chip-text favorite-chip-text-hover">Remove</span> : null}</span>
      </button>
    </article>
  );
}
