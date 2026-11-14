#!/usr/bin/env node
/**
 * make-ambient.mjs — regenerates assets/ambient/*.m4a (nature-sound loops that
 * play softly under recitation videos).  No network, no dependencies besides
 * Node 22 and the ffmpeg binary shipped by `ffmpeg-static`.
 *
 *   node scripts/make-ambient.mjs                 build all nine loops
 *   node scripts/make-ambient.mjs rain stream     build only the named ids
 *   node scripts/make-ambient.mjs --verify        measure the committed files
 *                                                 (duration, level, peak, loop
 *                                                 seam, band energies); builds nothing
 *
 * WHY THESE CHOICES
 *  - Mixed sourcing (owner's decision).  Seven sounds are synthesized from
 *    seeded noise with ffmpeg filters, so they are original work with no
 *    third-party rights and the script reproduces them bit-for-bit (fixed
 *    seeds, no wall-clock input; a different ffmpeg build can differ in the
 *    last bits).  Two ingredients come from recordings whose licence was
 *    checked on the source page: the cricket chorus (CC0, OpenGameArt) and
 *    the distant thunder in `rain-thunder` (public domain, Wikimedia
 *    Commons).  Source clips live in assets/ambient/source/ so no download
 *    is needed here; provenance is in assets/ambient/SOURCES.md.
 *  - 120 s, stereo, 44.1 kHz, AAC-LC ~96 kb/s (ffmpeg's native `aac` encoder,
 *    no metadata, bit-exact flags).  Peak is set to -3 dBFS only so that the
 *    files are not quiet by accident; the app measures loudness itself.
 *  - Seamless looping.  Every bed is rendered 4 s longer than needed and the
 *    surplus tail is folded into the head with an equal-power (quarter-sine)
 *    crossfade, so the last sample is followed by the exact continuation of
 *    the signal.  That is correct for noise-like material because the tail
 *    and head are statistically independent (equal power in = equal power
 *    out).  Anything coherent would bump +3 dB in such a crossfade, so there
 *    are no pure tones in the beds, and every slow modulation uses
 *    frequencies that are integer multiples of 1/120 Hz: its value at the
 *    seam is identical on both sides, while the noise it modulates never
 *    repeats.  Thunder events are mixed in after the fold, well inside the
 *    file, and decay to silence before the end.
 *  - Stereo image: each channel gets its own noise seeds (decorrelated);
 *    modulation phases differ per channel.
 *  - Event sounds (raindrops, crackles, pops) are noise bursts: sparse
 *    random impulses (anoisesrc velvet) -> one-pole decay -> multiplied with
 *    band-limited noise.  Rates are modulated slowly so they cluster.
 *  - No music, no voices, no animals except insects.  The cricket clip is
 *    band-passed to ~2.9-4.0 kHz where the chirps live (this also removes a
 *    ~2.2 kHz tone and a ~5 kHz cloud of unidentified origin, each lasting a
 *    couple of seconds, that are visible in the raw recording) and the thunder
 *    clip is low-passed below ~230 Hz, which also removes anything that is
 *    not low rumble.
 *  I could not listen to the results; tuning was done with spectra,
 *  spectrograms and level measurements only.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const FFMPEG = require('ffmpeg-static');
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets', 'ambient');
const SRC = join(OUT, 'source');

const SR = 44100;
// The loop is a whole number of AAC frames (1024 samples) long, i.e. 120.0007 s.
// Then the encoder adds no zero padding at the end (padding would decode as a
// ~1 ms hole at the seam in decoders that ignore the MP4 edit-list duration,
// ffmpeg included) and the decoded length is exactly the loop length.
const LOOP_SAMPLES = 5168 * 1024;
const LOOP = LOOP_SAMPLES / SR; // seconds; also the period of the slow modulations
const XF = 4; // seconds of surplus folded into the head
const DUR = LOOP + XF + 0.05; // rendered length of a bed (a little extra, trimmed by sample)
const PEAK_DB = -3.4; // encoder overshoot brings the decoded peak to about -3 dBFS
const BITRATE = '96k';

const IDS = ['rain', 'rain-thunder', 'rain-window', 'stream', 'campfire', 'crickets', 'wind', 'ocean', 'night-hum'];

// ---------------------------------------------------------------- utilities

function ffmpeg(args, { capture = false } = {}) {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-v', capture ? 'info' : 'error', '-nostdin', '-y', ...args], {
    maxBuffer: 1 << 30,
    encoding: capture ? 'utf8' : 'buffer'
  });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${(r.stderr || '').toString().slice(-2000)}`);
  return r;
}

/** Deterministic PRNG (mulberry32) for modulation phases. */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tiny filtergraph builder: every node gets a fresh label. */
class Graph {
  constructor() {
    this.lines = [];
    this.n = 0;
  }
  label() {
    return `n${this.n++}`;
  }
  src(spec) {
    const o = this.label();
    this.lines.push(`${spec}[${o}]`);
    return o;
  }
  f(ins, spec) {
    const o = this.label();
    this.lines.push(`${[].concat(ins).map((i) => `[${i}]`).join('')}${spec}[${o}]`);
    return o;
  }
  text() {
    return this.lines.join(';');
  }
}

