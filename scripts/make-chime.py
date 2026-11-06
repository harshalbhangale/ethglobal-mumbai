# A short "cha-ching" made from scratch: two bell-like hits (inharmonic partials, exponential decay).
import math, struct, wave, sys
RATE = 44100
DUR = 0.55
N = int(RATE * DUR)
out = [0.0] * N

def bell(start, f0, amp, decay):
    partials = [(1.0, 1.0), (2.76, 0.42), (5.40, 0.20), (8.93, 0.08)]
    s = int(start * RATE)
    for i in range(s, N):
        t = (i - s) / RATE
        env = (1 - math.exp(-t / 0.002)) * math.exp(-t / decay)  # 2 ms attack, then ring down
        v = 0.0
        for ratio, a in partials:
            v += a * math.exp(-t * ratio * 2.2) * math.sin(2 * math.pi * f0 * ratio * t)
        out[i] += amp * env * v

bell(0.000, 1318.5, 0.55, 0.060)   # "cha": E6, short
bell(0.085, 1975.5, 0.70, 0.160)   # "ching": B6, rings longer

peak = max(abs(x) for x in out)
gain = 0.42 / peak                 # quiet: about -7.5 dBFS at the peak
fade = int(0.04 * RATE)
for i in range(N - fade, N):       # no click at the end
    out[i] *= (N - i) / fade
with wave.open(sys.argv[1], "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE)
    w.writeframes(b"".join(struct.pack("<h", int(max(-1, min(1, x * gain)) * 32767)) for x in out))
