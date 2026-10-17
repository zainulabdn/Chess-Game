#!/usr/bin/env python3
"""Synthesize the promo soundtrack: an energetic electronic track (128 BPM drums, side-chained bass,
arpeggios, build-up and drop at the checkmate), chess SFX, UI dings and the voiceover.

usage: VO_EXT=mp3 make_audio.py events.json video_duration_seconds out.wav
"""
import json, math, os, subprocess, sys, wave
import numpy as np

SR = 44100
events = json.load(open(sys.argv[1]))
DUR = float(sys.argv[2])
OUT = sys.argv[3]
N = int(DUR * SR)
rng = np.random.default_rng(7)

# Three buses: drums, tonal music (side-chained by the kick), effects
drums = np.zeros((N, 2))
music = np.zeros((N, 2))
sfx = np.zeros((N, 2))
kick_times = []


def add(sig, t, gain=1.0, pan=0.0, bus=None):
    bus = music if bus is None else bus
    i = int(t * SR)
    if i >= N or i < 0:
        return
    if sig.ndim == 1:
        l = math.cos((pan + 1) * math.pi / 4)
        r = math.sin((pan + 1) * math.pi / 4)
        sig = np.stack([sig * l, sig * r], axis=1)
    n = min(len(sig), N - i)
    bus[i:i + n] += sig[:n] * gain


def tsec(n):
    return np.arange(n) / SR


def env_adsr(n, a, d=0.0, s=1.0, r=0.3):
    e = np.ones(n)
    a_n, d_n, r_n = int(a * SR), int(d * SR), int(r * SR)
    if a_n > 0:
        e[:a_n] = np.linspace(0, 1, a_n)
    if d_n > 0:
        e[a_n:a_n + d_n] = np.linspace(1, s, min(d_n, max(0, n - a_n)))
        e[a_n + d_n:] = s
    if 0 < r_n < n:
        e[-r_n:] *= np.linspace(1, 0, r_n)
    return e


def note(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)


def highpass(sig, k=6):
    return sig - np.convolve(sig, np.ones(k) / k, mode='same')


# ------------------------------------------------------------------ drums
def kick(t0, gain=1.0):
    n = int(0.34 * SR)
    t = tsec(n)
    f = 46 + 130 * np.exp(-t * 26)
    sig = np.sin(2 * math.pi * np.cumsum(f) / SR) * np.exp(-t * 9)
    click = rng.standard_normal(int(0.008 * SR)) * np.linspace(1, 0, int(0.008 * SR))
    sig[:len(click)] += 0.5 * click
    add(np.tanh(sig * 1.6), t0, gain, bus=drums)
    kick_times.append(t0)


def snare(t0, gain=0.8):
    n = int(0.22 * SR)
    t = tsec(n)
    body = np.sin(2 * math.pi * 185 * t) * np.exp(-t * 30)
    noise = highpass(rng.standard_normal(n), 4) * np.exp(-t * 16)
    sig = 0.5 * body + noise / (np.max(np.abs(noise)) + 1e-9)
    add(sig, t0, gain, bus=drums)


def clap(t0, gain=0.7):
    n = int(0.25 * SR)
    t = tsec(n)
    sig = np.zeros(n)
    for d in (0.0, 0.011, 0.022):
        i = int(d * SR)
        burst = highpass(rng.standard_normal(n - i), 5) * np.exp(-(t[:n - i]) * 22)
        sig[i:] += burst
    add(sig / (np.max(np.abs(sig)) + 1e-9), t0, gain, bus=drums)


def hat(t0, gain=0.25, open_=False):
    n = int((0.28 if open_ else 0.05) * SR)
    t = tsec(n)
    sig = highpass(rng.standard_normal(n), 3) * np.exp(-t * (9 if open_ else 70))
    add(sig / (np.max(np.abs(sig)) + 1e-9), t0, gain, pan=0.25, bus=drums)