const noise = (g, color, seed, amp = 1) => g.src(`anoisesrc=c=${color}:s=${seed}:r=${SR}:d=${DUR}:a=${amp}`);
const vol = (g, x, v) => g.f(x, `volume=${v}`);
const mix = (g, parts) =>
  g.f(
    parts.map((p) => p[0]),
    `amix=inputs=${parts.length}:normalize=0:duration=longest:weights='${parts.map((p) => p[1]).join(' ')}'`
  );

/**
 * Slow gain curve: base + sum(amp*sin(2*pi*k/120*t + phase)).  k is an integer
 * so the curve is exactly periodic over the loop length (see header).
 */
function curve(rng, base, terms, min = 0.02) {
  const s = terms.map(([k, a]) => `${a}*sin(2*PI*${k}/${LOOP}*t+${(rng() * 2 * Math.PI).toFixed(3)})`).join('+');
  return `max(${min},${base}+${s})`;
}
const slow = (g, x, expr) => g.f(x, `volume='${expr}':eval=frame`);

/** Band-limited noise: color noise -> highpass -> lowpass. */
function band(g, color, seed, hp, lp, amp = 1) {
  const chain = [];
  if (hp) chain.push(`highpass=f=${hp}:p=2`);
  if (lp) chain.push(`lowpass=f=${lp}:p=2`);
  return g.f(noise(g, color, seed, amp), chain.join(','));
}

/**
 * Random noise envelope in (0, ~2): mean + std * slowly varying Gaussian-ish
 * noise, low-passed at fc Hz.  `std`/`mean` are in linear gain.
 */
function envNoise(g, seed, fc, mean, std, power = 1) {
  const enbw = 1.11 * fc; // 2-pole Butterworth noise bandwidth
  const rmsIn = 0.577 * Math.sqrt(enbw / (SR / 2));
  const k = (std / rmsIn).toFixed(2);
  const x = g.f(noise(g, 'white', seed), `lowpass=f=${fc}:p=2`);
  const e = g.f(x, `aeval='pow(clip(${mean}+${k}*val(0),0.01,2.5),${power})':c=same`);
  return e;
}

/**
 * Event sounds: sparse random impulses -> one-pole decay (tauHz) -> times a
 * band-limited noise carrier.  `density` is impulses/sample, `skew` > 1 makes
 * most events quiet, `gate` is an optional expression in t scaling the rate
 * (loudness) of events, `gain` is the peak envelope relative to the carrier.
 */
function bursts(g, { seed, density, skew, tauHz, carrier, gain, gate }) {
  const v = g.src(`anoisesrc=c=velvet:s=${seed}:r=${SR}:d=${DUR}:density=${density}:a=1`);
  const amp = noise(g, 'white', seed + 1);
  const m = g.f([v, amp], 'amultiply');
  const norm = SR / (2 * Math.PI * tauHz);
  const shaped = g.f(
    m,
    `aeval='sgn(val(0))*pow(abs(val(0)),${skew})*${(gain * norm).toFixed(3)}${gate ? `*${gate}` : ''}':c=same`
  );
  const env = g.f(shaped, `lowpass=f=${tauHz}:p=1`);
  return g.f([env, carrier], 'amultiply');
}

const stereo = (g, l, r) => g.f([l, r], 'join=inputs=2:channel_layout=stereo:map=0.0-FL|1.0-FR');

/** Builds a bed: build(g, ch, rng) returns a mono label; result is stereo. */
function bed(index, build) {
  const g = new Graph();
  const chans = [0, 1].map((ch) => build(g, ch, prng(0xa11ce + index * 131 + ch * 7919)));
  const out = g.f(stereo(g, chans[0], chans[1]), 'highpass=f=22:p=2');
  return { text: g.text(), out };
}

// ------------------------------------------------------------- the recipes

const sd = (id, ch, n) => 1000 * (IDS.indexOf(id) + 1) + 100 * n + 5000 * ch + 17;

function rainBed(g, ch, rng) {
  const id = 'rain';
  const S = (n) => sd(id, ch, n);
  const body = slow(g, vol(g, band(g, 'white', S(1), 300, 2800), 0.5), curve(rng, 1, [[5, 0.14], [13, 0.1], [29, 0.05]]));
  const hiss = slow(g, vol(g, band(g, 'white', S(2), 2500, 11000), 0.3), curve(rng, 1, [[7, 0.12], [17, 0.09], [37, 0.05]]));
  const rumble = slow(g, vol(g, g.f(noise(g, 'pink', S(3)), 'lowpass=f=220:p=2'), 0.5), curve(rng, 1, [[3, 0.2], [11, 0.1]]));
  const gate1 = curve(rng, 1, [[9, 0.35], [23, 0.2]], 0.2);
  const drops1 = bursts(g, {
    seed: S(4), density: 0.0009, skew: 2, tauHz: 150, gain: 1.7, gate: gate1,
    carrier: band(g, 'white', S(5), 2500, 9000)
  });
  const drops2 = bursts(g, {
    seed: S(6), density: 0.00025, skew: 1.5, tauHz: 80, gain: 1.5, gate: curve(rng, 1, [[6, 0.4], [19, 0.2]], 0.2),
    carrier: band(g, 'white', S(7), 1400, 4500)
  });
  return mix(g, [[body, 1], [hiss, 1], [rumble, 1], [drops1, 1], [drops2, 0.8]]);
}

