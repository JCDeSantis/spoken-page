type BrandLockupProps = {
  compact?: boolean;
};

export function BrandLockup({ compact = false }: BrandLockupProps) {
  return (
    <div className={`brand-lockup ${compact ? "brand-lockup-compact" : ""}`}>
      <div aria-label="Spoken Page logo" className="brand-mark" role="img">
        <div className="brand-book brand-book-left" />
        <div className="brand-book brand-book-right" />
        <div className="brand-bars">
          <span className="brand-bar brand-bar-blue-1" />
          <span className="brand-bar brand-bar-blue-2" />
          <span className="brand-bar brand-bar-blue-3" />
          <span className="brand-bar brand-bar-orange-1" />
          <span className="brand-bar brand-bar-orange-2" />
        </div>
      </div>

      <div className="brand-wordmark">
        <span className="brand-word brand-word-top">Spoken</span>
        <span className="brand-word brand-word-bottom">Page</span>
      </div>
    </div>
  );
}
