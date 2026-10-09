type DiscoverNavProps = {
  readonly variant: "header" | "bottom";
  readonly onHome: () => void;
  readonly onExplore: () => void;
};

const HomeIcon = () => (
  <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5h-5v5H5a1 1 0 0 1-1-1Z" />
  </svg>
);

const IdeaIcon = () => (
  <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3Z" />
  </svg>
);

const AppsIcon = () => (
  <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />
  </svg>
);

/**
 * S01 navigation: 首頁 | 探索靈感 | 我的 App. Desktop renders it in the header, Mobile as the fixed bottom
 * nav (no hamburger, no Create). 「我的 App」 is an approved unavailable placeholder, marked by text, not color.
 */
export function DiscoverNav({ variant, onHome, onExplore }: DiscoverNavProps) {
  const label = variant === "header" ? "主要導覽" : "主要導覽（底部）";
  return (
    <nav className={`discover-nav discover-nav-${variant}`} aria-label={label}>
      <ul className="discover-nav-list">
        <li>
          <button type="button" className="discover-nav-item is-active" aria-current="page" onClick={onHome}>
            {variant === "bottom" ? <HomeIcon /> : null}
            <span>首頁</span>
          </button>
        </li>
        <li>
          <button type="button" className="discover-nav-item" onClick={onExplore}>
            {variant === "bottom" ? <IdeaIcon /> : null}
            <span>探索靈感</span>
          </button>
        </li>
        <li>
          <span className="discover-nav-item is-unavailable" aria-disabled="true">
            {variant === "bottom" ? <AppsIcon /> : null}
            <span>我的 App</span>
            <span className="soon-badge">Soon</span>
          </span>
        </li>
      </ul>
    </nav>
  );
}