function rainWindowBed(g, ch, rng) {
  const id = 'rain-window';
  const S = (n) => sd(id, ch, n);
  const body = slow(g, vol(g, band(g, 'pink', S(1), 180, 3600), 1.1), curve(rng, 1, [[4, 0.12], [11, 0.1], [31, 0.04]]));
  const hush = slow(g, vol(g, band(g, 'white', S(2), 1200, 5200), 0.12), curve(rng, 1, [[8, 0.15], [21, 0.1]]));
  const room = slow(g, vol(g, g.f(noise(g, 'brown', S(3)), 'lowpass=f=140:p=2'), 0.3), curve(rng, 1, [[2, 0.15], [7, 0.1]]));
  // individual drops on glass: short ticks, a few resonant taps, rarer heavy thuds
  const ticks = bursts(g, {
    seed: S(4), density: 0.00018, skew: 1.3, tauHz: 45, gain: 2.0,
    gate: curve(rng, 1, [[5, 0.4], [14, 0.25]], 0.25),
    carrier: g.f(noise(g, 'white', S(5)), 'bandpass=f=2100:t=q:w=1.4')
  });
  const taps = bursts(g, {
    seed: S(6), density: 0.00007, skew: 1.2, tauHz: 28, gain: 2.2,
    gate: curve(rng, 1, [[3, 0.4], [10, 0.3]], 0.25),
    carrier: g.f(noise(g, 'white', S(7)), 'bandpass=f=1100:t=q:w=3')
  });
  const thuds = bursts(g, {
    seed: S(8), density: 0.00003, skew: 1, tauHz: 20, gain: 1.8,
    gate: curve(rng, 1, [[4, 0.4], [13, 0.2]], 0.25),
    carrier: g.f(noise(g, 'pink', S(9)), 'bandpass=f=380:t=q:w=2')
  });
  return mix(g, [[body, 1], [hush, 1], [room, 1], [ticks, 1], [taps, 0.9], [thuds, 0.8]]);
}

function streamBed(g, ch, rng) {
  const id = 'stream';
  const S = (n) => sd(id, ch, n);
  const base = slow(g, vol(g, band(g, 'pink', S(1), 260, 7500), 1.0), curve(rng, 1, [[4, 0.08], [15, 0.06]]));
  const fcs = [380, 560, 800, 1150, 1650, 2400, 3400];
  const parts = [[base, 1]];
  fcs.forEach((fc, i) => {
    const carrier = g.f(noise(g, 'pink', S(10 + i)), `bandpass=f=${fc}:t=q:w=3.5`);
    const env = envNoise(g, S(30 + i), 4.5 + i * 1.3, 0.55, 0.38, 1.6);
    const gl = g.f([carrier, env], 'amultiply');
    parts.push([vol(g, gl, (2.6 + i * 0.12).toFixed(2)), 1]);
  });
  // quick small bubbles on top
  parts.push([
    bursts(g, {
      seed: S(60), density: 0.0003, skew: 1.5, tauHz: 90, gain: 2.0,
      gate: curve(rng, 1, [[7, 0.4], [19, 0.2]], 0.3),
      carrier: g.f(noise(g, 'white', S(61)), 'bandpass=f=2800:t=q:w=1.2')
    }),
    0.7
  ]);
  return mix(g, parts);
}

function campfireBed(g, ch, rng) {
  const id = 'campfire';
  const S = (n) => sd(id, ch, n);
  const rumble = slow(g, vol(g, g.f(noise(g, 'brown', S(1)), 'lowpass=f=170:p=2'), 0.8), curve(rng, 1, [[3, 0.18], [9, 0.12], [27, 0.06]]));
  const roarCarrier = g.f(noise(g, 'pink', S(2)), 'highpass=f=120:p=2,lowpass=f=700:p=2');
  const roar = g.f([vol(g, roarCarrier, 0.8), envNoise(g, S(3), 2.2, 0.7, 0.35, 1.3)], 'amultiply');
  const hiss = g.f([vol(g, band(g, 'white', S(4), 5000, 12000), 0.14), envNoise(g, S(5), 7, 0.6, 0.4, 1.5)], 'amultiply');
  const cluster = (extra) => curve(rng, 0.8, [[5, 0.5], [13, 0.35], [31, 0.2], ...extra], 0.05);
  const crackles = bursts(g, {
    seed: S(6), density: 0.0014, skew: 2.6, tauHz: 90, gain: 3.0, gate: cluster([]),
    carrier: band(g, 'white', S(7), 900, 7500)
  });
  const snaps = bursts(g, {
    seed: S(8), density: 0.0004, skew: 2.2, tauHz: 220, gain: 2.2, gate: cluster([[17, 0.2]]),
    carrier: band(g, 'white', S(9), 2500, 11000)
  });
  const pops = bursts(g, {
    seed: S(10), density: 0.00007, skew: 1.2, tauHz: 38, gain: 2.2, gate: cluster([]),
    carrier: g.f(noise(g, 'pink', S(11)), 'bandpass=f=1100:t=q:w=1.3')
  });
  const thumps = bursts(g, {
    seed: S(12), density: 0.00002, skew: 1, tauHz: 14, gain: 1.4, gate: cluster([]),
    carrier: g.f(noise(g, 'pink', S(13)), 'highpass=f=80:p=2,lowpass=f=420:p=2')
  });
  return mix(g, [[rumble, 1], [roar, 1], [hiss, 1], [crackles, 1], [snaps, 0.8], [pops, 1], [thumps, 1]]);
}

