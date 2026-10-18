/** Elden mark + stacked wordmark. `light` is the footer (dark background) version. */
export function Logo({ light = false }: { light?: boolean }) {
  return (
    <span className={'logo' + (light ? ' logo--light' : '')}>
      <img src={light ? '/assets/elden-mark-light.png' : '/assets/elden-mark.png'} alt="" className="logo__mark" />
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
