"use client";

import { listeningState, LISTENING_LABELS, type ProgressAction } from "@/lib/listening-status";
import type { LegacyStatus } from "@/lib/library-preferences";
import { KeyboardEvent, useEffect, useRef, useState } from "react";
import { LibraryItemExpanded, LibraryItemMinified } from "@/lib/types";
import { formatDuration } from "./library-utils";
import { bookSeries } from "@/lib/series";

type Props = {
  item: LibraryItemExpanded | null;
  loading: boolean;
  error: string | null;
  nextInSeries: LibraryItemMinified | null;
  queue: LibraryItemMinified[];
  onResume: () => void;
  onSelectSeries: (name: string) => void;
  onAddToQueue: (item: LibraryItemMinified) => void;
  onRemoveFromQueue: (id: string) => void;
  onSelectQueued: (id: string) => void;
  onSelectNext: (id: string) => void;
  wantToListen: boolean;
  onToggleWant: () => void;
  onProgressAction: (action: ProgressAction) => void;
  progressBusy: boolean;
  progressError: string | null;
  legacyStatus?: LegacyStatus;
  onDismissLegacy: () => void;
};

function descriptionToText(source: string) {
  const parser = new DOMParser();
  let document = parser.parseFromString(source, "text/html");
  // Some libraries store escaped HTML instead of markup.
  if (!document.body.children.length && /<\/?[a-z][^>]*>/i.test(document.body.textContent ?? "")) {
    document = parser.parseFromString(document.body.textContent ?? "", "text/html");
  }
  document.querySelectorAll("script, style, template, noscript").forEach((node) => node.remove());

  function visit(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const element = node as Element;
    if (element.tagName === "BR") return "\n";
    const content = Array.from(element.childNodes, visit).join("");
    return /^(P|DIV|SECTION|ARTICLE|BLOCKQUOTE|LI|H[1-6]|UL|OL)$/i.test(element.tagName)
      ? `${content}\n\n`
      : content;
  }

  return Array.from(document.body.childNodes, visit).join("")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function BookSynopsis({ description }: { description: string }) {
  const paragraphRef = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [canExpand, setCanExpand] = useState(false);
  const [plainDescription, setPlainDescription] = useState<{ source: string; text: string } | null>(null);
  const text = plainDescription?.source === description ? plainDescription.text : "";

  useEffect(() => {
    setPlainDescription({ source: description, text: descriptionToText(description) });
  }, [description]);

  useEffect(() => {
    setExpanded(false);
  }, [description]);

  useEffect(() => {
    if (expanded) return;

    const paragraph = paragraphRef.current;
    if (!paragraph) return;

    const measure = () => setCanExpand(paragraph.scrollHeight > paragraph.clientHeight + 1);
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(paragraph);
    return () => observer.disconnect();
  }, [text, expanded]);

  function toggleExpanded() {
    if (canExpand) setExpanded((current) => !current);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLParagraphElement>) {
    if (canExpand && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      toggleExpanded();
    }
  }

  return (
    <div className={`book-details-synopsis ${canExpand ? "book-details-synopsis-expandable" : ""}`}>
      <p
        aria-expanded={canExpand ? expanded : undefined}
        className={`book-details-description ${expanded ? "book-details-description-expanded" : ""}`}
        onClick={toggleExpanded}
        onKeyDown={handleKeyDown}
        ref={paragraphRef}
        role={canExpand ? "button" : undefined}
        tabIndex={canExpand ? 0 : undefined}
      >
        {text}
      </p>
      {canExpand ? (
        <button className="book-details-synopsis-toggle" onClick={toggleExpanded} type="button">
          {expanded ? "Show less" : "Show more"}
        </button>
      ) : null}
    </div>
  );
}

export function BookDetails({ item, loading, error, nextInSeries, queue, onResume, onSelectSeries, onAddToQueue, onRemoveFromQueue, onSelectQueued, onSelectNext, wantToListen, onToggleWant, onProgressAction, progressBusy, progressError, legacyStatus, onDismissLegacy }: Props) {
  if (loading) return <aside className="book-details-card" aria-live="polite">Loading book details…</aside>;
  if (error) return <aside className="book-details-card status-error" role="alert">{error}</aside>;
  if (!item) return null;
  const progress = item.userMediaProgress;
  const status = listeningState(progress);
  const remaining = Math.max(0, item.media.duration - (progress?.currentTime ?? 0));
  const seriesEntries = bookSeries(item.media.metadata);
  return (
    <aside className="book-details-card" aria-label="Selected book details">
      <img alt="" src={`/api/items/${item.id}/cover`} />
      <div className="book-details-copy">
        {seriesEntries.length ? seriesEntries.map(series => (
          <button key={series.id ?? series.name} className="eyebrow book-details-series" onClick={() => onSelectSeries(series.name)} title={`Filter by ${series.name}`} type="button">
            {series.name}{series.number ? ` · Book ${series.number}` : ""}
          </button>
        )) : <p className="eyebrow">Book details</p>}
        <h3>{item.media.metadata.title}</h3>
        {item.media.metadata.subtitle ? <p className="book-details-subtitle">{item.media.metadata.subtitle}</p> : null}
        <p>{item.media.metadata.authorName ?? "Unknown author"}{item.media.metadata.narratorName ? ` · Narrated by ${item.media.metadata.narratorName}` : ""}</p>
        <div className="book-details-facts">
          <span>{formatDuration(item.media.duration)}</span><span>{formatDuration(remaining)} remaining</span>
          <span>{item.media.chapters?.length ?? item.media.numChapters ?? 0} chapters</span>
          {item.media.metadata.publishedYear ? <span>{item.media.metadata.publishedYear}</span> : null}
        </div>
        <section className="book-status-control" aria-label="Listening status">
          <strong>{LISTENING_LABELS[status]}</strong>
          <small>Listening progress is shared with Audiobookshelf.</small>
          <div className="book-progress-actions">
            <button className="button book-action-secondary want-listen-button" aria-pressed={wantToListen} onClick={onToggleWant} type="button">Want to listen</button>
            <button className="button book-action-secondary" disabled={progressBusy} onClick={() => onProgressAction(status === "finished" ? "unfinished" : "complete")} type="button">{progressBusy ? "Saving…" : status === "finished" ? "Mark unfinished" : "Mark complete"}</button>
            {status === "in-progress" || status === "finished" ? <button className="button book-action-secondary" disabled={progressBusy} onClick={() => onProgressAction("restart")} type="button">Start over</button> : null}
          </div>
          {legacyStatus && legacyStatus !== "planned" && legacyStatus !== status ? <div className="status-message">Your previous manual label was {LISTENING_LABELS[legacyStatus]}. We kept it for reference; the status above reflects your listening progress. Use the actions above to change it. <button className="button button-quiet" onClick={onDismissLegacy} type="button">Dismiss</button></div> : null}
          {progressError ? <p role="alert" className="status-error">{progressError}</p> : null}
        </section>
        {item.media.metadata.description ? <BookSynopsis description={item.media.metadata.description} /> : null}
        <div className="book-details-actions">
          {status !== "finished" ? <button className="button book-action-primary" disabled={progressBusy} onClick={onResume} type="button">{(progress?.currentTime ?? 0) > 0 ? "Resume" : "Play"}</button> : null}
          {nextInSeries ? <button className="button book-action-secondary" onClick={() => onAddToQueue(nextInSeries)} type="button">Queue next in series</button> : null}
        </div>
        {nextInSeries ? <section className="next-series-preview" aria-label="Next book in series">
          <button className="next-series-link" onClick={() => onSelectNext(nextInSeries.id)} type="button">
            <img alt="" src={`/api/items/${nextInSeries.id}/cover`} />
            <span><small>Next in series</small><strong>{nextInSeries.media.metadata.title}</strong><span>{bookSeries(nextInSeries.media.metadata).filter(next => seriesEntries.some(series => series.name.toLocaleLowerCase() === next.name.toLocaleLowerCase())).map(series => `${series.name}${series.number ? ` · Book ${series.number}` : ""}`).join(" / ")}</span></span>
          </button>
        </section> : item.nextInSeriesError ? <p className="status-message">{item.nextInSeriesError}</p> : null}
        {queue.length ? <div className="book-queue"><strong>Queue</strong>{queue.map((queued, index) => <div className="book-queue-row" key={queued.id}><button onClick={() => onSelectQueued(queued.id)} type="button">{index + 1}. {queued.media.metadata.title}</button><button aria-label={`Remove ${queued.media.metadata.title} from queue`} onClick={() => onRemoveFromQueue(queued.id)} title="Remove from queue" type="button">×</button></div>)}</div> : null}
      </div>
    </aside>
  );
}
