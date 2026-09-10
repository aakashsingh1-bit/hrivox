/** Lightweight Web Audio SFX — no external files needed */

import { isMuted } from '@/lib/prefs';

let ctx: AudioContext | null = null;

function getCtx() {
  if (typeof window === 'undefined') return null;
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

export function unlockAudio() {
  const ac = getCtx();
  if (ac?.state === 'suspended') void ac.resume();
}

export function playTone(freq: number, duration = 0.12, type: OscillatorType = 'sine', gain = 0.08) {
  if (isMuted()) return;
  const ac = getCtx();
  if (!ac) return;
  if (ac.state === 'suspended') void ac.resume();
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.value = gain;
  osc.connect(g);
  g.connect(ac.destination);
  const t = ac.currentTime;
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + duration);
  osc.start(t);
  osc.stop(t + duration);
}

export function playBetOk() {
  playTone(520, 0.08, 'square', 0.06);
  window.setTimeout(() => playTone(780, 0.12, 'square', 0.07), 80);
}

export function playTick() {
  playTone(240, 0.04, 'triangle', 0.04);
}

export function playSpinStart() {
  playTone(180, 0.15, 'sawtooth', 0.05);
  window.setTimeout(() => playTone(220, 0.2, 'sawtooth', 0.05), 100);
}

export function playWin(digit: number) {
  playTone(440 + digit * 20, 0.15, 'sine', 0.08);
  window.setTimeout(() => playTone(660, 0.2, 'sine', 0.09), 120);
  window.setTimeout(() => playTone(880, 0.25, 'sine', 0.07), 260);
}

export function playSplash() {
  playTone(330, 0.18, 'sine', 0.07);
  window.setTimeout(() => playTone(440, 0.2, 'sine', 0.08), 140);
  window.setTimeout(() => playTone(554, 0.28, 'sine', 0.07), 280);
}

export function playTap() {
  playTone(640, 0.05, 'triangle', 0.035);
}

export function playNav() {
  playTone(480, 0.04, 'sine', 0.03);
}
