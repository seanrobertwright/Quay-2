/// <reference lib="dom" />

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

interface Clip {
  muted: boolean;
  play(): Promise<void>;
  pause(): void;
}

/**
 * Plays a step card's clip muted, looping as its `loop` attribute says, unless the reader's
 * system asks for reduced motion: then it stays paused on its poster until the reader plays it.
 * A browser that blocks autoplay leaves the poster up the same way.
 */
export function playUnlessReduced(clip: Clip, reduced: boolean): void {
  if (reduced) {
    clip.pause();
    return;
  }
  clip.muted = true;
  clip.play().catch(() => {});
}

const stopListening = new WeakMap<HTMLVideoElement, () => void>();

/**
 * `v-step-card-clip`, which the step-card plugin puts on each clip's `<video>`. The page is
 * server-rendered, so the clip has no `autoplay` attribute; this starts it once it is mounted,
 * and again whenever the reader's reduced-motion setting changes.
 */
export const stepCardClip = {
  mounted(video: HTMLVideoElement) {
    const query = window.matchMedia(REDUCED_MOTION);
    const apply = () => playUnlessReduced(video, query.matches);
    apply();
    query.addEventListener('change', apply);
    stopListening.set(video, () => query.removeEventListener('change', apply));
  },
  unmounted(video: HTMLVideoElement) {
    stopListening.get(video)?.();
    stopListening.delete(video);
  },
};