function windBed(g, ch, rng) {
  const id = 'wind';
  const S = (n) => sd(id, ch, n);
  const swell = () => curve(rng, 0.5, [[2, 0.14], [3, 0.26], [5, 0.16], [7, 0.2], [11, 0.1], [17, 0.06]], 0.03);
  // one swell curve per channel is shared by all bands so the bands rise together
  const e = swell();
  const e2 = `pow(${e},2)`;
  const e3 = `pow(${e},3)`;
  const low = slow(g, vol(g, g.f(noise(g, 'pink', S(1)), 'bandpass=f=170:t=q:w=0.7'), 2.4), e);
  const mid = slow(g, vol(g, g.f(noise(g, 'pink', S(2)), 'bandpass=f=470:t=q:w=0.8'), 2.2), e2);
  const hi = slow(g, vol(g, g.f(noise(g, 'pink', S(3)), 'bandpass=f=1150:t=q:w=1'), 2.6), e3);
  const whistle = slow(g, vol(g, g.f(noise(g, 'pink', S(4)), 'bandpass=f=830:t=q:w=14'), 1.6), `${e3}*${curve(rng, 0.7, [[5, 0.3], [13, 0.2]], 0.1)}`);
  const air = vol(g, band(g, 'pink', S(5), 90, 2400), 0.25);
  return mix(g, [[low, 1], [mid, 1], [hi, 1], [whistle, 0.6], [air, 1]]);
}

function oceanBed(g, ch, rng) {
  const id = 'ocean';
  const S = (n) => sd(id, ch, n);
  const ph = [rng() * 6.283, rng() * 6.283, rng() * 6.283];
  const wave = (delay) =>
    `pow(clip(0.5+0.5*(0.55*sin(2*PI*10/${LOOP}*t+${(ph[0] - delay).toFixed(3)})+0.3*sin(2*PI*17/${LOOP}*t+${(ph[1] - delay * 1.4).toFixed(3)})+0.15*sin(2*PI*23/${LOOP}*t+${(ph[2] - delay * 1.8).toFixed(3)})),0,1),2)`;
  const body = slow(g, vol(g, g.f(noise(g, 'brown', S(1)), 'lowpass=f=420:p=2'), 1.5), `0.18+0.95*${wave(0)}`);
  const mid = slow(g, vol(g, band(g, 'pink', S(2), 120, 1100), 0.9), `0.1+0.9*${wave(0.5)}`);
  const foamCarrier = g.f(noise(g, 'white', S(3)), 'highpass=f=700:p=2,lowpass=f=4200:p=2');
  const foam = slow(g, g.f([vol(g, foamCarrier, 0.55), envNoise(g, S(4), 14, 0.7, 0.3, 1.4)], 'amultiply'), `0.04+pow(${wave(1.6)},1.4)`);
  const floor = vol(g, band(g, 'pink', S(5), 40, 300), 0.5);
  return mix(g, [[body, 1], [mid, 1], [foam, 1], [floor, 1]]);
}

function nightHumBed(g, ch, rng) {
  const id = 'night-hum';
  const S = (n) => sd(id, ch, n);
  const brown = slow(g, vol(g, g.f(noise(g, 'brown', S(1)), 'lowpass=f=260:p=2,lowpass=f=360:p=1'), 2.0), curve(rng, 1, [[2, 0.07], [5, 0.05], [13, 0.03]]));
  const air = slow(g, vol(g, band(g, 'pink', S(2), 60, 1400), 0.32), curve(rng, 1, [[3, 0.12], [8, 0.08]]));
  const modes = [55, 110, 165].map((f, i) =>
    slow(g, vol(g, g.f(noise(g, 'pink', S(3 + i)), `bandpass=f=${f}:t=q:w=10`), (5.5 - i).toFixed(2)), curve(rng, 1, [[4 + i, 0.3], [9 + i, 0.15]], 0.15))
  );
  return mix(g, [[brown, 1], [air, 1], ...modes.map((m) => [m, 0.6])]);
}

