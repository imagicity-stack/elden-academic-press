/** Elden mark + stacked wordmark. `light` is the footer (dark background) version. */
export function Logo({ light = false }: { light?: boolean }) {
  return (
    <span className={'logo' + (light ? ' logo--light' : '')}>
      {/* Small copies (shown 38 px tall); the full-size marks stay for link previews and the admin. */}
      <img src={light ? '/assets/elden-mark-light-sm.png' : '/assets/elden-mark-sm.png'} width={86} height={114} alt="" className="logo__mark" />
      <span className="logo__words">
        <span className="logo__name">ELDEN</span>
        <span className="logo__sub">ACADEMIC PRESS</span>
      </span>
    </span>
  );
}

/** Placeholder elmaster wordmark — swap for the real logo when available. */
export function ElmasterMark({ className = '' }: { className?: string }) {
  return (
    <span className={'elm-mark ' + className}>
      <span className="elm-mark__el">el</span>master
    </span>
  );
}
