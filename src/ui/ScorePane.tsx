import { useEffect, useRef } from 'react';
import { OsmdScoreView } from '../notation/osmd/osmdScoreView';
import { useAppState, useServices } from './context';

export function ScorePane() {
  const { session } = useServices();
  const hostRef = useRef<HTMLDivElement>(null);
  const loading = useAppState((s) => s.loading);
  const loadError = useAppState((s) => s.loadError);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const view = new OsmdScoreView(host);
    session.attachView(view);
    void session.openInitialSong();

    // Re-render only when the width really changes (rotation, window resize), debounced.
    let lastWidth = host.clientWidth;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver(() => {
      const width = host.clientWidth;
      if (Math.abs(width - lastWidth) < 2) return;
      lastWidth = width;
      clearTimeout(timer);
      timer = setTimeout(() => view.relayout(), 200);
    });
    observer.observe(host);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
      view.dispose();
    };
  }, [session]);

  return (
    <div className="score-scroll">
      {loading && <div className="score-message">Loading score…</div>}
      {loadError && <div className="score-message error">{loadError}</div>}
      <div className="score-host" ref={hostRef} data-testid="score" />
    </div>
  );
}