const SYNTH = {
  rain: rainBed,
  'rain-thunder': rainBed, // the same bed; thunder is added after the loop is closed
  'rain-window': rainWindowBed,
  stream: streamBed,
  campfire: campfireBed,
  wind: windBed,
  ocean: oceanBed,
  'night-hum': nightHumBed
};

// --------------------------------------------------- recorded ingredients

/** Distant thunder from the public-domain recording (low-passed rolls). */
const THUNDER_SRC = join(SRC, 'thunder-tonitrus-mysid-pd.ogg');
const THUNDER_EVENTS = [
  // at: seconds in the loop; ss/len: slice of the recording; rate: pitch/speed; gain: linear
  { at: 12, ss: 0.8, len: 11.5, rate: 1.0, gain: 1.0 },
  { at: 44, ss: 11.4, len: 10.5, rate: 0.93, gain: 1.25 },
  { at: 71, ss: 20.5, len: 11.0, rate: 1.06, gain: 0.8 },
  { at: 98, ss: 1.4, len: 11.0, rate: 0.88, gain: 1.1 }
];
const THUNDER_LEVEL = 2.0;

function thunderGraph(bedLabel) {
  const n = THUNDER_EVENTS.length;
  const tags = THUNDER_EVENTS.map((_, i) => `th${i}`);
  const lines = [`[2:a]asplit=${n}${tags.map((t) => `[${t}]`).join('')}`];
  const outs = THUNDER_EVENTS.map((e, i) => {
    const d = e.len / e.rate;
    const fo = Math.min(4.5, d * 0.45);
    const chain = [
      `atrim=start=${e.ss}:end=${e.ss + e.len}`,
      'asetpts=PTS-STARTPTS',
      `asetrate=${Math.round(SR * e.rate)}`,
      `aresample=${SR}`,
      'lowpass=f=230:p=2,lowpass=f=230:p=2,highpass=f=25:p=2',
      'afade=t=in:st=0:d=1.6:curve=qsin',
      `afade=t=out:st=${(d - fo).toFixed(2)}:d=${fo.toFixed(2)}:curve=qsin`,
      `volume=${(e.gain * THUNDER_LEVEL).toFixed(3)}`,
      `adelay=${Math.round(e.at * 1000)}:all=1`
    ].join(',');
    lines.push(`[${tags[i]}]${chain}[thx${i}]`);
    return `thx${i}`;
  });
  lines.push(`[${bedLabel}]${outs.map((o) => `[${o}]`).join('')}amix=inputs=${n + 1}:normalize=0:duration=first[thunder_mix]`);
  return { text: lines.join(';'), out: 'thunder_mix' };
}

/** Cricket chorus: four time-/pitch-shifted layers of the CC0 recording. */
const CRICKET_SRC = join(SRC, 'crickets-syncopika-cc0.flac');
const CRICKET_CLIP_SAMPLES = 1699723; // decoded length of the clip (38.5425 s)
const CRICKET_LAYERS = [
  // rate shifts pitch+tempo together; off = start offset in the looped clip (s)
  { rate: 1.08, off: 0, pan: [1.0, 0.35], gain: 1.0 },
  { rate: 1.0, off: 13.7, pan: [0.4, 1.0], gain: 0.85 },
  { rate: 1.15, off: 27.1, pan: [0.8, 0.8], gain: 0.6 },
  { rate: 0.95, off: 6.3, pan: [0.3, 0.7], gain: 0.55 }
];
const CRICKET_XF = 1.5; // self-crossfade that closes the clip's own loop

function cricketGraph() {
  const g = new Graph();
  const rng = prng(0xc41c);
  const n = CRICKET_LAYERS.length;
  const tags = CRICKET_LAYERS.map((_, i) => `cl${i}`);
  // mono mix; notch the ~2.2 kHz tone; keep ~2.9-4.0 kHz where the chirps live
  const prefilter =
    'pan=mono|c0=0.5*c0+0.5*c1,equalizer=f=2200:t=h:w=400:g=-30,equalizer=f=5200:t=h:w=1600:g=-20,highpass=f=2800:p=2,highpass=f=2800:p=2,lowpass=f=4100:p=2,lowpass=f=4100:p=2,lowpass=f=4100:p=2';
  // close the clip's own loop: body = [0, P-X), continuation = [P-X, P).
  // The clip is opened twice (inputs 0 and 1), see loopCloseGraph.
  const xfs = Math.round(CRICKET_XF * SR);
  const body = CRICKET_CLIP_SAMPLES - xfs;
  g.lines.push(`[0:a]${prefilter},atrim=start_sample=${body}:end_sample=${CRICKET_CLIP_SAMPLES},asetpts=N/SR/TB[cont]`);
  g.lines.push(`[1:a]${prefilter},atrim=end_sample=${body},asetpts=N/SR/TB[body]`);
  g.lines.push(`[cont][body]acrossfade=ns=${xfs}:c1=qsin:c2=qsin,asplit=${n}${tags.map((t) => `[${t}]`).join('')}`);
  const lefts = [];
  const rights = [];
  CRICKET_LAYERS.forEach((l, i) => {
    const slowGain = curve(rng, 1, [[4 + i, 0.25], [11 + 2 * i, 0.15]], 0.15);
    g.lines.push(
      `[${tags[i]}]${[
        `aloop=loop=7:size=${body}:start=0`,
        `asetrate=${Math.round(SR * l.rate)}`,
        `aresample=${SR}`,
        `atrim=start=${l.off}:duration=${DUR}`,
        'asetpts=PTS-STARTPTS',
        `volume='${l.gain}*${slowGain}':eval=frame`,
        'asplit=2'
      ].join(',')}[cx${i}a][cx${i}b]`
    );
    lefts.push([g.f(`cx${i}a`, `volume=${l.pan[0]}`), 1]);
    rights.push([g.f(`cx${i}b`, `volume=${l.pan[1]}`), 1]);
  });
  const out = g.f([mix(g, lefts), mix(g, rights)], 'join=inputs=2:channel_layout=stereo:map=0.0-FL|1.0-FR');
  return { text: g.text(), out };
}

