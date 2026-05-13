let context: AudioContext | null = null;

const ensureContext = () => {
  context ??= new AudioContext();
  if (context.state === "suspended") void context.resume();
  return context;
};

const envelope = (gain: GainNode, start: number, peak: number, duration: number) => {
  gain.gain.cancelScheduledValues(start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
};

export const unlockAudio = () => {
  ensureContext();
};

export const playPop = (combo = 1) => {
  const audio = ensureContext();
  const start = audio.currentTime;
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.type = "triangle";
  oscillator.frequency.setValueAtTime(560 + combo * 34, start);
  oscillator.frequency.exponentialRampToValueAtTime(180 + combo * 22, start + 0.12);
  envelope(gain, start, Math.min(0.08 + combo * 0.016, 0.18), 0.15);
  oscillator.connect(gain);
  gain.connect(audio.destination);
  oscillator.start(start);
  oscillator.stop(start + 0.16);
};

export const playBurst = (combo = 1) => {
  const audio = ensureContext();
  const start = audio.currentTime;
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.type = "sawtooth";
  oscillator.frequency.setValueAtTime(90 + combo * 20, start);
  oscillator.frequency.exponentialRampToValueAtTime(44, start + 0.18);
  envelope(gain, start, Math.min(0.16 + combo * 0.03, 0.32), 0.22);
  oscillator.connect(gain);
  gain.connect(audio.destination);
  oscillator.start(start);
  oscillator.stop(start + 0.24);

  const blip = audio.createOscillator();
  const blipGain = audio.createGain();
  blip.type = "square";
  blip.frequency.setValueAtTime(880 + combo * 40, start + 0.03);
  blip.frequency.exponentialRampToValueAtTime(1320 + combo * 60, start + 0.09);
  envelope(blipGain, start + 0.02, 0.055, 0.13);
  blip.connect(blipGain);
  blipGain.connect(audio.destination);
  blip.start(start + 0.02);
  blip.stop(start + 0.16);
};