def crash(t0, gain=0.5):
    n = int(1.8 * SR)
    t = tsec(n)
    sig = highpass(rng.standard_normal(n), 3) * np.exp(-t * 2.2)
    add(sig / (np.max(np.abs(sig)) + 1e-9), t0, gain, bus=drums)


# ------------------------------------------------------------------ tonal instruments
def bass(t0, midi, dur, gain=0.6):
    n = int((dur + 0.05) * SR)
    t = tsec(n)
    f = note(midi)
    sig = 0.9 * np.sin(2 * math.pi * f * t)  # sub
    bright = np.exp(-t * 7)                   # filter closes over the note
    for h in range(2, 11):
        sig += (1.0 / h) * bright * np.sin(2 * math.pi * f * h * t)
    sig *= env_adsr(n, 0.004, 0.08, 0.6, 0.04)
    add(np.tanh(sig * 1.4), t0, gain)


def pluck(t0, midi, gain=0.2, pan=0.0):
    n = int(0.45 * SR)
    t = tsec(n)
    f = note(midi)
    sig = np.sin(2 * math.pi * f * t) * np.exp(-t * 7)
    bright = np.exp(-t * 18)
    for h in range(2, 8):
        sig += (0.6 / h) * bright * np.sin(2 * math.pi * f * h * t)
    add(sig, t0, gain, pan)


def stab(t0, midis, gain=0.35, dur=0.16):
    n = int((dur + 0.08) * SR)
    t = tsec(n)
    sig = np.zeros((n, 2))
    for m in midis:
        f = note(m)
        for ch, det in enumerate((-0.004, 0.004)):
            for h in range(1, 7):
                sig[:, ch] += (1.0 / h) * np.sin(2 * math.pi * f * (1 + det) * h * t)
    sig *= env_adsr(n, 0.004, dur, 0.0, 0.05)[:, None]
    add(sig / (np.max(np.abs(sig)) + 1e-9), t0, gain)


def pad(midi_notes, start, end, gain=1.0, attack=0.8, release=1.2):
    n = int((end - start + release) * SR)
    t = tsec(n)
    out = np.zeros((n, 2))
    for m in midi_notes:
        f = note(m)
        vib = 1 + 0.0015 * np.sin(2 * math.pi * 0.3 * t + rng.uniform(0, 6))
        for ch, det in enumerate((-0.0015, 0.0015)):
            sig = np.zeros(n)
            for h in range(1, 7):
                sig += (math.exp(-0.5 * (h - 1)) / h) * np.sin(2 * math.pi * f * (1 + det) * h * vib * t + rng.uniform(0, 6))
            out[:, ch] += sig
    out *= env_adsr(n, attack, 0, 1.0, release)[:, None]
    add(out, start, gain / max(1, len(midi_notes)) * 0.5)


def riser(t0, dur, gain=0.35):
    n = int(dur * SR)
    t = tsec(n)
    noise = rng.standard_normal(n)
    smooth = np.convolve(noise, np.ones(40) / 40, mode='same')
    sig = (smooth * (1 - t / dur) + (noise - smooth) * (t / dur)) * (t / dur) ** 2
    f = 160 * 2 ** (t / dur * 2.6)
    sig += 0.5 * np.sin(2 * math.pi * np.cumsum(f) / SR) * (t / dur) ** 2
    add(sig / (np.max(np.abs(sig)) + 1e-9), t0, gain, bus=sfx)


