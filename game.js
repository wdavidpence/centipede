/* ═══════════════════════════════════════════════════════════════════
   CENTIPEDE — modern arcade remake of the 1981 Atari classic
   (design: Ed Logg / Dona Bailey). Original code, no ROMs.

   GAMEPLAY MODEL (authentic core):
     • Grid-based world: 30 cols x 28 rows of 8px cells (240x224 field).
     • ONLY THE HEAD drops a row and reverses when blocked (wall or
       mushroom); the body follows via a trail buffer -> winding descent.
     • BODY segment hit (10 pts): becomes a mushroom, centipede splits;
       rear half REVERSES so the two halves separate.
     • HEAD KILL (100 pts): hitting the head kills the ENTIRE centipede
       (user-spec — no fractured body). LAST segment alone: +200 bonus.
     • Early waves are gentle (user-spec): slower/simpler ramp, spider
       harassment is withheld until wave 3 and stays tame to wave 5.
     • Mushrooms take 4 hits (visibly shrink), 5 pts each hit.
     • Poison mushrooms (scorpions) turn centipedes purple -> plunge.
     • Spider (75): erratic, eats mushrooms. Scorpion (100): poisons.
     • Flying saucer (50): fires at player, breaks into spiders,
       drops RAPID-FIRE power orbs (modern QoL).
     • Exploding mushroom burst -> six bouncing mushrooms -> x5 score.
     • Extra life every 10,000 points (max 9). Odd waves fast, even slow.

   MODERN PASS (this revision):
     • Baked sprite engine: gradient-shaded centipede bodies with animated
       legs, dome mushrooms, sleek cannon with live thruster flames,
       articulated spider/scorpion/saucer — glow pre-composited at bake
       time, runtime is pure drawImage (fast even on weak GPUs).
     • HUD/FIRE AND HOLD -> auto-fire, cadence 0.15s, max 2 bullets.
     • Procedural music engine: driving synth loop (kick/bass/hat/lead),
       tempo climbs with the wave; skitter ticks under the centipede.
     • Screen shake, hit flash, particle system, floating score pops,
       wave banners, glass panels, animated attract mode, pause.
     ═══════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  /* ── Canvas / DOM ──────────────────────────────────────────────────── */
  var canvas = document.getElementById("game");
  var ctx = canvas.getContext("2d", { alpha: false });
  var W = 0, H = 0, SCALE = 1, OX = 0, OY = 0;
  var DPR = 1;
  var FD = 1000 / 60;              /* fixed timestep */

  /* ── Grid constants (authentic proportions) ─────────────────────── */
  var CELL = 8;
  var COLS = 30, ROWS = 28;
  var FW = COLS * CELL;          /* 240 */
  var FH = ROWS * CELL;          /* 224 */
  var PLAYER_TOP = FH * 0.52;    /* player stays below this y */
  var MUSH_TOP_ROW = 1;
  var MUSH_BOTTOM_ROW = ROWS - 2;

  /* ── Stage palettes (cycled by wave) ─────────────────────────────── */
  var PALETTES = [
    { centi: "#3dff6e", head: "#b8ffce", mush: "#3fe08a", spider: "#ff4fd8", scorp: "#ffa62e", saucer: "#ffe95c", border: "#2aff7a", grid: "rgba(42,255,122,0.05)" },
    { centi: "#39d7ff", head: "#c9f4ff", mush: "#57f0a0", spider: "#ff7bff", scorp: "#ffd94d", saucer: "#f4faff", border: "#39d7ff", grid: "rgba(57,215,255,0.05)" },
    { centi: "#ffe14d", head: "#fff7c4", mush: "#57f0a0", spider: "#ff5fae", scorp: "#ff8a2e", saucer: "#39d7ff", border: "#ffe14d", grid: "rgba(255,225,77,0.05)" },
    { centi: "#ff7043", head: "#ffd2c2", mush: "#57f0a0", spider: "#d07bff", scorp: "#ff4d4d", saucer: "#ffe14d", border: "#ff7043", grid: "rgba(255,112,67,0.05)" },
    { centi: "#c66bff", head: "#ecd2ff", mush: "#57f0a0", spider: "#ff7ab8", scorp: "#ffa62e", saucer: "#f4faff", border: "#c66bff", grid: "rgba(198,107,255,0.05)" },
    { centi: "#ff8fb8", head: "#ffd9e8", mush: "#57f0a0", spider: "#39d7ff", scorp: "#ffd94d", saucer: "#ffe14d", border: "#ff8fb8", grid: "rgba(255,143,184,0.05)" }
  ];
  var TAIL_COLOR = "#19e6c8";
  var POISON_COLOR = "#d24dff";
  var BOUNCE_COLOR = "#ffffff";
  var EXPLODING_COLOR = "#ffdd00";

  function pal() { return PALETTES[(wave - 1) % PALETTES.length]; }

  /* ── Color helpers ────────────────────────────────────────────────── */
  function rgb(c) {
    var n = parseInt(c.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function mix(a, b, t) {
    var A = rgb(a), B = rgb(b);
    var r = Math.round(A[0] + (B[0] - A[0]) * t), g = Math.round(A[1] + (B[1] - A[1]) * t), bl = Math.round(A[2] + (B[2] - A[2]) * t);
    return "rgb(" + r + "," + g + "," + bl + ")";
  }
  function rgba(c, a) { var A = rgb(c); return "rgba(" + A[0] + "," + A[1] + "," + A[2] + "," + a + ")"; }

  /* ── Audio engine ─────────────────────────────────────────────────── */
  var audioCtx = null, masterGain = null, musicBus = null, sfxBus = null;
  var muted = false, noiseBuf = null;
  try { muted = localStorage.getItem("centipede_muted") === "1"; } catch (e) {}

  function getAudio() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      if (!audioCtx) {
        audioCtx = new AC();
        masterGain = audioCtx.createGain(); masterGain.gain.value = 0.9;
        musicBus = audioCtx.createGain(); musicBus.gain.value = 0.5;
        sfxBus = audioCtx.createGain(); sfxBus.gain.value = 1.0;
        musicBus.connect(masterGain); sfxBus.connect(masterGain);
        masterGain.connect(audioCtx.destination);
        var n = Math.floor(audioCtx.sampleRate * 0.5);
        noiseBuf = audioCtx.createBuffer(1, n, audioCtx.sampleRate);
        var d = noiseBuf.getChannelData(0);
        for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      } else if (audioCtx.state === "suspended") audioCtx.resume();
      return audioCtx;
    } catch (e) { return null; }
  }

  function tone(freq, freqEnd, dur, type, vol, bus, delay) {
    var ac = audioCtx; if (!ac || muted) return;
    try {
      var t = ac.currentTime + (delay || 0);
      var o = ac.createOscillator(), g = ac.createGain();
      o.type = type || "square";
      o.frequency.setValueAtTime(freq, t);
      if (freqEnd) o.frequency.exponentialRampToValueAtTime(Math.max(30, freqEnd), t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vol || 0.08, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(bus || sfxBus);
      o.start(t); o.stop(t + dur + 0.02);
    } catch (e) {}
  }

  function noise(dur, vol, f0, f1, bus, delay) {
    var ac = audioCtx; if (!ac || muted || !noiseBuf) return;
    try {
      var t = ac.currentTime + (delay || 0);
      var s = ac.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
      var f = ac.createBiquadFilter(); f.type = "bandpass"; f.Q.value = 1.1;
      f.frequency.setValueAtTime(f0, t);
      f.frequency.exponentialRampToValueAtTime(Math.max(60, f1), t + dur);
      var g = ac.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      s.connect(f); f.connect(g); g.connect(bus || sfxBus);
      s.start(t); s.stop(t + dur + 0.02);
    } catch (e) {}
  }

  function sfx(type) {
    if (muted) return;
    switch (type) {
      case "shoot":
        tone(1250, 320, 0.05, "square", 0.045);
        noise(0.03, 0.03, 3800, 1200); break;
      case "mushHit":
        tone(1400, 420, 0.05, "triangle", 0.05); break;
      case "bite":
        tone(240, 110, 0.05, "square", 0.06); noise(0.03, 0.025, 900, 350); break;
      case "mushDown":
        noise(0.08, 0.06, 2400, 500); tone(300, 120, 0.08, "triangle", 0.04); break;
      case "segHit":
        tone(660, 180, 0.09, "square", 0.08); noise(0.05, 0.05, 2200, 600); break;
      case "headHit":
        tone(990, 110, 0.16, "square", 0.09); noise(0.1, 0.06, 1800, 300); break;
      case "lastSeg":
        [1568, 1976, 2637].forEach(function (f, i) { tone(f, f * 0.8, 0.12, "square", 0.07, null, i * 0.05); }); break;
      case "step":
        noise(0.02, 0.022, 2600 + Math.random() * 1400, 900); break;
      case "spider":
        tone(220, 700, 0.09, "sawtooth", 0.05); break;
      case "scorpion":
        tone(180, 760, 0.12, "sawtooth", 0.06); break;
      case "saucer":
        tone(1200, 420, 0.22, "square", 0.05); tone(600, 210, 0.22, "square", 0.03); break;
      case "saucerShot":
        tone(520, 180, 0.08, "sawtooth", 0.04); break;
      case "boom":
        noise(0.4, 0.16, 1400, 90); tone(150, 40, 0.3, "sawtooth", 0.1); break;
      case "bounce":
        tone(1320, 880, 0.04, "square", 0.045); break;
      case "fiveX":
        tone(1046, 2093, 0.12, "square", 0.06); break;
      case "powerup":
        [784, 1175, 1568, 2093].forEach(function (f, i) { tone(f, f, 0.09, "square", 0.07, null, i * 0.06); }); break;
      case "extra":
        [784, 988, 1175, 1568].forEach(function (f, i) { tone(f, f, 0.12, "square", 0.08, null, i * 0.06); }); break;
      case "wave":
        [523, 587, 659, 784, 880, 1046].forEach(function (f, i) { tone(f, f, 0.1, "square", 0.06, null, i * 0.055); }); break;
      case "hurt":
        noise(0.5, 0.2, 900, 80);
        [320, 240, 160, 96].forEach(function (f, i) { tone(f, f * 0.7, 0.22, "sawtooth", 0.11, null, i * 0.08); }); break;
      case "gameover":
        [392, 330, 262, 196, 131].forEach(function (f, i) { tone(f, f * 0.94, 0.24, "triangle", 0.09, null, i * 0.16); }); break;
    }
  }

  /* ── Music: intense arcade gallop ("bumpita bumpita") ───────────── */
  var music = { on: false, sixteenth: 0, nextAt: 0 };
  var BASS_ROOTS = [55.0, 55.0, 65.41, 49.0];          /* A A C G minor */
  /* driving minor riff per bar — 16th-note offsets inside the bar */
  var RIFF = [[0, 3, 7, 12, 7, 3, 0, -2], [0, 3, 7, 10, 7, 3, 0, 12]];
  var LEAD_SCALE = [440, 523.25, 587.33, 659.25, 783.99, 880];

  function musicBpm() { return 150 + Math.min(wave, 10) * 4; }   /* 154→190 */
  function musicStart() {
    var ac = getAudio(); if (!ac) return;
    music.on = true; music.sixteenth = 0; music.nextAt = ac.currentTime + 0.06;
  }
  function musicStop() { music.on = false; }

  function musicTick() {
    var ac = audioCtx;
    if (!music.on || !ac || muted || audioCtx.state !== "running") return;
    var s16 = 15 / musicBpm();
    while (music.nextAt < ac.currentTime + 0.14) {
      var t = music.nextAt, d = t - ac.currentTime;
      var s = music.sixteenth % 16, bar = (music.sixteenth >> 4);
      var root = BASS_ROOTS[bar % 4];
      var inten = Math.min(1, (wave - 1) / 6);
      /* four-on-the-floor kick — the thump */
      if (s % 4 === 0) tone(160, 42, 0.15, "sine", 0.18, musicBus, d);
      /* snare clap on 2 and 4 */
      if (s === 4 || s === 12) noise(0.06, 0.05 + 0.03 * inten, 1900, 900, musicBus, d);
      /* hats: 8ths always, 16ths when hot */
      if (s % 2 === 0 || inten > 0.5)
        noise(s % 4 === 2 ? 0.03 : 0.018, s % 4 === 2 ? 0.018 : 0.011, 8000, 5000, musicBus, d);
      /* BUMPITA gallop bass: 16th ostinato root(octave bump on & of 2/4) */
      var oct = (s === 3 || s === 6 || s === 11 || s === 14) ? 2 : 1;
      if (s % 2 === 0 || wave >= 3)
        tone(root * oct, root * oct * 0.97, 0.07, "sawtooth", 0.055 + 0.02 * inten, musicBus, d);
      /* riff stab every 8th on the second half of the bar */
      if (s % 2 === 1 && s >= 8) {
        var semi = RIFF[bar % RIFF.length][((s - 8) >> 1) % 8];
        var f = root * 4 * Math.pow(2, semi / 12);
        tone(f, f, 0.055, "square", 0.03 + 0.015 * inten, musicBus, d);
      }
      /* sparkle lead on later waves */
      if (wave >= 4 && (s === 7 || s === 15)) {
        var lf = LEAD_SCALE[(music.sixteenth + bar * 3) % LEAD_SCALE.length];
        tone(lf, lf, 0.07, "square", 0.022, musicBus, d);
      }
      music.nextAt += s16;
      music.sixteenth++;
    }
  }

  /* ── Game state ───────────────────────────────────────────────────── */
  var state = "attract";   /* attract | playing | paused | dying | waveclear | gameover */
  var prevState = "playing";
  var score = 0, highScore = 0, lives = 3, wave = 1;
  var frame = 0, attractFrame = 0;
  var dyingT = 0, waveClearT = 0;
  var nextExtraLife = 10000;
  var fiveX = false;
  var stepCount = 0;
  var shake = 0, flash = 0;
  var bannerT = 0;
  var frozen = false;      /* test-only: pin centipede movement for deterministic harnesses */

  try { highScore = parseInt(localStorage.getItem("centipede_highscore"), 10) || 0; } catch (e) {}

  /* ── Player ───────────────────────────────────────────────────────── */
  var ship = { x: FW / 2, y: FH - 12, vx: 0, vy: 0, alive: true, inv: 0, dead: false };
  var bullets = [];               /* cadence-controlled auto-fire, max 2 */
  var FIRE_CD = 9;                /* frames between shots (~0.15s) */
  var MAX_BULLETS = 2;
  var fireCd = 0, fireHeld = false;
  var rapid = 0;                  /* rapid-fire frames remaining */
  var powers = [];               /* saucer-dropped power orbs */
  var keys = {};

  /* ── Entities ─────────────────────────────────────────────────────── */
  var centipedes = [];
  var mush = {};
  var spiders = [];
  var scorpions = [];
  var saucers = [];
  var saucerShots = [];
  var bounceShrooms = [];
  var fungi = [];
  var particles = [];
  var floats = [];
  var stars = [];

  function mkey(c, r) { return c + "," + r; }
  function mushAt(c, r) { return mush[mkey(c, r)] || null; }
  function cellOf(px) { return Math.round(px / CELL); }

  /* ── Sprite bake engine (pre-glowed offscreen sprites) ───────────── */
  var SPR = {};                /* key -> canvas */
  var sprCache = {};         /* runtime composite cache keyed by stage palette */

  function bakeCanvas(w, h) {
    var c = document.createElement("canvas");
    c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
    return c;
  }
  var SS = 2; /* supersample factor for crisp upscaling */
  function bakeDraw(key, w, h, pad, fn) {
    var lw = w + pad * 2, lh = h + pad * 2;
    var c = bakeCanvas(lw * SS, lh * SS);
    var g = c.getContext("2d");
    g.scale(SS, SS);
    g.translate(pad, pad);
    fn(g);
    SPR[key] = { cv: c, ox: pad, oy: pad, w: lw, h: lh };
    return SPR[key];
  }
  /* draw baked sprite centered on field coord. spr.w/h = full canvas extent
     in bake units (content + 2*pad); sprite content center sits at w/2,h/2. */
  function blit(spr, x, y, alpha) {
    if (!spr) return;
    var sx = px(x) - spr.w * SCALE / 2, sy = py(y) - spr.h * SCALE / 2;
    if (alpha !== undefined && alpha < 1) ctx.globalAlpha = alpha;
    ctx.drawImage(spr.cv, sx, sy, spr.w * SCALE, spr.h * SCALE);
    if (alpha !== undefined && alpha < 1) ctx.globalAlpha = 1;
  }

  function radal(g, cx, cy, r, stops) {
    var gr = g.createRadialGradient(cx, cy, r * 0.1, cx, cy, r);
    stops.forEach(function (s) { gr.addColorStop(s[0], s[1]); });
    g.fillStyle = gr;
  }

  /* elongated capsule body segment with 3 leg pairs, long axis horizontal.
     base length 1.6*CELL: slight overlap keeps continuity, strong dark
     rings keep individual segments readable (no merged bar). */
  function bakeSeg(color, legsPhase) {
    var s = CELL, w = CELL * 1.6;
    return bakeDraw("", w, s, 4, function (g) {
      /* legs along both flanks, alternating gait */
      g.strokeStyle = mix(color, "#000000", 0.25);
      g.lineWidth = 1.3;
      g.lineCap = "round";
      for (var k = 0; k < 3; k++) {
        var lx = w * (0.26 + k * 0.24);
        var sw = (legsPhase === k % 2) ? 1 : -1;
        g.beginPath();
        g.moveTo(lx - 1, s * 0.30); g.lineTo(lx - 2.6, s * 0.30 - 3.1 * (1 + sw * 0.35));
        g.moveTo(lx + 1, s * 0.70); g.lineTo(lx + 2.6, s * 0.70 + 3.1 * (1 - sw * 0.35));
        g.stroke();
      }
      /* capsule body: wider toward head end (left) tapering to tail (right) */
      radal(g, w * 0.35, s * 0.32, w * 0.8, [[0, mix(color, "#ffffff", 0.55)], [0.45, color], [1, mix(color, "#000000", 0.45)]]);
      var hh = s * 0.40, ht = s * 0.28;
      g.beginPath();
      g.moveTo(w * 0.5, s * 0.5 - hh);
      g.quadraticCurveTo(w, s * 0.5 - ht * 0.9, w - 0.4, s * 0.5);
      g.quadraticCurveTo(w, s * 0.5 + ht * 0.9, w * 0.5, s * 0.5 + hh);
      g.quadraticCurveTo(w * 0.12, s * 0.5 + hh, w * 0.06, s * 0.5);
      g.quadraticCurveTo(w * 0.12, s * 0.5 - hh, w * 0.5, s * 0.5 - hh);
      g.closePath(); g.fill();
      /* rim + bold segment ring (readability between adjacent segments) */
      g.strokeStyle = mix(color, "#000000", 0.75); g.lineWidth = 1;
      g.beginPath();
      g.moveTo(w * 0.5, s * 0.5 - hh);
      g.quadraticCurveTo(w, s * 0.5 - ht * 0.9, w - 0.4, s * 0.5);
      g.quadraticCurveTo(w, s * 0.5 + ht * 0.9, w * 0.5, s * 0.5 + hh);
      g.quadraticCurveTo(w * 0.12, s * 0.5 + hh, w * 0.06, s * 0.5);
      g.quadraticCurveTo(w * 0.12, s * 0.5 - hh, w * 0.5, s * 0.5 - hh);
      g.closePath(); g.stroke();
      /* joint ring near the TAIL edge so adjacent segments show one clean
         divider at their junction, not a stripe across the middle */
      g.strokeStyle = mix(color, "#000000", 0.4); g.lineWidth = 0.9;
      g.beginPath(); g.ellipse(w * 0.88, s * 0.5, w * 0.045, s * 0.26, 0, 0, Math.PI * 2); g.stroke();
      /* gloss streak */
      g.fillStyle = "rgba(255,255,255,0.45)";
      g.beginPath(); g.ellipse(w * 0.4, s * 0.3, w * 0.2, s * 0.06, -0.15, 0, Math.PI * 2); g.fill();
    });
  }

  /* elongated head, facing RIGHT (render flips for dir=-1); open jaws.
     Distinct from body: bigger silhouette, dark outline, bright white jaws
     and eye rings so the leading end always reads as the head. */
  function bakeHead(color, jawsOpen) {
    var s = CELL * 1.12, w = CELL * 1.55;
    return bakeDraw("", w, s, 6, function (g) {
      /* antennae swept back */
      g.strokeStyle = mix(color, "#ffffff", 0.3); g.lineWidth = 1.1; g.lineCap = "round";
      g.beginPath();
      g.moveTo(w * 0.72, s * 0.22); g.quadraticCurveTo(w * 0.85, -1.8, w * 1.0 + 3, -3.2);
      g.moveTo(w * 0.72, s * 0.78); g.quadraticCurveTo(w * 0.85, s + 1.8, w * 1.0 + 3, s + 3.2);
      g.stroke();
      g.fillStyle = "#ffffff";
      g.beginPath(); g.arc(w + 3, -3.2, 0.9, 0, 7); g.fill();
      g.beginPath(); g.arc(w + 3, s + 3.2, 0.9, 0, 7); g.fill();
      /* mandibles at right edge; bright white so head leads visibly;
         open wide when chomping */
      var gj = jawsOpen ? 2.6 : 1.2;
      g.fillStyle = "#ffffff";
      g.beginPath(); g.moveTo(w * 0.78, s * 0.5 - gj); g.lineTo(w + gj * 1.6, s * 0.5 - gj * 2.2); g.lineTo(w * 0.92, s * 0.5 - gj * 0.2); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(w * 0.78, s * 0.5 + gj); g.lineTo(w + gj * 1.6, s * 0.5 + gj * 2.2); g.lineTo(w * 0.92, s * 0.5 + gj * 0.2); g.closePath(); g.fill();
      /* skull: blunt rounded-front capsule */
      radal(g, w * 0.35, s * 0.32, w * 0.85, [[0, mix(color, "#ffffff", 0.7)], [0.5, color], [1, mix(color, "#000000", 0.5)]]);
      g.beginPath();
      g.moveTo(w * 0.1, s * 0.5 - s * 0.44);
      g.lineTo(w * 0.62, s * 0.5 - s * 0.42);
      g.quadraticCurveTo(w * 0.95, s * 0.5 - s * 0.34, w * 0.95, s * 0.5);
      g.quadraticCurveTo(w * 0.95, s * 0.5 + s * 0.34, w * 0.62, s * 0.5 + s * 0.42);
      g.lineTo(w * 0.1, s * 0.5 + s * 0.44);
      g.quadraticCurveTo(-1.4, s * 0.5, w * 0.1, s * 0.5 - s * 0.44);
      g.closePath(); g.fill();
      g.strokeStyle = mix(color, "#000000", 0.85); g.lineWidth = 1.2;
      g.stroke();
      /* cluster eyes with bright rings */
      g.strokeStyle = "#ffffff"; g.lineWidth = 0.7;
      [[0.68, 0.34], [0.8, 0.44], [0.68, 0.66], [0.8, 0.56]].forEach(function (p) {
        g.fillStyle = "#0a0f0a";
        g.beginPath(); g.arc(w * p[0], s * p[1], 1.15, 0, 7); g.fill(); g.stroke();
      });
      g.fillStyle = "#fff";
      g.beginPath(); g.arc(w * 0.7, s * 0.31, 0.42, 0, 7); g.fill();
      g.beginPath(); g.arc(w * 0.7, s * 0.69, 0.42, 0, 7); g.fill();
    });
  }

  function bakeMush(color, hp, poison) {
    var s = CELL;
    var scale = 0.55 + 0.45 * (hp / 4);
    return bakeDraw("", s, s, 4, function (g) {
      var capH = s * 0.52 * scale, capW = s * 0.94 * scale;
      var cx = s / 2, baseY = s;
      var stemC = poison ? mix(POISON_COLOR, "#ffffff", 0.35) : "#d8d0c0";
      /* stem */
      g.fillStyle = stemC;
      g.fillRect(cx - capW * 0.16, baseY - capH * 0.55, capW * 0.32, capH * 0.55);
      /* cap dome */
      radal(g, cx - capW * 0.18, baseY - capH * 1.15, capW * 0.9,
        [[0, mix(color, "#ffffff", 0.65)], [0.5, color], [1, mix(color, "#000000", 0.5)]]);
      g.beginPath();
      g.moveTo(cx - capW / 2, baseY - capH * 0.4);
      g.quadraticCurveTo(cx - capW / 2, baseY - capH * 1.35, cx, baseY - capH * 1.35);
      g.quadraticCurveTo(cx + capW / 2, baseY - capH * 1.35, cx + capW / 2, baseY - capH * 0.4);
      g.quadraticCurveTo(cx, baseY - capH * 0.2, cx - capW / 2, baseY - capH * 0.4);
      g.closePath(); g.fill();
      /* spots */
      if (hp > 2) {
        g.fillStyle = "rgba(255,255,255,0.85)";
        g.beginPath(); g.arc(cx - capW * 0.22, baseY - capH * 0.95, capW * 0.1, 0, 7); g.fill();
        g.beginPath(); g.arc(cx + capW * 0.2, baseY - capH * 1.05, capW * 0.08, 0, 7); g.fill();
      }
      if (poison) {
        g.strokeStyle = "rgba(210,77,255,0.9)"; g.lineWidth = 1;
        g.beginPath(); g.arc(cx, baseY - capH * 0.85, capW * 0.55, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
      }
      /* damage cracks */
      if (hp <= 2) {
        g.strokeStyle = "rgba(0,0,0,0.6)"; g.lineWidth = 0.7;
        g.beginPath(); g.moveTo(cx - capW * 0.3, baseY - capH * 0.5); g.lineTo(cx - capW * 0.1, baseY - capH * 1.1); g.stroke();
      }
      if (hp <= 1) {
        g.beginPath(); g.moveTo(cx + capW * 0.25, baseY - capH * 0.45); g.lineTo(cx + capW * 0.05, baseY - capH * 1.0); g.stroke();
      }
    });
  }

  function bakeSpider(color, legPhase) {
    var s = CELL;
    return bakeDraw("", s, s, 5, function (g) {
      g.strokeStyle = mix(color, "#000000", 0.15); g.lineWidth = 1.2;
      for (var k = 0; k < 3; k++) {
        var y = s * (0.22 + k * 0.28);
        var sw = (legPhase === 0 ? -1 : 1) * (k % 2 ? -1 : 1) * 1.6;
        g.beginPath();
        g.moveTo(2, y); g.lineTo(-3.4, y + sw);
        g.lineTo(-4.6, y + sw + (k - 1) * 1.5);
        g.moveTo(s - 2, y); g.lineTo(s + 3.4, y + sw);
        g.lineTo(s + 4.6, y + sw + (k - 1) * 1.5);
        g.stroke();
      }
      radal(g, s * 0.4, s * 0.38, s * 0.7, [[0, mix(color, "#ffffff", 0.6)], [0.55, color], [1, mix(color, "#000000", 0.5)]]);
      g.beginPath(); g.ellipse(s / 2, s / 2, s * 0.42, s * 0.36, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = "#0a0a0a";
      g.beginPath(); g.arc(s * 0.36, s * 0.4, 0.9, 0, 7); g.fill();
      g.beginPath(); g.arc(s * 0.64, s * 0.4, 0.9, 0, 7); g.fill();
    });
  }

  function bakeScorpion(color, legPhase) {
    var s = CELL;
    return bakeDraw("", s + 4, s, 6, function (g) {
      /* legs */
      g.strokeStyle = mix(color, "#000000", 0.2); g.lineWidth = 1;
      for (var k = 0; k < 3; k++) {
        var x = 3 + k * 2.6, off = legPhase === 0 ? 1.6 : 2.4;
        g.beginPath(); g.moveTo(x, s - 1); g.lineTo(x - 0.8, s + off - 1); g.stroke();
        g.beginPath(); g.moveTo(x, 1); g.lineTo(x - 0.8, 1 - off + 1.6); g.stroke();
      }
      /* tail curled over back */
      g.strokeStyle = color; g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(1.5, s * 0.5);
      g.quadraticCurveTo(-3, s * 0.1, -0.5, -2.2);
      g.stroke();
      g.fillStyle = "#ffe95c";
      g.beginPath(); g.arc(-0.5, -2.4, 1.2, 0, 7); g.fill();
      /* body */
      radal(g, s * 0.42, s * 0.35, s * 0.75, [[0, mix(color, "#ffffff", 0.55)], [0.5, color], [1, mix(color, "#000000", 0.5)]]);
      g.beginPath(); g.ellipse(s * 0.42, s * 0.5, s * 0.44, s * 0.3, 0, 0, Math.PI * 2); g.fill();
      /* pincers */
      g.fillStyle = mix(color, "#ffffff", 0.2);
      g.beginPath(); g.moveTo(s * 0.82, s * 0.28); g.lineTo(s + 3.4, s * 0.1); g.lineTo(s + 2.2, s * 0.42); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(s * 0.82, s * 0.72); g.lineTo(s + 3.4, s * 0.9); g.lineTo(s + 2.2, s * 0.58); g.closePath(); g.fill();
    });
  }

  function bakeSaucer(color, blink) {
    return bakeDraw("", CELL + 8, CELL, 6, function (g) {
      var w = CELL + 8, h = CELL;
      /* hull underside glow */
      radal(g, w / 2, h * 0.7, w * 0.55, [[0, rgba(color, blink ? 0.5 : 0.25)], [1, "rgba(0,0,0,0)"]]);
      g.beginPath(); g.ellipse(w / 2, h * 0.62, w * 0.5, h * 0.4, 0, 0, Math.PI * 2); g.fill();
      /* saucer disc */
      radal(g, w * 0.42, h * 0.3, w * 0.6, [[0, mix(color, "#ffffff", 0.6)], [0.55, color], [1, mix(color, "#000000", 0.55)]]);
      g.beginPath(); g.ellipse(w / 2, h * 0.55, w * 0.5, h * 0.26, 0, 0, Math.PI * 2); g.fill();
      /* dome */
      radal(g, w * 0.44, h * 0.22, w * 0.25, [[0, "#ffffff"], [0.6, mix(color, "#ffffff", 0.4)], [1, mix(color, "#000000", 0.3)]]);
      g.beginPath(); g.arc(w / 2, h * 0.42, w * 0.18, Math.PI, 0); g.fill();
      /* running lights */
      g.fillStyle = blink ? "#ff5050" : "#50ffa0";
      g.beginPath(); g.arc(w * 0.2, h * 0.58, 1, 0, 7); g.fill();
      g.fillStyle = blink ? "#50ffa0" : "#ff5050";
      g.beginPath(); g.arc(w * 0.8, h * 0.58, 1, 0, 7); g.fill();
    });
  }

  function bakeShip(color, thrustPhase) {
    return bakeDraw("", 18, 16, 6, function (g) {
      var w = 18, h = 16;
      /* thruster flames */
      var fl = 3 + thrustPhase * 2.5;
      radal(g, w * 0.32, h * 0.9, 3.4, [[0, "rgba(255,255,255,0.95)"], [0.4, "rgba(255,170,60,0.8)"], [1, "rgba(255,80,20,0)"]]);
      g.beginPath(); g.moveTo(w * 0.32 - 2.4, h * 0.82); g.lineTo(w * 0.32, h * 0.82 + fl); g.lineTo(w * 0.32 + 2.4, h * 0.82); g.closePath(); g.fill();
      radal(g, w * 0.68, h * 0.9, 3.4, [[0, "rgba(255,255,255,0.95)"], [0.4, "rgba(255,170,60,0.8)"], [1, "rgba(255,80,20,0)"]]);
      g.beginPath(); g.moveTo(w * 0.68 - 2.4, h * 0.82); g.lineTo(w * 0.68, h * 0.82 + fl); g.lineTo(w * 0.68 + 2.4, h * 0.82); g.closePath(); g.fill();
      /* wings */
      g.fillStyle = mix(color, "#000000", 0.45);
      g.beginPath(); g.moveTo(w * 0.06, h * 0.78); g.lineTo(w * 0.3, h * 0.44); g.lineTo(w * 0.34, h * 0.78); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(w * 0.94, h * 0.78); g.lineTo(w * 0.7, h * 0.44); g.lineTo(w * 0.66, h * 0.78); g.closePath(); g.fill();
      /* hull */
      radal(g, w * 0.44, h * 0.3, w * 0.6, [[0, "#ffffff"], [0.4, mix(color, "#ffffff", 0.35)], [1, mix(color, "#000000", 0.55)]]);
      g.beginPath();
      g.moveTo(w * 0.5, h * 0.04);
      g.lineTo(w * 0.58, h * 0.42); g.lineTo(w * 0.78, h * 0.62);
      g.lineTo(w * 0.78, h * 0.8); g.lineTo(w * 0.22, h * 0.8);
      g.lineTo(w * 0.22, h * 0.62); g.lineTo(w * 0.42, h * 0.42);
      g.closePath(); g.fill();
      g.strokeStyle = mix(color, "#000000", 0.6); g.lineWidth = 0.8; g.stroke();
      /* cockpit */
      radal(g, w * 0.46, h * 0.3, 2.6, [[0, "#c8f8ff"], [1, mix(color, "#00324a", 0.4)]]);
      g.beginPath(); g.arc(w * 0.5, h * 0.34, 2.1, 0, 7); g.fill();
      /* wing tip lights */
      g.fillStyle = "#ffe14d";
      g.fillRect(w * 0.05, h * 0.72, 1.4, 1.4);
      g.fillRect(w * 0.94 - 1.4, h * 0.72, 1.4, 1.4);
    });
  }

  function bakeBullet() {
    return bakeDraw("", 3, 10, 5, function (g) {
      radal(g, 1.5, 5, 6, [[0, "rgba(255,255,255,0.9)"], [0.35, "rgba(180,240,255,0.5)"], [1, "rgba(80,180,255,0)"]]);
      g.beginPath(); g.ellipse(1.5, 5, 4.6, 6, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = "#ffffff";
      g.fillRect(0.8, 1, 1.6, 8);
      g.fillStyle = "#bfeaff";
      g.fillRect(1, 8, 1.2, 3);
    });
  }

  function bakeOrb(color, phase) {
    return bakeDraw("", 12, 12, 6, function (g) {
      var r = 5 + phase * 0.8;
      radal(g, 6, 6, r + 4, [[0, "rgba(255,255,255,0.95)"], [0.35, rgba(color, 0.8)], [1, rgba(color, 0)]]);
      g.beginPath(); g.arc(6, 6, r + 3, 0, Math.PI * 2); g.fill();
      g.fillStyle = "#ffffff";
      g.beginPath(); g.arc(6, 6, r * 0.55, 0, Math.PI * 2); g.fill();
      /* R glyph */
      g.strokeStyle = "#1a1030"; g.lineWidth = 1.4;
      g.beginPath(); g.moveTo(4.6, 8.6); g.lineTo(4.6, 3.4); g.lineTo(6.8, 3.4); g.arc(6.8, 4.8, 1.4, -Math.PI / 2, Math.PI / 2); g.lineTo(4.6, 6.2); g.lineTo(7.6, 8.6); g.stroke();
    });
  }

  function bakeParticles(color) {
    return bakeDraw("", 4, 4, 4, function (g) {
      radal(g, 2, 2, 4, [[0, "rgba(255,255,255,0.95)"], [0.3, rgba(color, 0.85)], [1, rgba(color, 0)]]);
      g.beginPath(); g.arc(2, 2, 4, 0, Math.PI * 2); g.fill();
    });
  }

  /* stage-keyed sprite set builder (rebuilt when palette changes) */
  function sprSet() {
    var key = "p" + ((wave - 1) % PALETTES.length);
    if (sprCache[key]) return sprCache[key];
    var P = PALETTES[(wave - 1) % PALETTES.length];
    var set = { seg: [], segPoison: [], spider: [], scorpion: [], ship: [], orb: [], part: {} };
    /* gradient head->tail: interpolate centi color into tail color across up to 26 slots */
    var SLOTS = 26;
    for (var i = 0; i < SLOTS; i++) {
      var t = i / (SLOTS - 1);
      var c = mix(P.centi, TAIL_COLOR, t * 0.85);
      set.seg[i] = [];
      set.seg[i].push(bakeSeg(c, 0));
      set.seg[i].push(bakeSeg(c, 1));
      var pc = mix(POISON_COLOR, TAIL_COLOR, t * 0.6);
      set.segPoison[i] = [bakeSeg(pc, 0), bakeSeg(pc, 1)];
    }
    set.head = bakeHead(P.head, false);
    set.headOpen = bakeHead(P.head, true);
    set.headPoison = bakeHead("#ff5ce8", false);
    set.headPoisonOpen = bakeHead("#ff5ce8", true);
    set.mush = [];
    for (var hp = 1; hp <= 4; hp++) {
      set.mush[hp] = bakeMush(P.mush, hp, false);
      set.mush["p" + hp] = bakeMush(POISON_COLOR, hp, true);
      set.mush["e" + hp] = bakeMush(EXPLODING_COLOR, hp, false);
    }
    set.bounce = bakeMush(BOUNCE_COLOR, 4, false);
    set.spider = [bakeSpider(P.spider, 0), bakeSpider(P.spider, 1)];
    set.scorpion = [bakeScorpion(P.scorp, 0), bakeScorpion(P.scorp, 1)];
    set.saucer = [bakeSaucer(P.saucer, false), bakeSaucer(P.saucer, true)];
    set.ship = [bakeShip("#4dd7ff", 0), bakeShip("#4dd7ff", 1)];
    set.bullet = bakeBullet();
    set.orb = [bakeOrb("#ffe14d", 0), bakeOrb("#ffe14d", 1)];
    set.fungus = bakeMush("#39ffb0", 4, false);
    sprCache[key] = set;
    return set;
  }

  /* ── Mushroom helpers ─────────────────────────────────────────────── */
  function seedMushrooms() {
    mush = {};
    for (var r = MUSH_TOP_ROW; r <= MUSH_BOTTOM_ROW; r++) {
      for (var c = 1; c < COLS - 1; c++) {
        if (r > ROWS - 5 && Math.random() < 0.55) continue;
        if (Math.random() < 0.22) {
          mush[mkey(c, r)] = { c: c, r: r, hp: 4, poison: false, expl: 0 };
        }
      }
    }
    var cc = 8 + Math.floor(Math.random() * 14), cr = 12 + Math.floor(Math.random() * 5);
    mush[mkey(cc, cr)] = { c: cc, r: cr, hp: 4, poison: false, expl: 0 };
  }

  function addMushroom(c, r, poison) {
    c = Math.max(1, Math.min(COLS - 2, c));
    r = Math.max(0, Math.min(ROWS - 1, r));
    if (mushAt(c, r)) return;
    mush[mkey(c, r)] = { c: c, r: r, hp: 4, poison: !!poison, expl: 0 };
  }

  function hitMushroom(m) {
    m.hp--;
    addScore(5);
    if (m.hp <= 0) {
      if (m.expl > 0 || (Math.random() < 0.06 && state === "playing")) {
        delete mush[mkey(m.c, m.r)];
        spawnBurst(m.c * CELL, m.r * CELL);
      } else {
        delete mush[mkey(m.c, m.r)];
      }
      sfx("mushDown");
      puff(m.c * CELL + 4, m.r * CELL + 4, m.poison ? POISON_COLOR : pal().mush, 8);
      shake = Math.max(shake, 1.5);
    } else {
      sfx("mushHit");
      puff(m.c * CELL + 4, m.r * CELL + 2, "#ffffff", 3);
    }
  }

  /* ── Centipedes: trail-based grid movement ────────────────────────── */
  function speedCells() {
    /* gentle early ramp (user-spec: too hard too quickly) — wave 1 is a
       lazy ~7 cells/s crawl, original pacing (~10) arrives near wave 8+ */
    var base = (wave % 2 === 1) ? 7 : 5;
    return base + Math.min(wave, 10) * 0.35;
  }

  function makeCentipede(segs, dir, startTrail, headIdx, poison) {
    var trail = startTrail || initTrail(segs, dir);
    return {
      segs: segs, trail: trail, dir: dir,
      acc: 0, poison: !!poison, headIdx: headIdx || 0,
      zig: 0, dropping: 0, bites: 0, chomp: 0,
      maxSegs: Math.max(segs.length + 6, 16),
    };
  }

  function initTrail(segs, dir) {
    /* history must cover the full body span (n-1)*CELL plus margin,
       otherwise tail segments collapse onto the trail's last point */
    var t = [{ x: segs[0].x, y: segs[0].y }];
    for (var i = 1; i < segs.length * CELL + 40; i++) {
      t.push({ x: segs[0].x - dir * i, y: segs[0].y });
    }
    return t;
  }

  function spawnWaveCentipede() {
    /* starts SHORT — a small worm that bites mushrooms to grow (user spec);
       even shorter early so wave 1 is one easy, readable centipede */
    var n = Math.min(12, 6 + Math.floor(wave / 2));
    var dir = (wave % 2 === 1) ? 1 : -1;
    var startCol = (wave % 2 === 1) ? 1 : COLS - 2;
    var segs = [];
    for (var i = 0; i < n; i++) {
      segs.push({ x: (startCol - dir * i) * CELL, y: CELL });
    }
    var cen = makeCentipede(segs, dir, null, 0, false);
    cen.maxSegs = Math.min(24, n + 10);
    centipedes.push(cen);
  }

  function retrace(cen) {
    var trail = cen.trail;
    var idx = 0, acc2 = 0;
    cen.segs[0].x = trail[0].x; cen.segs[0].y = trail[0].y;
    for (var i = 1; i < cen.segs.length; i++) {
      var want = i * CELL;
      /* advance the junction until the segment's arc length lands inside
         [acc2, acc2+dd). Strict '<' so exact junction landings advance
         cleanly instead of stacking every segment on one point. */
      while (idx + 1 < trail.length - 1) {
        var a = trail[idx], b = trail[idx + 1];
        var dd = Math.hypot(b.x - a.x, b.y - a.y);
        if (dd > 0 && acc2 + dd >= want) break;
        acc2 += dd; idx++;
      }
      var a2 = trail[idx], b2 = trail[Math.min(idx + 1, trail.length - 1)];
      var dd2 = Math.hypot(b2.x - a2.x, b2.y - a2.y);
      while (dd2 <= 0 && idx + 1 < trail.length - 1) {
        idx++; a2 = trail[idx]; b2 = trail[idx + 1];
        dd2 = Math.hypot(b2.x - a2.x, b2.y - a2.y);
      }
      var t = dd2 > 0 ? Math.min(1, (want - acc2) / dd2) : 1;
      cen.segs[i].x = a2.x + (b2.x - a2.x) * t;
      cen.segs[i].y = a2.y + (b2.y - a2.y) * t;
      /* body segments that land on a mushroom drop one row and climb back
         over it (authentic squirm; does NOT reverse — only head reverses) */
      var bc = cellOf(cen.segs[i].x), br = cellOf(cen.segs[i].y);
      if (mushAt(bc, br) && i % 2 === 0 && br < ROWS - 1) {
        cen.segs[i].y = (br + 1) * CELL;
        if (cen.segs[i].y > FH) cen.segs[i].y = FH;
      }
    }
  }

  function updateCenti(cen) {
    var cells = speedCells() * (cen.poison ? 1.8 : 1);
    cen.acc += cells * CELL / 60;

    while (cen.acc >= CELL) {
      cen.acc -= CELL;
      stepCount++;
      var head = cen.segs[0];
      var hc = cellOf(head.x), hr = cellOf(head.y);

      var nc = hc + cen.dir;
      var blocked = (nc < 0 || nc > COLS - 1);
      var blocker = blocked ? null : mushAt(nc, hr);
      if (blocker) blocked = true;

      if (blocked) {
        /* ONLY the head drops one row and reverses; if the blocker was a
           mushroom the head also takes a BITE out of it (hp--). Each bite
           grows the centipede by one tail segment (user spec / worm feel). */
        cen.dir = -cen.dir;
        var dropRow = hr + 1;
        if (dropRow >= ROWS - 1) {
          respawnCenti(cen);
          return;
        }
        head.y = dropRow * CELL;
        if (blocker) {
          if (blocker.poison && !cen.poison) { cen.poison = true; sfx("fiveX"); }
          blocker.hp--;
          cen.chomp = 14;
          cen.bites++;
          addScore(1);
          puff(nc * CELL + 4, hr * CELL + 2, pal().mush, 4);
          if (blocker.hp <= 0) {
            delete mush[mkey(blocker.c, blocker.r)];
            puff(nc * CELL + 4, hr * CELL + 4, blocker.poison ? POISON_COLOR : pal().mush, 6);
            sfx("mushDown");
          } else {
            sfx("bite");
          }
          /* GROW: add one tail segment behind the current tail (capped).
             Keep trail history; pad the tail end so the new segment sits at
             the old tail position and gets pulled forward naturally. */
          if (cen.segs.length < cen.maxSegs) {
            cen.segs.push({ x: head.x, y: head.y });
            var last = cen.trail[cen.trail.length - 1] || { x: head.x, y: head.y };
            for (var gi = 0; gi < CELL * 2; gi++) cen.trail.push({ x: last.x, y: last.y });
            floats.push({ x: nc * CELL + 4, y: hr * CELL - 4, text: "GROW!", color: "#8dff6a", life: 45 });
          }
        }
      } else {
        head.x = nc * CELL;
        cen.zig = 1 - cen.zig;
      }

      var m0 = mushAt(cellOf(head.x), cellOf(head.y));
      if (m0 && m0.poison && !cen.poison) {
        cen.poison = true;
        sfx("fiveX");
      }

      /* skitter tick under the centipede */
      if (stepCount % 3 === 0) sfx("step");

      cen.trail.unshift({ x: head.x, y: head.y });
      var maxTrail = cen.segs.length * CELL * 3 + 60;
      while (cen.trail.length > maxTrail) cen.trail.pop();
    }

    retrace(cen);

    if (cen.poison && frame % 24 === 0) {
      cen.trail.unshift({ x: cen.segs[0].x, y: cen.segs[0].y + CELL });
      cen.segs[0].y += CELL;
      retrace(cen);
      if (cen.segs[0].y >= ROWS * CELL) respawnCenti(cen);
    }
  }

  function respawnCenti(cen) {
    var segs = cen.segs, dir = (Math.random() < 0.5 ? 1 : -1);
    var startCol = dir === 1 ? 1 : COLS - 2;
    for (var i = 0; i < segs.length; i++) {
      segs[i].x = (startCol - dir * i) * CELL;
      segs[i].y = CELL;
    }
    cen.dir = dir; cen.trail = initTrail(segs, dir);
  }

  /* ── Scoring ──────────────────────────────────────────────────────── */
  function addScore(n) {
    score += n;
    if (score >= nextExtraLife) {
      nextExtraLife += 10000;
      lives = Math.min(9, lives + 1);
      sfx("extra");
      floats.push({ x: ship.x, y: PLAYER_TOP + 8, text: "EXTRA LIFE", color: "#ffe14d", life: 90 });
    }
    if (score > highScore) { highScore = score; try { localStorage.setItem("centipede_highscore", String(highScore)); } catch (e) {} }
  }

  /* ── Shot resolution vs centipede ────────────────────────────────── */
  function shotVsCenti(b) {
    for (var ci = 0; ci < centipedes.length; ci++) {
      var cen = centipedes[ci];
      for (var si = cen.segs.length - 1; si >= 0; si--) {
        var s = cen.segs[si];
        if (Math.abs(b.x - s.x - CELL / 2) < CELL * 0.75 && Math.abs(b.y - s.y - CELL / 2) < CELL * 0.75) {
          var mult = fiveX ? 5 : 1;
          addMushroom(cellOf(s.x), cellOf(s.y), false);
          if (si === 0) {
            /* HEAD KILL: the entire centipede dies (user-spec). No fractured
               body continues — body segments burst as particles for free. */
            if (cen.segs.length === 1) {
              addScore(200 * mult);
              floats.push({ x: s.x, y: s.y, text: "+200", color: "#ff5050", life: 70 });
              sfx("lastSeg");
              shake = Math.max(shake, 2.5);
            } else {
              addScore(100 * mult);
              floats.push({ x: s.x + CELL, y: s.y, text: "+" + 100 * mult, color: pal().head, life: 60 });
              sfx("headHit");
              shake = Math.max(shake, 2);
              /* burst every remaining body segment for a satisfying kill */
              for (var bi2 = 1; bi2 < cen.segs.length; bi2++)
                burstPx(cen.segs[bi2].x + CELL / 2, cen.segs[bi2].y + CELL / 2, pal().centi, 4);
            }
            var di = centipedes.indexOf(cen);
            if (di >= 0) centipedes.splice(di, 1);
          } else {
            addScore(10 * mult);
            floats.push({ x: s.x, y: s.y, text: "+" + 10 * mult, color: "#ffffff", life: 45 });
            var front = cen.segs.slice(0, si);
            var rear = cen.segs.slice(si + 1);
            cen.segs = front; cen.trail = initTrail(front, cen.dir);
            /* rear half becomes an independent centipede traveling the OPPOSITE
               direction so the two halves separate immediately (user spec) */
            if (rear.length > 0) {
              var rearDir = -cen.dir;
              var newCen = makeCentipede(rear, rearDir, initTrail(rear, rearDir), 0, cen.poison);
              newCen.maxSegs = cen.maxSegs;
              centipedes.push(newCen);
            }
            sfx("segHit");
          }
          burstPx(s.x + CELL / 2, s.y + CELL / 2, cen.poison ? POISON_COLOR : pal().centi, 8);
          flash = Math.max(flash, 0.12);
          return true;
        }
      }
    }
    return false;
  }

  /* ── Spider ───────────────────────────────────────────────────────── */
  /* Spider harassment is withheld until wave 3 (user-spec: first rounds are
     centipede-only) and stays GENTLE to wave 5 — slower hops, wider
     scattering, fewer mushrooms eaten — turning menacing at wave 6+. */
  var spiderTimer = 0;
  function spawnSpider() {
    if (spiders.length >= 2) return;
    var side = Math.random() < 0.5 ? 0 : FW - CELL;
    spiders.push({ x: side, y: PLAYER_TOP + Math.random() * (FH - PLAYER_TOP - CELL), vx: 0, vy: 0, jump: 0, age: 0, nib: 0 });
    sfx("spider");
  }

  function updateSpiders() {
    var gentle = wave <= 5;
    for (var i = spiders.length - 1; i >= 0; i--) {
      var s = spiders[i];
      s.age++;
      if (--s.jump <= 0) {
        var sp = gentle ? 1.1 + Math.min(0.5, s.age * 0.002) : 2.2 + Math.min(2.4, s.age * 0.004);
        var scatter = gentle ? 120 : 60;
        var ang = Math.atan2(ship.y - s.y + (Math.random() - 0.5) * scatter, ship.x - s.x + (Math.random() - 0.5) * scatter);
        s.vx = Math.cos(ang) * sp; s.vy = Math.abs(Math.sin(ang)) * sp * (Math.random() < 0.7 ? 1 : -1);
        s.jump = gentle ? 26 + Math.floor(Math.random() * 18) : 10 + Math.floor(Math.random() * 8);
      }
      s.x += s.vx; s.y += s.vy;
      if (s.x < 0) { s.x = 0; s.vx = Math.abs(s.vx); }
      if (s.x > FW - CELL) { s.x = FW - CELL; s.vx = -Math.abs(s.vx); }
      if (s.y < CELL) { s.y = CELL; s.vy = Math.abs(s.vy); }
      if (s.y > FH - CELL) { s.y = FH - CELL; s.vy = -Math.abs(s.vy); }
      var m = mushAt(cellOf(s.x), cellOf(s.y));
      /* gentle spiders nibble slowly: only every other mushroom until wave 6 */
      if (m && (!gentle || s.nib % 2 === 0)) {
        s.nib++;
        delete mush[mkey(m.c, m.r)]; puff(m.c * CELL + 4, m.r * CELL + 4, pal().spider, 5);
      }
    }
  }

  /* ── Scorpion ─────────────────────────────────────────────────────── */
  function spawnScorpion() {
    if (scorpions.length >= 1 || wave < 2) return;
    var dir = Math.random() < 0.5 ? 1 : -1;
    var r = 4 + Math.floor(Math.random() * 8);
    scorpions.push({ x: dir === 1 ? -CELL : FW, y: r * CELL, dir: dir, sp: 1.6 + wave * 0.05, step: 0 });
    sfx("scorpion");
  }

  function updateScorpions() {
    for (var i = scorpions.length - 1; i >= 0; i--) {
      var s = scorpions[i];
      s.x += s.dir * s.sp;
      var m = mushAt(cellOf(s.x), cellOf(s.y));
      if (m && !m.poison) { m.poison = true; m.hp = 4; puff(m.c * CELL + 4, m.r * CELL + 4, POISON_COLOR, 4); }
      if (++s.step % 40 === 0) s.y += CELL * (Math.random() < 0.5 ? 1 : -1);
      if (s.x < -CELL * 2 || s.x > FW + CELL) { scorpions.splice(i, 1); i--; }
    }
  }

  /* ── Flying saucer + rapid-fire orbs ─────────────────────────────── */
  var saucerTimer = 600;
  function updateSaucers() {
    if (wave >= 1 && saucers.length === 0) {
      if (--saucerTimer <= 0) {
        saucerTimer = 700 + Math.floor(Math.random() * 500);
        var dir = Math.random() < 0.5 ? 1 : -1;
        saucers.push({ x: dir === 1 ? -CELL * 2 : FW + CELL, y: PLAYER_TOP - 40 - Math.random() * 40, dir: dir, fire: 120 });
        sfx("saucer");
      }
    }
    for (var i = saucers.length - 1; i >= 0; i--) {
      var s = saucers[i];
      s.x += s.dir * 2.4;
      s.y += Math.sin(frame * 0.05 + i) * 0.4;
      if (--s.fire <= 0) {
        s.fire = 90 + Math.floor(Math.random() * 60);
        saucerShots.push({ x: s.x + 3, y: s.y + 6, vy: 3.2 });
        sfx("saucerShot");
      }
      if (s.x < -CELL * 3 || s.x > FW + CELL * 3) { saucers.splice(i, 1); i--; }
    }
    for (var j = saucerShots.length - 1; j >= 0; j--) {
      var b = saucerShots[j];
      b.y += b.vy;
      if (b.y > FH) { saucerShots.splice(j, 1); continue; }
      if (shipAlive() && Math.abs(b.x - ship.x) < 5 && Math.abs(b.y - ship.y) < 5) {
        saucerShots.splice(j, 1);
        killPlayer();
      }
    }
    /* power orbs drift down; collecting grants rapid fire */
    for (var k = powers.length - 1; k >= 0; k--) {
      var p = powers[k];
      p.y += 1.1; p.wob += 0.12;
      p.x += Math.sin(p.wob) * 0.5;
      if (p.y > FH - 4) { powers.splice(k, 1); continue; }
      if (shipAlive() && Math.abs(p.x - ship.x) < 8 && Math.abs(p.y - ship.y) < 9) {
        powers.splice(k, 1);
        rapid = Math.max(rapid, 480);
        addScore(50);
        floats.push({ x: ship.x, y: ship.y - 12, text: "RAPID FIRE!", color: "#ffe14d", life: 80 });
        sfx("powerup");
      }
    }
  }

  /* ── Bouncing mushrooms / fungi ──────────────────────────────────── */
  function spawnBurst(x, y) {
    sfx("boom");
    shake = Math.max(shake, 3);
    for (var k = 0; k < 6; k++) {
      var a = (k / 6) * Math.PI * 2 + Math.random() * 0.4;
      bounceShrooms.push({
        x: x, y: y, vx: Math.cos(a) * 2.2, vy: Math.sin(a) * 2.2 - 1,
        bounces: 4 + Math.floor(Math.random() * 4), timer: 120,
      });
    }
    puff(x + 4, y + 4, EXPLODING_COLOR, 14);
  }

  function updateBounces() {
    var hadFiveX = fiveX;
    fiveX = bounceShrooms.length > 0;
    if (fiveX && !hadFiveX) sfx("fiveX");
    for (var i = bounceShrooms.length - 1; i >= 0; i--) {
      var m = bounceShrooms[i];
      m.x += m.vx; m.y += m.vy;
      m.vy += 0.06;
      if (m.x < 0) { m.x = 0; m.vx = Math.abs(m.vx); }
      if (m.x > FW - CELL) { m.x = FW - CELL; m.vx = -Math.abs(m.vx); }
      if (m.y < 0) { m.y = 0; m.vy = Math.abs(m.vy); }
      if (m.y > FH - CELL) { m.y = FH - CELL; m.vy = -Math.abs(m.vy) * 0.9; m.bounces--; }
      var mu = mushAt(cellOf(m.x), cellOf(m.y));
      if (mu) { m.vy = -Math.abs(m.vy); m.y -= CELL * 0.5; }
      if (--m.timer <= 0 || m.bounces < 0) {
        addMushroom(cellOf(m.x), cellOf(m.y), false);
        bounceShrooms.splice(i, 1);
      } else if (frame % 10 === 0) sfx("bounce");
    }
  }

  var fungiTimer = 540;
  function updateFungi() {
    if (--fungiTimer <= 0) {
      fungiTimer = 900 + Math.floor(Math.random() * 600);
      if (fungi.length < 1) {
        fungi.push({ c: 2 + Math.floor(Math.random() * (COLS - 4)), r: 2, hp: 4 });
      }
    }
    for (var i = fungi.length - 1; i >= 0; i--) {
      var f = fungi[i];
      if (frame % 45 === 0) {
        var nr = f.r + 1;
        if (nr >= ROWS - 1 || mushAt(f.c, nr)) { fungi.splice(i, 1); }
        else { delete mush[mkey(f.c, nr)]; f.r = nr; }
      }
    }
  }

  /* ── Particles / float text ──────────────────────────────────────── */
  function puff(x, y, color, n) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2, sp2 = 0.4 + Math.random() * 1.6;
      particles.push({ x: x, y: y, vx: Math.cos(a) * sp2, vy: Math.sin(a) * sp2, life: 18 + Math.floor(Math.random() * 12), max: 30, color: color, g: 0 });
    }
  }
  function burstPx(x, y, color, n) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2, sp2 = 1 + Math.random() * 2.4;
      particles.push({ x: x, y: y, vx: Math.cos(a) * sp2, vy: Math.sin(a) * sp2, life: 24 + Math.floor(Math.random() * 14), max: 38, color: color, g: 0.02 });
    }
  }
  function updateFx() {
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.x += p.vx; p.y += p.vy; p.vy += p.g; p.vx *= 0.985;
      if (--p.life <= 0) particles.splice(i, 1);
    }
    for (var j = floats.length - 1; j >= 0; j--) {
      var f = floats[j];
      f.y -= 0.35;
      if (--f.life <= 0) floats.splice(j, 1);
    }
    if (shake > 0) shake *= 0.86;
    if (shake < 0.05) shake = 0;
    if (flash > 0) flash -= 0.02;
    if (bannerT > 0) bannerT--;
    if (rapid > 0) rapid--;
  }

  /* ── Starfield background ─────────────────────────────────────────── */
  function initStars() {
    stars.length = 0;
    for (var i = 0; i < 70; i++) {
      stars.push({ x: Math.random() * FW, y: Math.random() * FH, s: Math.random() < 0.75 ? 1 : 2, tw: Math.random() * Math.PI * 2, sp: 0.04 + Math.random() * 0.12 });
    }
  }

  /* ── Player death / flow ─────────────────────────────────────────── */
  function shipAlive() { return ship.alive && state === "playing"; }
  function killPlayer() {
    if (!shipAlive() || ship.inv > 0) return;
    ship.alive = false;
    lives--;
    sfx("hurt"); musicStop();
    burstPx(ship.x, ship.y, "#4dd7ff", 26);
    burstPx(ship.x, ship.y, "#ffe14d", 12);
    shake = 5; flash = 0.4;
    dyingT = 110;
    state = "dying";
  }
  function afterDeath() {
    if (lives > 0) {
      ship.x = FW / 2; ship.y = FH - 12;
      ship.vx = 0; ship.vy = 0;
      ship.alive = true; ship.inv = 150;
      bullets.length = 0; rapid = 0; powers.length = 0;
      spiders.length = 0; scorpions.length = 0; saucers.length = 0; saucerShots.length = 0;
      state = "playing";
      musicStart();
    } else {
      state = "gameover";
      attractFrame = 0;
      sfx("gameover");
    }
  }

  function startWave() {
    centipedes.length = 0;
    spiders.length = 0; scorpions.length = 0; saucers.length = 0; saucerShots.length = 0;
    bounceShrooms.length = 0; fungi.length = 0; powers.length = 0;
    bullets.length = 0;
    fiveX = false; rapid = 0; fireCd = 0;
    spawnWaveCentipede();
    if (Math.random() < 0.18 && wave > 3) bounceShrooms.push({ x: FW / 2, y: PLAYER_TOP, vx: 2.4, vy: -2, bounces: 6 + Math.floor(Math.random() * 4), timer: 420 });
    saucerTimer = wave >= 2 ? 500 + Math.floor(Math.random() * 400) : 1400;
    spiderTimer = 900 + Math.floor(Math.random() * 400);   /* wave-3 spiders enter after ~15s */
    fungiTimer = 480;
    ship.inv = 90;
    bannerT = 110;
    state = "playing";
    sfx("wave");
    musicStart();
  }

  function startGame() {
    score = 0; lives = 3; wave = 1; nextExtraLife = 10000;
    particles.length = 0; floats.length = 0;
    seedMushrooms();
    initStars();
    ship.x = FW / 2; ship.y = FH - 12; ship.vx = 0; ship.vy = 0; ship.alive = true; ship.inv = 90;
    startWave();
  }

  /* ── Input ────────────────────────────────────────────────────────── */
  var touchDrag = null;
  function initInput() {
    window.addEventListener("keydown", function (e) {
      getAudio();
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].indexOf(e.code) >= 0) e.preventDefault();
      keys[e.code] = true;
      if (e.code === "KeyM") toggleMute();
      if (e.code === "KeyP" || e.code === "Escape") {
        if (state === "playing" || state === "dying") { prevState = state; state = "paused"; musicStop(); }
        else if (state === "paused") { state = prevState; if (state === "playing") musicStart(); }
      }
      if (state === "attract" || state === "gameover") { if (e.code === "Space" || e.code === "Enter") startGame(); }
      if (e.code === "Space") fireHeld = true;
    });
    window.addEventListener("keyup", function (e) { keys[e.code] = false; if (e.code === "Space") fireHeld = false; });
    window.addEventListener("blur", function () { keys = {}; fireHeld = false; });
    window.addEventListener("resize", resize);

    var touchBtn = document.getElementById("fireBtn");
    if (touchBtn) {
      touchBtn.addEventListener("pointerdown", function (e) { e.preventDefault(); getAudio(); if (state !== "playing") { startGame(); return; } fireHeld = true; });
      touchBtn.addEventListener("pointerup", function (e) { e.preventDefault(); fireHeld = false; });
      touchBtn.addEventListener("pointercancel", function () { fireHeld = false; });
    }

    var muteBtn = document.getElementById("muteBtn");
    if (muteBtn) {
      muteBtn.addEventListener("pointerdown", function (e) { e.preventDefault(); getAudio(); toggleMute(); });
    }

    canvas.addEventListener("pointerdown", function (e) {
      getAudio();
      if (state !== "playing") { if (state !== "paused") startGame(); return; }
      touchDrag = toField(e.clientX, e.clientY);
    });
    window.addEventListener("pointermove", function (e) {
      if (touchDrag) touchDrag = toField(e.clientX, e.clientY);
    });
    window.addEventListener("pointerup", function () { touchDrag = null; });
  }

  function toField(clientX, clientY) {
    return { x: (clientX - OX) / SCALE, y: (clientY - OY) / SCALE };
  }

  function toggleMute() {
    muted = !muted;
    try { localStorage.setItem("centipede_muted", muted ? "1" : "0"); } catch (e) {}
    var mb = document.getElementById("muteBtn");
    if (mb) mb.textContent = muted ? "SOUND ON" : "MUTE";
    if (!muted) { getAudio(); if (state === "playing") musicStart(); } else musicStop();
  }

  function updateShip() {
    if (!ship.alive) return;
    var accel = 0.55, maxsp = 2.6, fric = 0.82;
    var dx = 0, dy = 0;
    if (keys.ArrowLeft || keys.KeyA) dx -= 1;
    if (keys.ArrowRight || keys.KeyD) dx += 1;
    if (keys.ArrowUp || keys.KeyW) dy -= 1;
    if (keys.ArrowDown || keys.KeyS) dy += 1;
    if (touchDrag) {
      var tdx = touchDrag.x - ship.x, tdy = touchDrag.y - ship.y;
      var d = Math.hypot(tdx, tdy);
      if (d > 2) { dx = tdx / d; dy = tdy / d; }
    }
    if (dx || dy) { var dd = Math.hypot(dx, dy); ship.vx += (dx / dd) * accel; ship.vy += (dy / dd) * accel; }
    ship.vx *= fric; ship.vy *= fric;
    var spd = Math.hypot(ship.vx, ship.vy);
    if (spd > maxsp) { ship.vx *= maxsp / spd; ship.vy *= maxsp / spd; }
    ship.x += ship.vx; ship.y += ship.vy;
    ship.x = Math.max(4, Math.min(FW - 4, ship.x));
    ship.y = Math.max(PLAYER_TOP, Math.min(FH - 4, ship.y));
    if (ship.inv > 0) ship.inv--;

    if (fireCd > 0) fireCd--;
    if (fireHeld && fireCd <= 0 && bullets.length < MAX_BULLETS) {
      bullets.push({ x: ship.x, y: ship.y - 8 });
      fireCd = rapid > 0 ? Math.max(4, FIRE_CD / 2) : FIRE_CD;
      sfx("shoot");
    }
    if (ship.inv <= 0) {
      for (var ci = 0; ci < centipedes.length; ci++) {
        var cen = centipedes[ci];
        for (var si = 0; si < cen.segs.length; si++) {
          var s = cen.segs[si];
          if (ship.x > s.x - 3 && ship.x < s.x + CELL + 3 && ship.y > s.y - 3 && ship.y < s.y + CELL + 3) { killPlayer(); return; }
        }
      }
      for (var j = 0; j < spiders.length; j++) {
        var spdr = spiders[j];
        if (Math.abs(spdr.x + 4 - ship.x) < 7 && Math.abs(spdr.y + 4 - ship.y) < 7) { killPlayer(); return; }
      }
      for (var k = 0; k < scorpions.length; k++) {
        var scp = scorpions[k];
        if (Math.abs(scp.x + 4 - ship.x) < 7 && Math.abs(scp.y + 4 - ship.y) < 7) { killPlayer(); return; }
      }
    }
    /* engine dust while thrusting */
    if ((dx || dy) && frame % 4 === 0) {
      particles.push({ x: ship.x - ship.vx * 2, y: ship.y + 6, vx: (Math.random() - 0.5) * 0.5, vy: 0.5 + Math.random() * 0.5, life: 10, max: 12, color: "#ffaa3c", g: 0.01 });
    }
  }

  function updateBullets() {
    for (var bi = bullets.length - 1; bi >= 0; bi--) {
      var bullet = bullets[bi];
      var hit = false;
      bullet.y -= 6;
      if (bullet.y < -CELL) { hit = true; }
      if (!hit && shotVsCenti(bullet)) { hit = true; }
      if (!hit) {
        for (var j = 0; j < spiders.length; j++) {
          var s = spiders[j];
          if (bullet.x > s.x - 2 && bullet.x < s.x + CELL + 2 && bullet.y > s.y - 2 && bullet.y < s.y + CELL + 2) {
            spiders.splice(j, 1); hit = true; addScore(75);
            floats.push({ x: s.x, y: s.y, text: "+75", color: pal().spider, life: 55 });
            burstPx(s.x + 4, s.y + 4, pal().spider, 10); sfx("boom"); shake = Math.max(shake, 1.5);
            break;
          }
        }
      }
      if (!hit) {
        for (var k = 0; k < scorpions.length; k++) {
          var sc = scorpions[k];
          if (bullet.x > sc.x - 2 && bullet.x < sc.x + CELL + 6 && bullet.y > sc.y - 2 && bullet.y < sc.y + CELL + 2) {
            scorpions.splice(k, 1); hit = true; addScore(100);
            floats.push({ x: sc.x, y: sc.y, text: "+100", color: pal().scorp, life: 55 });
            burstPx(sc.x + 4, sc.y + 4, pal().scorp, 10); sfx("boom"); shake = Math.max(shake, 1.5);
            break;
          }
        }
      }
      if (!hit) {
        for (var q = saucers.length - 1; q >= 0; q--) {
          var sa = saucers[q];
          if (bullet.x > sa.x - 4 && bullet.x < sa.x + CELL + 8 && bullet.y > sa.y - 2 && bullet.y < sa.y + CELL) {
            saucers.splice(q, 1); hit = true; addScore(50);
            floats.push({ x: sa.x, y: sa.y, text: "+50", color: pal().saucer, life: 55 });
            burstPx(sa.x + 4, sa.y + 4, pal().saucer, 14); sfx("boom"); shake = Math.max(shake, 2);
            spawnSpider(); spawnSpider();
            /* modern QoL: saucer drops a rapid-fire orb */
            powers.push({ x: sa.x + 4, y: sa.y + 4, wob: Math.random() * 6 });
            break;
          }
        }
      }
      if (!hit) {
        for (var z = 0; z < bounceShrooms.length; z++) {
          var bm = bounceShrooms[z];
          if (Math.abs(bm.x + 4 - bullet.x) < 6 && Math.abs(bm.y + 4 - bullet.y) < 6) {
            bounceShrooms.splice(z, 1); hit = true; addScore(100);
            floats.push({ x: bm.x, y: bm.y, text: "+100", color: BOUNCE_COLOR, life: 55 });
            addMushroom(cellOf(bm.x), cellOf(bm.y), false);
            sfx("segHit");
            break;
          }
        }
      }
      if (!hit) {
        for (var f2 = 0; f2 < fungi.length; f2++) {
          var fu = fungi[f2];
          if (Math.abs(fu.c * CELL + 4 - bullet.x) < 5 && Math.abs(fu.r * CELL + 4 - bullet.y) < 5) {
            fungi.splice(f2, 1); hit = true; addScore(10);
            addMushroom(fu.c, fu.r, false);
            sfx("segHit");
            break;
          }
        }
      }
      if (!hit) {
        var m = mushAt(cellOf(bullet.x), cellOf(bullet.y - 2));
        if (m) { hit = true; hitMushroom(m); }
      }
      if (hit) bullets.splice(bi, 1);
    }
  }

  /* ── Update ───────────────────────────────────────────────────────── */
  function update() {
    frame++;
    if (state === "paused") return;
    if (state === "attract" || state === "gameover") { attractFrame++; updateFx(); return; }
    if (state === "dying") { if (--dyingT <= 0) afterDeath(); updateFx(); return; }
    if (state === "waveclear") {
      if (--waveClearT <= 0) { wave++; startWave(); }
      updateFx(); updateBullets();
      return;
    }

    updateShip();
    updateBullets();
    if (!frozen) { for (var i = centipedes.length - 1; i >= 0; i--) updateCenti(centipedes[i]); }
    updateSpiders();
    updateScorpions();
    updateSaucers();
    updateBounces();
    updateFungi();
    updateFx();

    /* spider harassment withheld until wave 3 (user-spec); deterministic-ish
       timer so waves 1-2 stay centipede-only */
    if (wave >= 3) {
      if (--spiderTimer <= 0) {
        spiderTimer = wave <= 5 ? 1400 + Math.floor(Math.random() * 800) : 700 + Math.floor(Math.random() * 500);
        spawnSpider();
      }
    }
    if (Math.random() < 0.0010) spawnScorpion();

    if (centipedes.length === 0 && state === "playing") {
      waveClearT = 110;
      bannerT = 110;
      state = "waveclear";
      sfx("wave");
    }
  }

  /* ── Resize / mapping ─────────────────────────────────────────────── */
  function resize() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.floor(W * DPR); canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    var hudH = 34;
    SCALE = Math.min((W - 16) / FW, (H - hudH - 20) / FH);
    SCALE = Math.max(0.5, Math.min(SCALE, 6));
    OX = Math.floor((W - FW * SCALE) / 2);
    OY = Math.floor(hudH + (H - hudH - FH * SCALE) / 2);
  }

  /* ── Drawing helpers ──────────────────────────────────────────────── */
  var legFrame = 0, animT = 0;
  function px(x) { return OX + x * SCALE; }
  function py(y) { return OY + y * SCALE; }

  function text(t, x, y, size, color, align, glowAmt) {
    ctx.font = "bold " + size + "px 'Courier New', monospace";
    ctx.textAlign = align || "left";
    ctx.textBaseline = "top";
    if (glowAmt !== 0) { ctx.shadowColor = color; ctx.shadowBlur = glowAmt || 8; }
    ctx.fillStyle = color;
    ctx.fillText(t, x, y);
    ctx.shadowBlur = 0;
  }

  /* ── Render ───────────────────────────────────────────────────────── */
  function drawBackground() {
    /* deep space gradient */
    var gr = ctx.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, "#03040c");
    gr.addColorStop(0.55, "#05081a");
    gr.addColorStop(1, "#03040a");
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, W, H);
    /* twinkling starfield inside playfield */
    var P = pal();
    for (var i = 0; i < stars.length; i++) {
      var st = stars[i];
      st.tw += st.sp;
      var a = 0.25 + Math.abs(Math.sin(st.tw)) * 0.45;
      ctx.fillStyle = "rgba(200,220,255," + a.toFixed(2) + ")";
      ctx.fillRect(px(st.x), py(st.y), Math.max(1, st.s * SCALE * 0.5), Math.max(1, st.s * SCALE * 0.5));
    }
    /* playfield grid dots */
    ctx.fillStyle = P.grid;
    for (var gx = 0; gx <= COLS; gx += 2) {
      for (var gy = 0; gy <= ROWS; gy += 2) {
        ctx.fillRect(px(gx * CELL), py(gy * CELL), 1, 1);
      }
    }
    /* player lane hint */
    ctx.fillStyle = rgba(P.border, 0.05);
    ctx.fillRect(px(0), py(PLAYER_TOP), FW * SCALE, (FH - PLAYER_TOP) * SCALE);
  }

  function drawField() {
    var P = pal();
    /* neon frame with corner brackets */
    ctx.strokeStyle = rgba(P.border, 0.9);
    ctx.shadowColor = P.border; ctx.shadowBlur = 10;
    ctx.lineWidth = 2;
    ctx.strokeRect(OX - 3, OY - 3, FW * SCALE + 6, FH * SCALE + 6);
    ctx.shadowBlur = 0;
    var L = 16;
    ctx.strokeStyle = P.border; ctx.lineWidth = 3;
    var cs = [[OX - 3, OY - 3, 1, 1], [OX + FW * SCALE + 3, OY - 3, -1, 1], [OX - 3, OY + FH * SCALE + 3, 1, -1], [OX + FW * SCALE + 3, OY + FH * SCALE + 3, -1, -1]];
    for (var i = 0; i < 4; i++) {
      var c = cs[i];
      ctx.beginPath();
      ctx.moveTo(c[0] + L * c[2], c[1]); ctx.lineTo(c[0], c[1]); ctx.lineTo(c[0], c[1] + L * c[3]);
      ctx.stroke();
    }
  }

  function drawEntities() {
    var S = sprSet();
    var k;
    /* mushrooms */
    for (k in mush) {
      var m = mush[k];
      var spr = m.poison ? S.mush["p" + m.hp] : (m.expl > 0 && frame % 20 < 10 ? S.mush["e" + m.hp] : S.mush[m.hp]);
      blit(spr, m.c * CELL + CELL / 2, m.r * CELL + CELL / 2);
    }
    for (k = 0; k < fungi.length; k++) blit(S.fungus, fungi[k].c * CELL + CELL / 2, fungi[k].r * CELL + CELL / 2, 0.6 + Math.sin(animT * 4 + k) * 0.2);
    for (k = 0; k < bounceShrooms.length; k++) {
      var bm = bounceShrooms[k];
      blit(S.bounce, bm.x + CELL / 2, bm.y + CELL / 2);
    }
    /* centipedes: elongated capsule body — each segment stretches along
       the axis toward the head (inchworm crawl), tapers to the tail,
       head flips with direction and snaps jaws open while chomping.
       Sprites bake facing left-thick/right-tail, so the local +x axis
       points backward; rotating by (ax+PI) faces each piece forward. */
    var lf = legFrame;
    for (k = 0; k < centipedes.length; k++) {
      var cen = centipedes[k];
      if (!cen) continue;
      var n = cen.segs.length;
      var bob = cen.acc % CELL;
      if (cen.chomp > 0 && state === "playing") cen.chomp--;
      for (var si = n - 1; si >= 0; si--) {
        var sg = cen.segs[si];
        var slot = Math.min(25, Math.round(si / Math.max(1, n - 1) * 25));
        var spr;
        if (si === 0) {
          spr = (cen.chomp > 0 ? (cen.poison ? S.headPoisonOpen : S.headOpen)
                               : (cen.poison ? S.headPoison : S.head));
        } else {
          var fr = (lf + si) % 2;
          spr = (cen.poison ? S.segPoison[slot] : S.seg[slot])[fr];
        }
        /* axis toward neighbor; degenerate -> straight backward */
        var nb = si === 0 ? cen.segs[1] : cen.segs[si - 1];
        var dx = nb ? sg.x - nb.x : -cen.dir * CELL;
        var dy = nb ? sg.y - nb.y : 0;
        var dd = Math.hypot(dx, dy);
        if (dd < 0.5 || dd > CELL * 2) { dx = -cen.dir * CELL; dy = 0; dd = CELL; }
        var ax = Math.atan2(dy, dx);              /* backward axis */
        if (si === 0) ax += Math.PI;              /* head jaws face forward */
        var ch = 1 - (si / Math.max(1, n - 1)) * 0.3;   /* taper to tail */
        var stretch = si === 0 ? 1 : Math.min(1.25, (dd + CELL * 0.35) / (CELL * 1.9));
        var wob = Math.sin(animT * 10 + si * 0.9) * 0.6;
        var cx = px(sg.x + CELL / 2 + (si === 0 ? cen.dir * bob * 0.3 : 0));
        var cy = py(sg.y + CELL / 2 + wob * 0.4);
        var dw = spr.w * SCALE * stretch, dh = spr.h * SCALE * ch;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(ax);
        ctx.drawImage(spr.cv, -dw / 2, -dh / 2, dw, dh);
        ctx.restore();
      }
    }
    for (k = 0; k < spiders.length; k++) blit(S.spider[legFrame % 2], spiders[k].x + CELL / 2, spiders[k].y + CELL / 2);
    for (k = 0; k < scorpions.length; k++) {
      var sc = scorpions[k];
      var spr2 = S.scorpion[legFrame % 2];
      /* flip horizontally when moving left */
      if (sc.dir === -1) {
        ctx.save();
        ctx.translate(px(sc.x + CELL / 2), py(sc.y + CELL / 2));
        ctx.scale(-1, 1);
        ctx.drawImage(spr2.cv, -spr2.w * SCALE / 2, -spr2.h * SCALE / 2, spr2.w * SCALE, spr2.h * SCALE);
        ctx.restore();
      } else {
        blit(spr2, sc.x + CELL / 2, sc.y + CELL / 2);
      }
    }
    for (k = 0; k < saucers.length; k++) blit(S.saucer[frame % 16 < 8 ? 0 : 1], saucers[k].x + CELL / 2 + 4, saucers[k].y + CELL / 2);
    /* power orbs */
    for (k = 0; k < powers.length; k++) blit(S.orb[frame % 12 < 6 ? 0 : 1], powers[k].x, powers[k].y);
    /* saucer shots */
    for (k = 0; k < saucerShots.length; k++) {
      var ss = saucerShots[k];
      ctx.fillStyle = "#ff6a3c";
      ctx.shadowColor = "#ff6a3c"; ctx.shadowBlur = 8;
      ctx.fillRect(px(ss.x) - 1.5 * SCALE, py(ss.y) - 4 * SCALE, 3 * SCALE, 8 * SCALE);
      ctx.shadowBlur = 0;
    }
    /* player bullets */
    for (k = 0; k < bullets.length; k++) blit(S.bullet, bullets[k].x, bullets[k].y);
    /* ship */
    if (ship.alive) {
      if (ship.inv > 0 && Math.floor(frame / 4) % 2 === 0) {
        blit(S.ship[Math.floor(animT * 10) % 2], ship.x, ship.y, 0.35);
      } else {
        if (rapid > 0) {
          ctx.strokeStyle = rgba("#ffe14d", 0.5 + Math.sin(animT * 12) * 0.25);
          ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(px(ship.x), py(ship.y), 11 * SCALE, 0, Math.PI * 2); ctx.stroke();
        }
        blit(S.ship[Math.floor(animT * 10) % 2], ship.x, ship.y);
      }
    }
    /* particles */
    for (k = 0; k < particles.length; k++) {
      var p = particles[k];
      var pc = S.part[p.color];
      if (!pc) { pc = bakeParticles(p.color); S.part[p.color] = pc; }
      blit(pc, p.x, p.y, Math.max(0, p.life / p.max));
    }
  }

  function drawHUD() {
    var P = pal();
    var topY = Math.max(2, OY - 30);
    /* top bar panel */
    ctx.fillStyle = "rgba(4,8,18,0.8)";
    ctx.fillRect(0, 0, W, Math.max(0, OY - 1));
    ctx.strokeStyle = rgba(P.border, 0.35);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, OY - 1.5); ctx.lineTo(W, OY - 1.5); ctx.stroke();

    text("1UP", OX + 4, topY + 2, 12, "#ff5050");
    text(String(score).padStart(6, "0"), OX + 40, topY + 1, 15, "#ffffff");
    text("HI", W / 2 - 44, topY + 2, 12, "#ffe14d");
    text(String(highScore).padStart(6, "0"), W / 2 - 22, topY + 1, 15, "#ffe14d");
    text("WAVE " + wave, OX + FW * SCALE - 78, topY + 2, 12, P.centi);

    /* lives as mini-ship glyphs bottom-right */
    for (var i = 0; i < lives; i++) {
      var lx = OX + FW * SCALE - 16 - i * 15, ly = OY + FH * SCALE + 8;
      ctx.fillStyle = "#4dd7ff";
      ctx.shadowColor = "#4dd7ff"; ctx.shadowBlur = 5;
      ctx.beginPath();
      ctx.moveTo(lx + 4, ly - 4); ctx.lineTo(lx + 7, ly + 2); ctx.lineTo(lx + 1, ly + 2);
      ctx.closePath(); ctx.fill();
      ctx.fillRect(lx, ly + 2, 8, 2.5);
      ctx.shadowBlur = 0;
    }
    if (fiveX) {
      var pulse = 0.7 + Math.sin(animT * 10) * 0.3;
      text("x5 SCORE!", OX + 6, OY + FH * SCALE + 4, 13, rgba(BOUNCE_COLOR, pulse));
    }
    if (rapid > 0) {
      var rw = 60 * (rapid / 480);
      ctx.fillStyle = rgba("#ffe14d", 0.8);
      ctx.fillRect(OX + FW * SCALE - rw - 4, OY + FH * SCALE + 5, rw, 3);
    }
  }

  function drawBanners() {
    var cx = W / 2, cy = OY + FH * SCALE / 2;
    if (state === "waveclear" && bannerT > 0) {
      var s = 1 + Math.max(0, (bannerT - 80)) / 30 * 0.4;
      ctx.save();
      ctx.translate(cx, cy - 10);
      ctx.scale(s, s);
      text("WAVE " + wave + " CLEAR", 0, 0, 22, "#ffe14d", "center", 14);
      ctx.restore();
    }
    if (state === "playing" && bannerT > 0) {
      var a = Math.min(1, bannerT / 40);
      text("WAVE " + wave, cx, OY + 26, 20, rgba(pal().centi, a), "center", 12);
      if (wave % 2 === 0) text("slow wave — bank it", cx, OY + 50, 11, rgba("#ffffff", a * 0.7), "center", 0);
      else text("fast wave — hang on", cx, OY + 50, 11, rgba("#ffffff", a * 0.7), "center", 0);
    }
    if (state === "paused") {
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, 0, W, H);
      text("PAUSED", cx, cy - 14, 26, "#39d7ff", "center", 16);
      if (frame % 60 < 36) text("press P or ESC to resume", cx, cy + 18, 12, "#ffffff", "center", 0);
    }
    /* float texts */
    for (var k = 0; k < floats.length; k++) {
      var f = floats[k];
      ctx.globalAlpha = Math.min(1, f.life / 25);
      text(f.text, px(f.x), py(f.y), 11, f.color, "center");
      ctx.globalAlpha = 1;
    }
  }

  function drawGameOver() {
    var cx = W / 2, cy = OY + FH * SCALE / 2;
    ctx.fillStyle = "rgba(0,0,0,0.62)";
    ctx.fillRect(0, 0, W, H);
    var pulse = 0.75 + Math.sin(animT * 5) * 0.25;
    text("GAME OVER", cx, cy - 44, 30, rgba("#ff4040", pulse), "center", 18);
    text("SCORE  " + String(score).padStart(6, "0"), cx, cy - 2, 16, "#ffffff", "center", 8);
    text("WAVE REACHED  " + wave, cx, cy + 22, 12, "#3fe08a", "center", 0);
    if (score >= highScore && score > 0) text("NEW HIGH SCORE!", cx, cy + 44, 14, rgba("#ffe14d", 0.7 + Math.sin(animT * 8) * 0.3), "center", 12);
    if (frame % 60 < 36) text("PRESS FIRE TO PLAY AGAIN", cx, cy + 70, 13, "#ffe14d", "center", 6);
  }

  /* ── Attract screen: AAA cinematic title ────────────────────────── */
  /* Composition rules: dark stage, one hero element (title), one demo
     element (serpentine centipede descending on a smooth sine), sparse
     typographic stack. No child-doodle crossing patterns. */
  function drawAttract() {
    var cx = W / 2;
    var P = PALETTES[Math.floor(attractFrame / 240) % PALETTES.length];
    var t = attractFrame / 60;
    var fw = FW * SCALE, fh = FH * SCALE;
    var fx = OX, fy = OY;

    /* slow-breathing spotlight behind the title */
    var breath = 0.5 + Math.sin(t * 0.8) * 0.18;
    var spot = ctx.createRadialGradient(cx, fy + fh * 0.30, 8, cx, fy + fh * 0.30, fw * 0.62);
    spot.addColorStop(0, rgba(P.border, 0.16 * breath));
    spot.addColorStop(0.55, rgba(P.border, 0.05 * breath));
    spot.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = spot;
    ctx.fillRect(fx, fy, fw, fh);

    /* drifting horizon glow at the player lane */
    var hor = ctx.createLinearGradient(0, fy + fh * 0.72, 0, fy + fh);
    hor.addColorStop(0, "rgba(0,0,0,0)");
    hor.addColorStop(1, rgba(P.centi, 0.10));
    ctx.fillStyle = hor;
    ctx.fillRect(fx, fy + fh * 0.72, fw, fh * 0.28);

    /* ── hero title: chromatic split + vertical gradient fill ── */
    var ts = Math.max(26, Math.min(46, fw * 0.115));
    var ty = fy + fh * 0.14;
    var wob = Math.sin(t * 2.1) * 2.2;
    text("CENTIPEDE", cx - 2.4 - wob * 0.35, ty, ts, rgba("#ff2f5e", 0.55), "center", 26);
    text("CENTIPEDE", cx + 2.4 + wob * 0.35, ty, ts, rgba("#2fb9ff", 0.55), "center", 26);
    ctx.font = "bold " + ts + "px 'Courier New', monospace";
    var tg = ctx.createLinearGradient(0, ty, 0, ty + ts);
    tg.addColorStop(0, "#ffffff");
    tg.addColorStop(0.55, mix(P.centi, "#ffffff", 0.25));
    tg.addColorStop(1, mix(P.centi, "#062a14", 0.35));
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.shadowColor = P.centi; ctx.shadowBlur = 22;
    ctx.fillStyle = tg;
    ctx.fillText("CENTIPEDE", cx, ty);
    ctx.shadowBlur = 0;

    /* animated light-streak underline */
    var uw = fw * 0.5, ux = cx - uw / 2, uy = ty + ts + 8;
    ctx.fillStyle = rgba(P.border, 0.28);
    ctx.fillRect(ux, uy, uw, 2);
    var streakPos = ux + ((attractFrame * 2.4) % (uw + 90)) - 45;
    var sg = ctx.createLinearGradient(streakPos - 40, 0, streakPos + 40, 0);
    sg.addColorStop(0, "rgba(255,255,255,0)");
    sg.addColorStop(0.5, "#ffffff");
    sg.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = sg;
    ctx.fillRect(Math.max(ux, streakPos - 40), uy - 0.5, Math.min(80, ux + uw - Math.max(ux, streakPos - 40)), 3);

    /* subtitle kicker */
    text("A MODERN ARCADE REMAKE", cx, uy + 10, Math.max(9, ts * 0.26), rgba("#cfe9d8", 0.75), "center", 4);

    /* ── demo centipede: graceful descending sine sweep ── */
    var S = sprSet();
    var N = 12;
    var DSCALE = 1.7;                       /* hero showcase scale */
    var amp = fh * 0.06;
    var cyc = fw + 240;
    var lead = (attractFrame * 1.05) % cyc;
    /* head (i=0) LEADS at max x; body trails behind (lead - i*spacing).
       Iterate tail->head so head composites on top; tangent is computed
       from the trailing neighbor toward the head (forward axis). */
    var posX = [], posY = [];
    for (var i2 = 0; i2 < N; i2++) {
      posX[i2] = fx - 80 + ((lead - i2 * CELL * 1.7) % cyc + cyc) % cyc;
      var kx2 = (posX[i2] - fx) / fw;
      posY[i2] = fy + fh * 0.42 + Math.sin(kx2 * Math.PI * 2.0 - t * 1.15) * amp + kx2 * fh * 0.08;
    }
    for (var i = N - 1; i >= 0; i--) {
      var px_ = posX[i], py_ = posY[i];
      if (px_ < fx - 30 || px_ > fx + fw + 30) continue;
      /* forward vector: toward the neighbor closer to the head */
      var nb = i === 0 ? null : i - 1;
      var ax = 0;
      if (nb !== null) {
        var ddx = posX[nb] - px_, ddy = posY[nb] - py_;
        if (Math.abs(ddx) > 0.3 || Math.abs(ddy) > 0.3) ax = Math.atan2(ddy, ddx);
      }
      var slot = Math.round(i / (N - 1) * 25);
      ctx.save();
      ctx.translate(px_, py_);
      ctx.rotate(ax);
      var spr = (i === 0) ? S.head : S.seg[slot][Math.floor(attractFrame / 7 + i) % 2];
      var dw = spr.w * SCALE * DSCALE, dh = spr.h * SCALE * DSCALE;
      ctx.globalAlpha = 0.97;
      /* head bake faces RIGHT (+x forward); body bake forward-axis is -x */
      if (i !== 0) ctx.rotate(Math.PI);
      ctx.drawImage(spr.cv, -dw / 2, -dh / 2, dw, dh);
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    /* ── info stack: compact AAA feature strip (measured gutter columns) ── */
    var iy = fy + fh * 0.60;
    var feats = [
      ["SHOOT THE HEAD", "KILLS IT ENTIRELY", P.centi],
      ["BREAK ITS BODY", "IT SPLITS", "#ffe14d"],
      ["RIDE THE GALLOP", "INTENSE ARCADE MUSIC", "#39d7ff"],
    ];
    text("— HOW TO PLAY —", cx, iy - 16, 10, rgba("#b8cfdc", 0.95), "center", 2);
    ctx.font = "bold 11px 'Courier New', monospace";
    var lw = 0;
    for (var fi0 = 0; fi0 < feats.length; fi0++) lw = Math.max(lw, ctx.measureText(feats[fi0][0]).width);
    var colR = cx - lw - 8, colL = cx + 8;
    for (var fi = 0; fi < feats.length; fi++) {
      var fy_ = iy + 8 + fi * 18;
      var fade = 0.8 + Math.sin(t * 2 + fi * 1.3) * 0.2;
      text("\u25B8 " + feats[fi][0], colR, fy_, 11, rgba("#eafff2", fade), "right", 2);
      text(feats[fi][1], colL, fy_, 11, rgba(feats[fi][2], fade), "left", 6);
    }

    /* ── CTA: pulsing underline + PRESS FIRE TO START ── */
    var ctaY = fy + fh - 46;
    var ctaPulse = 0.7 + Math.sin(t * 4.5) * 0.3;
    if (frame % 90 < 62) text("PRESS FIRE TO START", cx, ctaY, 15, rgba("#ffffff", ctaPulse), "center", 12);
    ctx.fillStyle = rgba(P.border, 0.35 + Math.sin(t * 4.5) * 0.15);
    ctx.fillRect(cx - 92, ctaY + 20, 184, 2);
    text("HI-SCORE " + String(highScore).padStart(6, "0"), cx, fy + fh - 24, 12, rgba("#ffe14d", 0.85), "center", 6);
    text("ARROWS/WASD MOVE · SPACE FIRE · P PAUSE · M MUTE", cx, fy + fh - 8, 9, rgba("#9fb4c4", 0.8), "center", 0);
  }

  function render() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    legFrame = Math.floor(frame / 6) % 2;
    animT = frame / 60;

    /* screen shake */
    if (shake > 0) {
      ctx.translate((Math.random() - 0.5) * shake * SCALE, (Math.random() - 0.5) * shake * SCALE);
    }

    drawBackground();

    if (state === "attract") { drawField(); drawAttract(); ctx.setTransform(DPR, 0, 0, DPR, 0, 0); return; }

    drawEntities();
    drawField();
    drawHUD();
    drawBanners();

    if (state === "gameover") drawGameOver();

    /* hit flash */
    if (flash > 0) {
      ctx.fillStyle = "rgba(255,255,255," + Math.max(0, flash).toFixed(3) + ")";
      ctx.fillRect(-8, -8, W + 16, H + 16);
    }
    /* subtle vignette, alpha-capped (never compounds) */
    var vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.42, W / 2, H / 2, Math.max(W, H) * 0.72);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.28)");
    ctx.fillStyle = vg;
    ctx.fillRect(-8, -8, W + 16, H + 16);

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }

  /* ── Boot / loop ──────────────────────────────────────────────────── */
  var lastT = 0, accT = 0;
  function loop(now) {
    if (!lastT) lastT = now;
    accT += now - lastT; lastT = now;
    if (accT > FD * 5) accT = FD * 5;
    while (accT >= FD) { update(); accT -= FD; }
    musicTick();
    render();
    requestAnimationFrame(loop);
  }

  function init() {
    resize();
    initInput();
    seedMushrooms();
    initStars();
    var mb = document.getElementById("muteBtn");
    if (mb) mb.textContent = muted ? "SOUND ON" : "MUTE";
    requestAnimationFrame(loop);
  }

  init();

  /* ── Test hooks ───────────────────────────────────────────────────── */
  window._state = function () { return state; };
  window._startGame = function () { startGame(); };
  window._step = function (n) { for (var i = 0; i < (n || 1); i++) update(); };
  window._score = function () { return score; };
  window._addScore = function (n) { addScore(n); };
  window._lives = function () { return lives; };
  window._wave = function () { return wave; };
  window._ship = function () { return ship; };
  window._bullets = function () { return bullets; };
  window._bullet = function () { return bullets[0] || null; };
  window._centipedes = function () { return centipedes; };
  window._mush = function () { return mush; };
  window._mushAt = function (c, r) { return mushAt(c, r); };
  window._spiders = function () { return spiders; };
  window._scorpions = function () { return scorpions; };
  window._saucers = function () { return saucers; };
  window._saucerShots = function () { return saucerShots; };
  window._powers = function () { return powers; };
  window._bounceShrooms = function () { return bounceShrooms; };
  window._fiveX = function () { return fiveX; };
  window._rapid = function () { return rapid; };
  window._shotVsCenti = shotVsCenti;
  window._makeCenti = function (segs, dir) { return makeCentipede(segs, dir, null, 0, false); };
  window._forceShoot = function (x, y) { bullets.push({ x: x, y: y + 8 }); updateBullets(); };
  window._spawnWave = spawnWaveCentipede;
  window._keepAlive = function () { ship.inv = 999999; };
  window._testReset = function () { state = "playing"; ship.alive = true; ship.inv = 999999; };
  window._freeze = function (v) { frozen = !!v; };
  window._setLives = function (n) { lives = n; };
  window._spawnSpider = spawnSpider;
  window._spawnScorpion = function () { wave = Math.max(wave, 2); spawnScorpion(); };
  window._addMushroom = addMushroom;
  window._spawnBurst = spawnBurst;
  window._killPlayer = killPlayer;
  window._speedCells = speedCells;
  window._consts = { COLS: COLS, ROWS: ROWS, CELL: CELL, MAX_BULLETS: MAX_BULLETS };
})();
