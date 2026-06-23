"use client";

import { useEffect, useRef } from "react";

type BootAudioOptions = {
  enabled?: boolean;
  volume?: number;
  onPlayed?: () => void;
};

function playSynthFallback(volume: number) {
  const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return;
  const context = new AudioContextCtor();
  const master = context.createGain();
  master.gain.setValueAtTime(Math.max(0, Math.min(volume, 0.5)), context.currentTime);
  master.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 1.35);
  master.connect(context.destination);

  [110, 220, 440, 880].forEach((frequency, index) => {
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = index % 2 === 0 ? "sawtooth" : "triangle";
    osc.frequency.setValueAtTime(frequency, context.currentTime);
    osc.frequency.exponentialRampToValueAtTime(frequency * 1.18, context.currentTime + 0.9);
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.16 / (index + 1), context.currentTime + 0.08 + index * 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 1.2);
    osc.connect(gain);
    gain.connect(master);
    osc.start(context.currentTime + index * 0.045);
    osc.stop(context.currentTime + 1.35);
  });
}

export function useBootAudio({ enabled = true, volume = 0.22, onPlayed }: BootAudioOptions = {}) {
  const played = useRef(false);

  useEffect(() => {
    if (!enabled || played.current || typeof window === "undefined") return;
    played.current = true;

    const audio = new Audio("/audio/boot.mp3");
    audio.volume = Math.max(0, Math.min(volume, 1));
    audio.loop = false;
    audio.preload = "auto";
    audio.play().catch(() => playSynthFallback(volume));
    window.setTimeout(() => onPlayed?.(), 650);
  }, [enabled, onPlayed, volume]);
}