def impact(t0, gain=1.0):
    """Checkmate hit: sub boom + noise crack + saw stab + long shimmer tail."""
    n = int(1.3 * SR)
    t = tsec(n)
    f = 34 + 110 * np.exp(-t * 14)
    boom = np.sin(2 * math.pi * np.cumsum(f) / SR) * np.exp(-t * 3.2)
    add(np.tanh(boom * 1.5), t0, 1.0 * gain, bus=sfx)
    m = int(0.3 * SR)
    crack = rng.standard_normal(m) * np.exp(-tsec(m) * 24)
    add(crack / (np.max(np.abs(crack)) + 1e-9), t0, 0.45 * gain, bus=sfx)
    k = int(2.8 * SR)
    tt = tsec(k)
    st = np.zeros((k, 2))
    for midi in (45, 52, 57, 60, 64, 69):
        f = note(midi)
        for ch, det in enumerate((-0.004, 0.004)):
            for h in range(1, 10):
                st[:, ch] += (1.0 / h) * np.sin(2 * math.pi * f * (1 + det) * h * tt)
    st *= (np.exp(-tt * 1.4))[:, None]
    add(st / (np.max(np.abs(st)) + 1e-9), t0, 0.5 * gain, bus=sfx)
    s = int(3.5 * SR)
    ts = tsec(s)
    shimmer = np.zeros(s)
    for f in (note(81), note(88), note(93), note(100)):
        shimmer += np.sin(2 * math.pi * f * ts * (1 + 0.002 * np.sin(2 * math.pi * 5 * ts))) * np.exp(-ts * 1.1)
    add(shimmer / 4, t0 + 0.05, 0.22 * gain, bus=sfx)


# ------------------------------------------------------------------ chess & UI effects
def thud(t0, gain=0.35):
    n = int(0.22 * SR)
    t = tsec(n)
    sig = np.sin(2 * math.pi * 118 * t) * np.exp(-t * 22) + 0.3 * rng.standard_normal(n) * np.exp(-t * 60)
    add(sig, t0, gain, bus=sfx)


def whoosh(t0, dur=0.32, gain=0.35):
    n = int(dur * SR)
    t = tsec(n)
    noise = rng.standard_normal(n)
    smooth = np.convolve(noise, np.ones(24) / 24, mode='same')
    bright = noise - smooth
    sig = (smooth * (1 - t / dur) + bright * (t / dur)) * np.sin(math.pi * t / dur) ** 1.5
    add(sig, t0, gain, pan=rng.uniform(-0.3, 0.3), bus=sfx)


def shatter(t0, gain=0.9):
    """Glass/stone shatter: low thud + noise burst + a cloud of bright decaying clinks."""
    thud(t0, 0.9)
    n = int(0.45 * SR)
    t = tsec(n)
    burst = highpass(rng.standard_normal(n) * np.exp(-t * 16), 6)
    add(burst / (np.max(np.abs(burst)) + 1e-9), t0, 0.55 * gain, bus=sfx)
    for _ in range(26):
        f = rng.uniform(1800, 7600)
        dt = rng.uniform(0, 0.33)
        m = int(rng.uniform(0.08, 0.35) * SR)
        tt = tsec(m)
        clink = np.sin(2 * math.pi * f * tt) * np.exp(-tt * rng.uniform(14, 30)) * (1 + 0.3 * np.sin(2 * math.pi * f * 1.5 * tt))
        add(clink, t0 + dt, 0.07 * gain, pan=rng.uniform(-0.8, 0.8), bus=sfx)


def ding(t0, f=880.0, gain=0.25, dur=0.6):
    n = int(dur * SR)
    t = tsec(n)
    sig = np.sin(2 * math.pi * f * t * (1 + 0.01 * np.exp(-t * 30))) * np.exp(-t * 7)
    sig *= env_adsr(n, 0.004, 0, 1, 0.1)
    add(sig, t0, gain, bus=sfx)


def chime(t0, gain=0.3):
    for i, midi in enumerate((88, 93, 100)):
        n = int(1.6 * SR)
        t = tsec(n)
        sig = np.sin(2 * math.pi * note(midi) * t) * np.exp(-t * 2.2)
        add(sig, t0 + i * 0.07, gain * 0.5, pan=(i - 1) * 0.5, bus=sfx)


# ------------------------------------------------------------------ timeline from the recording log
moves = [e for e in events if e['name'] == 'move']
impacts = [e['t'] for e in events if e['name'] == 'impact']
mate_t = next(e['t'] for e in events if e['name'] == 'mate')
play_start = moves[0]['t'] if moves else 4.0
FEAT = 20.3          # features card
OUTRO = 27.0
END = DUR - 1.0      # music fade starts here

