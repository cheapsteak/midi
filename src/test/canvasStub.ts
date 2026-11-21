/**
 * OSMD measures text with a 2D canvas while loading. jsdom has no canvas, so give it a
 * minimal fake. render() still cannot run under jsdom; only load() and iteration do.
 */
export function installCanvasStub(): void {
  HTMLCanvasElement.prototype.getContext = function getContext() {
    return {
      font: '',
      measureText: (text: string) => ({ width: String(text).length * 10 }),
    } as unknown as CanvasRenderingContext2D;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext;
}
