#!/usr/bin/env python3
"""Synthesizes Salebell's original "cha-ching" alert (about 1.3 s, mono, 44.1 kHz).

"cha": two short bursts of filtered noise, like a cash drawer rattling.
"ching": two bright bell strikes built from inharmonic partials with exponential decay.
Made from scratch here, so it is royalty-free. Usage:
    python3 Scripts/make_chaching.py out.wav && afconvert -f caff -d LEI16@44100 -c 1 out.wav chaching.caf
"""
import math
import random
import struct
import sys
import wave

RATE = 44_100
LENGTH = 1.35
random.seed(7)  # reproducible output
samples = [0.0] * int(RATE * LENGTH)


def add_noise_burst(start, duration, gain):
    """Band-passed noise with a fast attack and quick decay."""
    lp = hp = prev = 0.0
    for i in range(int(duration * RATE)):
        t = i / RATE
        env = min(1.0, t / 0.004) * math.exp(-t / (duration * 0.35))
        x = random.uniform(-1, 1)
        lp += 0.35 * (x - lp)          # one-pole low-pass (~3 kHz)
        hp = 0.9 * (hp + lp - prev)    # one-pole high-pass (~700 Hz) → band-pass
        prev = lp
        j = int(start * RATE) + i
        if j < len(samples):
            samples[j] += gain * env * hp


def add_bell(start, freq, gain, decay):
    """Bell-like strike: a few inharmonic partials, the higher ones dying sooner."""
    partials = [(1.0, 1.0, 1.0), (2.76, 0.45, 0.55), (5.40, 0.25, 0.35), (8.93, 0.12, 0.2), (2.0, 0.3, 0.8)]
    for i in range(int((LENGTH - start) * RATE)):
        t = i / RATE
        attack = min(1.0, t / 0.002)
        v = 0.0
        for ratio, amp, life in partials:
            v += amp * math.exp(-t / (decay * life)) * math.sin(2 * math.pi * freq * ratio * t)
        samples[int(start * RATE) + i] += gain * attack * v


add_noise_burst(0.00, 0.07, 0.55)
add_noise_burst(0.085, 0.10, 0.65)
add_bell(0.20, 1567.98, 0.42, 0.55)   # G6
add_bell(0.27, 2093.00, 0.38, 0.65)   # C7, a fourth above: bright and happy

# Gentle fade at the very end, then normalise to -1 dBFS.
fade = int(0.08 * RATE)
for i in range(fade):
    samples[-fade + i] *= 1 - i / fade
peak = max(abs(s) for s in samples)
scale = (10 ** (-1 / 20)) / peak

out = sys.argv[1] if len(sys.argv) > 1 else "chaching.wav"
with wave.open(out, "wb") as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(RATE)
    w.writeframes(b"".join(struct.pack("<h", int(s * scale * 32767)) for s in samples))
print(f"wrote {out} ({LENGTH:.2f}s)")