BPM = 128
B = 60.0 / BPM       # one beat
S16 = B / 4

# Chords: (name, pad notes, bass root midi, arp notes)
CH = {
    'Am': ([45, 57, 60, 64, 69], 33, [69, 72, 76, 81]),
    'F':  ([41, 53, 57, 60, 65], 29, [65, 69, 72, 77]),
    'C':  ([36, 48, 52, 55, 60], 36, [72, 76, 79, 84]),
    'G':  ([43, 55, 59, 62, 67], 31, [67, 71, 74, 79]),
    'E':  ([40, 52, 56, 59, 64], 40, [64, 68, 71, 76]),
}
BAR = 4 * B


def bars(start, end, progression):
    """Yield (bar_start, chord) for consecutive bars from start until end."""
    t = start
    i = 0
    while t < end - 1e-6:
        yield t, progression[i % len(progression)]
        t += BAR
        i += 1


def groove(start, end, progression, intensity=1.0, stabs=False, hats16=False):
    for b0, ch in bars(start, end, progression):
        padn, root, arp = CH[ch]
        pad(padn, b0, min(b0 + BAR, end), 0.55, attack=0.05, release=0.3)
        for k in range(4):
            tb = b0 + k * B
            if tb >= end:
                break
            kick(tb, 1.0 * intensity)
            if k in (1, 3):
                clap(tb, 0.65 * intensity)
                snare(tb, 0.35 * intensity)
            for e in range(2 if not hats16 else 4):
                th = tb + e * (B / (2 if not hats16 else 4))
                if th < end:
                    hat(th, (0.16 if e == 0 else 0.26) * intensity, open_=(k == 3 and e == (1 if not hats16 else 2)))
            # bass on 8ths: low, low, octave-up pattern
            for e, m in enumerate((root, root, root + 12, root)):
                tb8 = tb + e * (B / 4)
                if e % 2 == 0 and tb8 < end:
                    bass(tb8, m if e < 2 else root + 12, B / 4 * 0.9, 0.55 * intensity)
            if stabs and k in (0, 2):
                stab(tb + B / 2, [n + 12 for n in padn[1:4]], 0.3)
        # arpeggio on 16ths, up-down, with a dotted-eighth echo
        pat = [0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 1, 0, 1, 2, 3]
        for s in range(16):
            ts = b0 + s * S16
            if ts >= end:
                break
            pluck(ts, arp[pat[s]], 0.17 * intensity, pan=math.sin(s * 0.9) * 0.6)
            pluck(ts + 3 * S16, arp[pat[s]], 0.06 * intensity, pan=-math.sin(s * 0.9) * 0.6)


# Intro: pulsing bed, hats and a swell into the first beat
pad(CH['Am'][0], 0.0, play_start, 0.9, attack=1.2, release=0.4)
t = 0.0
while t < play_start - 0.1:
    bass(t, 33, B / 4 * 0.9, 0.35)
    hat(t + B / 4, 0.12)
    t += B / 2
riser(play_start - 1.6, 1.6, 0.3)

# Opening moves: full groove
crash(play_start, 0.5)
groove(play_start, impacts[0] - 0.02, ['Am', 'F', 'C', 'G'])

# Captures: more intensity, 16th hats, then build-up into the mate
crash(impacts[0], 0.45)
build_start = mate_t - 1.95
groove(impacts[0] - 0.02, build_start, ['Am', 'F', 'E', 'E'], intensity=1.05, hats16=True)
pad(CH['E'][0], build_start, mate_t, 0.8, attack=0.05, release=0.1)
tb = build_start
step = B / 2
while tb < mate_t - 0.12:
    snare(tb, 0.55 + 0.4 * (tb - build_start) / (mate_t - build_start))
    kick(tb, 0.8)
    tb += step
    if tb > build_start + 0.9:
        step = B / 4