// ------------------------------------------------------------------ build

/**
 * Fold the surplus tail into the head: result is exactly LOOP seconds.  The bed
 * is opened twice (inputs 0 and 1) because acrossfade fed from one asplit'ed
 * stream produces nothing.
 */
function loopCloseGraph() {
  const L = LOOP_SAMPLES;
  const C = XF * SR;
  return (
    `[0:a]atrim=start_sample=${L}:end_sample=${L + C},asetpts=N/SR/TB[tail];` +
    `[1:a]atrim=end_sample=${L},asetpts=N/SR/TB[head];` +
    `[tail][head]acrossfade=ns=${C}:c1=qsin:c2=qsin[looped]`
  );
}

function readPcm(file) {
  const b = ffmpeg(['-i', file, '-f', 'f32le', '-ac', '2', '-ar', String(SR), '-']).stdout;
  return new Float32Array(b.buffer, b.byteOffset, b.length >> 2);
}

function peakOf(pcm) {
  let m = 0;
  for (let i = 0; i < pcm.length; i++) {
    const a = Math.abs(pcm[i]);
    if (a > m) m = a;
  }
  return m;
}

/**
 * A loop can start anywhere: pick the quietest moment (smallest max |sample|
 * over +-W samples, both channels) so that the file does not begin or end on
 * a step.  The AAC encoder sees silence before the first sample, and a
 * signal that starts away from zero is coded with a short burst of error.
 */
function quietStart(pcm) {
  const n = pcm.length >> 1;
  const W = 64;
  const e = new Float32Array(n);
  for (let i = 0; i < n; i++) e[i] = Math.max(Math.abs(pcm[2 * i]), Math.abs(pcm[2 * i + 1]));
  const dq = new Int32Array(n);
  let head = 0;
  let tail = 0;
  let best = W;
  let bestV = Infinity;
  for (let i = 0; i < n; i++) {
    while (tail > head && e[dq[tail - 1]] <= e[i]) tail--;
    dq[tail++] = i;
    const c = i - W; // window [c-W, c+W] is complete
    if (c - W >= 0) {
      while (dq[head] < c - W) head++;
      const v = e[dq[head]];
      if (v < bestV) [bestV, best] = [v, c];
    }
  }
  return best;
}

function build(id, tmp) {
  const raw = join(tmp, `${id}.raw.wav`);
  const closed = join(tmp, `${id}.closed.wav`);
  const gfile = join(tmp, `${id}.graph.txt`);

  // 1. render the bed, XF seconds longer than the loop
  const { text, out } = id === 'crickets' ? cricketGraph() : bed(IDS.indexOf(id), SYNTH[id]);
  writeFileSync(gfile, text);
  const inputs = id === 'crickets' ? ['-i', CRICKET_SRC, '-i', CRICKET_SRC] : [];
  ffmpeg([...inputs, '-filter_complex_script', gfile, '-map', `[${out}]`, '-t', String(DUR), '-c:a', 'pcm_f32le', raw]);

  // 2. fold the tail into the head (and add thunder for rain-thunder)
  if (id === 'rain-thunder') {
    const t = thunderGraph('looped');
    writeFileSync(gfile, `${loopCloseGraph()};${t.text}`);
    ffmpeg(['-i', raw, '-i', raw, '-i', THUNDER_SRC, '-filter_complex_script', gfile, '-map', `[${t.out}]`, '-c:a', 'pcm_f32le', closed]);
  } else {
    writeFileSync(gfile, loopCloseGraph());
    ffmpeg(['-i', raw, '-i', raw, '-filter_complex_script', gfile, '-map', '[looped]', '-c:a', 'pcm_f32le', closed]);
  }

  // 3. rotate the loop to its quietest moment, set the peak to -3 dBFS, encode
  const pcm = readPcm(closed);
  if (pcm.length !== 2 * LOOP_SAMPLES) throw new Error(`${id}: loop is ${pcm.length / 2} samples, expected ${LOOP_SAMPLES}`);
  const cut = quietStart(pcm);
  const rotated = join(tmp, `${id}.rot.wav`);
  writeFileSync(
    gfile,
    `[0:a]atrim=start_sample=${cut},asetpts=N/SR/TB[a];[1:a]atrim=end_sample=${cut},asetpts=N/SR/TB[b];[a][b]concat=n=2:v=0:a=1[rot]`
  );
  ffmpeg(['-i', closed, '-i', closed, '-filter_complex_script', gfile, '-map', '[rot]', '-c:a', 'pcm_f32le', rotated]);
  const gainDb = PEAK_DB - 20 * Math.log10(peakOf(pcm));
  const dest = join(OUT, `${id}.m4a`);
  ffmpeg([
    '-i', rotated,
    '-af', `volume=${gainDb.toFixed(3)}dB`,
    '-ac', '2', '-ar', String(SR), '-c:a', 'aac', '-b:a', BITRATE, '-aac_coder', 'twoloop',
    '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact',
    '-movflags', '+faststart', dest
  ]);
  console.log(`${id}.m4a  ${(statSync(dest).size / 1024).toFixed(0)} KiB  gain ${gainDb.toFixed(1)} dB`);
}

