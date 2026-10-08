/** appf2 brand mark; the wordmark text is the accessible name. */
export function Brand() {
  return (
    <span className="brand">
      <svg className="brand-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M5 19c0-7 4-13 14-14-1 9-6 14-14 14Z" fill="currentColor" />
        <path d="M5 19c3-4 6-7 10-9" fill="none" stroke="#fff" strokeWidth="1.75" strokeLinecap="round" />
      </svg>
      <span className="brand-name">appf2</span>
    </span>
  );
}