riser(build_start, mate_t - build_start, 0.5)

# Checkmate: everything stops, impact, pad swell under the word
impact(mate_t, 1.0)
pad(CH['Am'][0], mate_t + 0.1, FEAT, 0.9, attack=0.3, release=0.3)

# Drop: features and outro ride the groove with stabs, then fade
crash(FEAT, 0.5)
groove(FEAT, OUTRO, ['Am', 'F', 'C', 'G'], intensity=1.0, stabs=True)
groove(OUTRO, END, ['Am', 'F', 'C', 'G'], intensity=0.9)

# chess SFX: stone thuds per move, whoosh then shatter per capture
for m in moves:
    if m['san'].endswith('#'):
        continue
    if 'x' in m['san']:
        whoosh(m['t'] + 0.15, 0.42, 0.45)
    else:
        thud(m['t'], 0.3)
        whoosh(m['t'] + 0.02, 0.26, 0.12)
for ti in impacts:
    shatter(ti, 1.0)

# UI: one in-key ding per feature row, whoosh + chime for the outro card
for i, f in enumerate((880.0, 1046.5, 1318.5, 1760.0)):
    ding(FEAT + 0.55 + i * 0.22, f, 0.2, 0.5)
whoosh(OUTRO, 0.5, 0.4)
chime(OUTRO + 0.75, 0.32)

# ------------------------------------------------------------------ side-chain: the music bus ducks on every kick
sc = np.ones(N)
win = int(0.3 * SR)
curve = 1 - 0.55 * np.exp(-tsec(win) * 12)
for kt in kick_times:
    i = int(kt * SR)
    if i < N:
        n = min(win, N - i)
        sc[i:i + n] *= curve[:n]
music *= sc[:, None]

# ------------------------------------------------------------------ voiceover (no line over the outro card)
EXT = os.environ.get('VO_EXT', 'mp3')
VO = [('vo1.' + EXT, 0.6), ('vo2.' + EXT, 4.2), ('vo3.' + EXT, 11.0), ('vo4.' + EXT, mate_t + 0.15), ('vo5.' + EXT, 20.4)]
duck = np.ones(N)
vo_bus = np.zeros((N, 2))
for fname, t0 in VO:
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', fname, '-ac', '1', '-ar', str(SR), '-f', 's16le', '-'], capture_output=True, check=True).stdout
    sig = np.frombuffer(raw, dtype=np.int16).astype(np.float64) / 32768.0
    sig = sig / (np.max(np.abs(sig)) + 1e-9) * 0.9
    i0 = int(t0 * SR)
    n = min(len(sig), N - i0)
    vo_bus[i0:i0 + n, 0] += sig[:n]
    vo_bus[i0:i0 + n, 1] += sig[:n]
    r = int(0.25 * SR)
    a, b = max(0, i0 - r), min(N, i0 + n + r)
    duck[a:b] = np.minimum(duck[a:b], 0.45)
    duck[a:a + r] = np.minimum(duck[a:a + r], np.linspace(1, 0.45, r))
    duck[b - r:b] = np.minimum(duck[b - r:b], np.linspace(0.45, 1, r))

# ------------------------------------------------------------------ master
def norm(x):
    return x / (np.max(np.abs(x)) + 1e-9)

bed = norm(music) * 0.55 + norm(drums) * 0.6
master = bed * duck[:, None] * 0.75 + norm(sfx) * 0.8 + vo_bus * 0.95
fade = np.ones(N)
fn = int(1.0 * SR)
fade[-fn:] = np.linspace(1, 0, fn)
master *= fade[:, None]
master = np.tanh(master * 1.2) / math.tanh(1.2)
master = norm(master) * 0.95

with wave.open(OUT, 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((master * 32767).astype(np.int16).tobytes())
print('wrote', OUT, f'{DUR:.2f}s', 'kicks', len(kick_times), 'impacts', impacts, 'mate', mate_t)
