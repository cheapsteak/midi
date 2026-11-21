import type { Ms } from './types';

export interface ClockMapper {
  /** Map a native monotonic timestamp (ms) into the `performance.now()` domain. */
  toPerf(nativeMs: number, arrivalPerfNow: Ms): Ms;
  /** Forget the learned offset (call after sleep/resume). */
  reset(): void;
}

/**
 * Keeps the smallest observed (arrival − native) offset. The smallest offset belongs to
 * the message that crossed the bridge fastest, so mapped times strip bridge jitter and
 * never land after the moment the message actually arrived.
 */
export function createClockMapper(): ClockMapper {
  let offset: number | null = null;
  return {
    toPerf(nativeMs, arrivalPerfNow) {
      const candidate = arrivalPerfNow - nativeMs;
      if (offset === null || candidate < offset) offset = candidate;
      return nativeMs + offset;
    },
    reset() {
      offset = null;
    },
  };
}