// ----------------------------------------------------------------- verify

function decode(file, args = []) {
  const r = ffmpeg(['-i', file, ...args, '-f', 'f32le', '-ac', '2', '-ar', String(SR), '-']);
  const b = r.stdout;
  const f = new Float32Array(b.buffer, b.byteOffset, b.length >> 2);
  const n = f.length >> 1;
  const l = new Float32Array(n);
  const rr = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    l[i] = f[2 * i];
    rr[i] = f[2 * i + 1];
  }
  return { l, r: rr, n };
}

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

const BANDS = [20, 60, 150, 400, 1000, 2500, 4000, 6000, 10000, 16000];

function bandEnergies(x) {
  const N = 8192;
  const acc = new Float64Array(N / 2);
  const w = new Float64Array(N).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  let cnt = 0;
  for (let s = 0; s + N <= x.length; s += N * 2) {
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = x[s + i] * w[i];
    fft(re, im);
    for (let k = 0; k < N / 2; k++) acc[k] += re[k] * re[k] + im[k] * im[k];
    cnt++;
  }
  const df = SR / N;
  let pk = 0;
  let pkf = 0;
  for (let k = Math.ceil(2000 / df); k < N / 2; k++) if (acc[k] > pk) [pk, pkf] = [acc[k], k * df];
  const total = acc.reduce((a, b) => a + b, 0);
  const frac = BANDS.slice(0, -1).map((lo, i) => {
    let s = 0;
    for (let k = Math.ceil(lo / df); k < Math.min(N / 2, Math.floor(BANDS[i + 1] / df)); k++) s += acc[k];
    return s / total;
  });
  return { frac, peakAbove2k: pkf };
}

const dB = (v) => 20 * Math.log10(v + 1e-12);

function rmsWindows(x, w) {
  const n = Math.floor(x.length / w);
  const o = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < w; j++) s += x[i * w + j] ** 2;
    o[i] = Math.sqrt(s / w);
  }
  return o;
}

function maxJump(r, from, to) {
  let m = 0;
  let at = -1;
  for (let i = Math.max(from, 0); i < Math.min(to, r.length - 1); i++) {
    const d = Math.abs(dB(r[i + 1]) - dB(r[i]));
    if (d > m) [m, at] = [d, i];
  }
  return { m, at };
}

