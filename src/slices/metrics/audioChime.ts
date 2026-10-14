let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioCtx) {
      audioCtx = new AudioCtx();
    }
  }
  if (audioCtx && audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

export function isChimeEnabled(): boolean {
  if (typeof window === "undefined") return false;
  const val = localStorage.getItem("quay_chime_enabled");
  return val === null ? true : val === "true";
}

export function setChimeEnabled(enabled: boolean): void {
  localStorage.setItem("quay_chime_enabled", enabled.toString());
}

export function getChimeVolume(): number {
  if (typeof window === "undefined") return 0.3;
  const val = localStorage.getItem("quay_chime_volume");
  if (!val) return 0.3;
  const parsed = parseFloat(val);
  return isNaN(parsed) ? 0.3 : Math.max(0, Math.min(1, parsed));
}

export function setChimeVolume(vol: number): void {
  localStorage.setItem("quay_chime_volume", vol.toString());
}

/**
 * Play a pleasant ascending harmonic chime when Claude finishes a turn
 */
export function playTurnCompletedChime(): void {
  if (!isChimeEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const masterVol = getChimeVolume();
  const notes = [
    { freq: 523.25, time: 0.00 }, // C5
    { freq: 659.25, time: 0.08 }, // E5
    { freq: 783.99, time: 0.16 }, // G5
    { freq: 1046.50, time: 0.24 }, // C6
  ];

  notes.forEach(({ freq, time }) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, ctx.currentTime + time);

    gain.gain.setValueAtTime(0.001, ctx.currentTime + time);
    gain.gain.exponentialRampToValueAtTime(masterVol * 0.4, ctx.currentTime + time + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + time + 0.35);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(ctx.currentTime + time);
    osc.stop(ctx.currentTime + time + 0.4);
  });
}

/**
 * Play a gentle double ping when Claude needs attention or decision approval
 */
export function playAttentionChime(): void {
  if (!isChimeEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const masterVol = getChimeVolume();
  const notes = [
    { freq: 587.33, time: 0.00 }, // D5
    { freq: 880.00, time: 0.12 }, // A5
  ];

  notes.forEach(({ freq, time }) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq, ctx.currentTime + time);

    gain.gain.setValueAtTime(0.001, ctx.currentTime + time);
    gain.gain.exponentialRampToValueAtTime(masterVol * 0.5, ctx.currentTime + time + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + time + 0.4);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(ctx.currentTime + time);
    osc.stop(ctx.currentTime + time + 0.45);
  });
}