function verifyFile(id) {
  const file = join(OUT, `${id}.m4a`);
  const d = decode(file);
  const mono = new Float32Array(d.n).map((_, i) => 0.5 * (d.l[i] + d.r[i]));
  const lines = [];
  const stats = ffmpeg(['-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { capture: true }).stderr;
  const I = /I:\s+(-?[\d.]+) LUFS/.exec(stats.slice(stats.lastIndexOf('Summary')));
  const LRA = /LRA:\s+(-?[\d.]+) LU/.exec(stats.slice(stats.lastIndexOf('Summary')));
  let peak = 0;
  let sumsq = 0;
  for (let i = 0; i < d.n; i++) {
    peak = Math.max(peak, Math.abs(d.l[i]), Math.abs(d.r[i]));
    sumsq += d.l[i] ** 2 + d.r[i] ** 2;
  }
  const dur = /Duration: (\d+):(\d+):([\d.]+)/.exec(stats);
  const containerSec = dur ? +dur[1] * 3600 + +dur[2] * 60 + +dur[3] : NaN;
  lines.push(
    `${id}: decoded ${(d.n / SR).toFixed(4)} s (${d.n} samples, ${((d.n / SR - 120) * 1000).toFixed(2)} ms vs 120 s), container says ${containerSec.toFixed(2)} s, ` +
      `${(statSync(file).size / 1024).toFixed(0)} KiB, peak ${dB(peak).toFixed(2)} dBFS, rms ${dB(Math.sqrt(sumsq / (2 * d.n))).toFixed(1)} dBFS, ` +
      `integrated ${I ? I[1] : '?'} LUFS, LRA ${LRA ? LRA[1] : '?'} LU`
  );
  // channel correlation
  let cl = 0, cr2 = 0, clr = 0;
  for (let i = 0; i < d.n; i++) { cl += d.l[i] ** 2; cr2 += d.r[i] ** 2; clr += d.l[i] * d.r[i]; }
  lines.push(`  L/R correlation ${(clr / Math.sqrt(cl * cr2)).toFixed(3)}`);

  // loop seam: tail 2 s + head 2 s, 20 ms RMS windows (seam falls on a window edge)
  const two = 2 * SR;
  const seam = new Float32Array(2 * two);
  const seamR = new Float32Array(2 * two);
  seam.set(mono.subarray(d.n - two), 0);
  seam.set(mono.subarray(0, two), two);
  seamR.set(d.r.subarray(d.n - two), 0);
  seamR.set(d.r.subarray(0, two), two);
  const W = Math.round(0.02 * SR);
  const rs = rmsWindows(seam, W);
  const seamIdx = two / W; // index of the first window after the seam
  const near = maxJump(rs, seamIdx - 11, seamIdx + 10); // windows within 200 ms of the seam
  const rf = rmsWindows(mono, W);
  const all = maxJump(rf, 0, rf.length);
  const jumpsAway = [];
  for (let i = 0; i < rf.length - 1; i++) jumpsAway.push(Math.abs(dB(rf[i + 1]) - dB(rf[i])));
  jumpsAway.sort((a, b) => a - b);
  const p99 = jumpsAway[Math.floor(jumpsAway.length * 0.99)];
  lines.push(
    `  seam level change (20 ms windows): max within +-200 ms of seam ${near.m.toFixed(2)} dB; ` +
      `max anywhere in file ${all.m.toFixed(2)} dB (at ${((all.at + 1) * 0.02).toFixed(2)} s); 99th pct ${p99.toFixed(2)} dB`
  );
  // slower view: 0.5 s level before the seam vs after, against the same step anywhere
  const H = SR / 2;
  const half = rmsWindows(mono, H);
  const seamDb = Math.abs(dB(rmsWindows(seam.subarray(two - H, two + H), H)[1]) - dB(rmsWindows(seam.subarray(two - H, two + H), H)[0]));
  let maxHalf = 0;
  for (let i = 0; i < half.length - 1; i++) maxHalf = Math.max(maxHalf, Math.abs(dB(half[i + 1]) - dB(half[i])));
  lines.push(`  0.5 s level across seam ${seamDb.toFixed(2)} dB; largest 0.5 s-to-0.5 s change anywhere ${maxHalf.toFixed(2)} dB`);
  // sample step at the seam vs typical per-second max step
  const stepAt = Math.max(Math.abs(d.l[0] - d.l[d.n - 1]), Math.abs(d.r[0] - d.r[d.n - 1]));
  const blockMax = [];
  for (let s = 0; s + SR <= d.n; s += SR) {
    let m = 0;
    for (let i = s; i < s + SR - 1; i++) m = Math.max(m, Math.abs(d.l[i + 1] - d.l[i]), Math.abs(d.r[i + 1] - d.r[i]));
    blockMax.push(m);
  }
  blockMax.sort((a, b) => a - b);
  const med = blockMax[blockMax.length >> 1];
  lines.push(
    `  sample step at seam ${stepAt.toFixed(5)} vs median per-second max step ${med.toFixed(5)} ` +
      `(ratio ${(stepAt / med).toFixed(3)}), largest step anywhere ${blockMax[blockMax.length - 1].toFixed(5)}`
  );
  const be = bandEnergies(mono);
  lines.push(
    `  energy share by band Hz: ${BANDS.slice(0, -1).map((lo, i) => `${lo}-${BANDS[i + 1]}:${(be.frac[i] * 100).toFixed(1)}%`).join(' ')}; strongest bin above 2 kHz: ${be.peakAbove2k.toFixed(0)} Hz`
  );
  return lines.join('\n');
}

// ------------------------------------------------------------------- main

function main() {
  const args = process.argv.slice(2);
  const verify = args.includes('--verify');
  const wanted = args.filter((a) => !a.startsWith('--'));
  for (const w of wanted) if (!IDS.includes(w)) throw new Error(`unknown id ${w}; known: ${IDS.join(', ')}`);
  const ids = wanted.length ? wanted : IDS;
  if (verify) {
    for (const id of ids) console.log(verifyFile(id));
    return;
  }
  mkdirSync(OUT, { recursive: true });
  const tmp = mkdtempSync(join(tmpdir(), 'ambient-'));
  try {
    for (const id of ids) build(id, tmp);
  } finally {
    if (args.includes('--keep-tmp')) console.log(`intermediate files kept in ${tmp}`);
    else rmSync(tmp, { recursive: true, force: true });
  }
}

main();
