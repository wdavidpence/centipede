/* ═══════════════════════════════════════════════════════════════════
   CENTIPEDE — faithful browser recreation of the 1981 Atari arcade
   classic (design: Ed Logg / Dona Bailey). Original code, no ROMs.

   FIDELITY MODEL (original arcade rules):
     • Grid-based world: 30 cols x 28 rows of 8px cells (240x224 field).
     • The centipede snakes across the field one cell at a time,
       zig-zagging vertically. ONLY THE HEAD drops a row and reverses
       when blocked (wall or mushroom); the body follows via a trail
       buffer, producing organic winding descent.
     • Shooting a BODY segment (10 pts): segment becomes a mushroom,
       centipede splits into two; BOTH halves continue in the SAME
       direction (NOT reversed).
     • Shooting the HEAD (100 pts): head becomes a mushroom, remaining
       body continues as a new centipede.
     • Shooting the LAST remaining segment: +200 bonus.
     • Mushrooms take 4 hits (visibly shrink), 5 pts each hit.
     • Poison mushrooms (from scorpions) turn a touching centipede
       purple; poisoned centipedes plunge downward faster.
     • Scorpion (100 pts): scuttles across, poisoning mushrooms.
     • Spider (75 pts): erratic jumps, eats mushrooms, speeds up.
     • Flying saucer (50 pts): periodic visitor, fires at the player,
       drops spiders when destroyed.
     • Solitary bouncing mushroom: while it bounces, all centipede
       hits score 5x (head 500 / body 50).
     • Exploding mushrooms burst into six bouncing mushrooms.
     • One player bullet on screen at a time (trackball rule).
     • Player bounded to the bottom ~half of the field.
     • Extra life every 10,000 points (max 9).
     • Odd waves are fast, even waves slow; segment count grows.
     • Authentic stage color cycling + attract mode score table.
     ═══════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  /* ── Canvas / DOM ──────────────────────────────────────────────────── */
  var canvas = document.getElementById("game");
  var ctx = canvas.getContext("2d", { alpha: false });
  var W = 0, H = 0, SCALE = 1, OX = 0, OY = 0;

  /* ── Grid constants (authentic proportions) ─────────────────────── */
  var CELL = 8;
  var COLS = 30, ROWS = 28;
  var FW = COLS * CELL;          /* 240 */
  var FH = ROWS * CELL;          /* 224 */
  var PLAYER_TOP = FH * 0.52;    /* player stays below this y */
  var MUSH_TOP_ROW = 1;
  var MUSH_BOTTOM_ROW = ROWS - 2;

  /* ── Stage palettes (cycled by wave, authentic-feel hues) ───────── */
  var PALETTES = [
    { centi: "#33ff33", head: "#33ff33", mush: "#33ff33", spider: "#ff33cc", scorp: "#ff9900", saucer: "#ffff33", border: "#00ff44" },
    { centi: "#33ccff", head: "#33ccff", mush: "#44ff88", spider: "#ff66ff", scorp: "#ffcc00", saucer: "#ffffff", border: "#00ff44" },
    { centi: "#ffff33", head: "#ffff33", mush: "#44ff88", spider: "#ff3399", scorp: "#ff9900", saucer: "#33ccff", border: "#00ff44" },
    { centi: "#ff6633", head: "#ff6633", mush: "#44ff88", spider: "#cc66ff", scorp: "#ff3333", saucer: "#ffff33", border: "#00ff44" },
    { centi: "#cc66ff", head: "#cc66ff", mush: "#44ff88", spider: "#ff66aa", scorp: "#ff9900", saucer: "#ffffff", border: "#00ff44" },
    { centi: "#ff99bb", head: "#ff99bb", mush: "#44ff88", spider: "#33ccff", scorp: "#ffcc00", saucer: "#ffff33", border: "#00ff44" }
  ];
  var POISON_COLOR = "#cc33ff";
  var BOUNCE_COLOR = "#ffffff";
  var EXPLODING_COLOR = "#ffdd00";

  function pal() { return PALETTES[(wave - 1) % PALETTES.length]; }

  /* ── Audio (Web Audio) ────────────────────────────────────────────── */
  var audioCtx = null, masterGain = null, muted = false;
  function getAudio() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      if (!audioCtx) {
        audioCtx = new AC();
        masterGain = audioCtx.createGain();
        masterGain.gain.value = 0.85;
        masterGain.connect(audioCtx.destination);
      } else if (audioCtx.state === "suspended") audioCtx.resume();
      return audioCtx;
    } catch (e) { return null; }
  }
  function tone(freq, freqEnd, dur, type, vol) {
    var ac = audioCtx; if (!ac || muted) return;
    try {
      var t = ac.currentTime;
      var o = ac.createOscillator(), g = ac.createGain();
      o.type = type || "square";
      o.frequency.setValueAtTime(freq, t);
      if (freqEnd) o.frequency.exponentialRampToValueAtTime(Math.max(30, freqEnd), t + dur);
      g.gain.setValueAtTime(vol || 0.08, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(masterGain);
      o.start(t); o.stop(t + dur);
    } catch (e) {}
  }
  function noise(dur, vol, f0, f1) {
    var ac = audioCtx; if (!ac || muted) return;
    try {
      var t = ac.currentTime;
      var n = Math.floor(ac.sampleRate * dur);
      var buf = ac.createBuffer(1, Math.max(1, n), ac.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      var s = ac.createBufferSource(); s.buffer = buf;
      var f = ac.createBiquadFilter(); f.type = "bandpass";
      f.frequency.setValueAtTime(f0, t);
      f.frequency.exponentialRampToValueAtTime(Math.max(60, f1), t + dur);
      var g = ac.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      s.connect(f); f.connect(g); g.connect(masterGain);
      s.start(t); s.stop(t + dur);
    } catch (e) {}
  }
  function sfx(type) {
    switch (type) {
      case "shoot":    tone(880, 440, 0.06, "square", 0.07); break;
      case "mushHit":  tone(1000, 300, 0.05, "triangle", 0.06); break;
      case "segHit":   tone(660, 220, 0.07, "square", 0.08); break;
      case "headHit":  tone(990, 120, 0.12, "square", 0.09); break;
      case "lastSeg":  tone(1568, 392, 0.18, "square", 0.1); break;
      case "spider":   tone(220, 660, 0.08, "sawtooth", 0.06); break;
      case "scorpion": tone(180, 720, 0.1, "sawtooth", 0.07); break;
      case "saucer":   tone(1200, 400, 0.2, "square", 0.06); break;
      case "boom":     noise(0.4, 0.16, 1200, 120); tone(150, 40, 0.3, "sawtooth", 0.1); break;
      case "bounce":   tone(1320, 880, 0.04, "square", 0.05); break;
      case "fiveX":    tone(1046, 2093, 0.12, "square", 0.07); break;
      case "extra":    [784, 988, 1175, 1568].forEach(function (f, i) { setTimeout(function () { tone(f, f, 0.12, "square", 0.08); }, i * 60); }); break;
      case "wave":     [523, 587, 659, 784, 880, 1046].forEach(function (f, i) { setTimeout(function () { tone(f, f, 0.1, "square", 0.07); }, i * 55); }); break;
      case "hurt":     noise(0.5, 0.2, 900, 90); [300, 220, 150, 90].forEach(function (f, i) { setTimeout(function () { tone(f, f * 0.7, 0.22, "sawtooth", 0.12); }, i * 80); }); break;
    }
  }

  /* ── Game state ───────────────────────────────────────────────────── */
  var state = "attract";   /* attract | playing | dying | waveclear | gameover */
  var score = 0, highScore = 0, lives = 3, wave = 1;
  var frame = 0, attractFrame = 0;
  var dyingTimer = 0, waveClearTimer = 0;
  var nextExtraLife = 10000;
  var fiveX = false;       /* active bouncing mushroom multiplier */
  var stepCount = 0;

  try { highScore = parseInt(localStorage.getItem("centipede_highscore"), 10) || 0; } catch (e) {}

  /* ── Player ───────────────────────────────────────────────────────── */
  var ship = { x: FW / 2, y: FH - 12, alive: true, inv: 0, dead: false };
  var bullet = null;                /* ONE bullet at a time (trackball) */
  var fireHeld = false;
  var keys = {};

  /* ── Entities ─────────────────────────────────────────────────────── */
  var centipedes = [];
  var mush = {};                    /* key "c,r" -> mushroom obj */
  var spiders = [];
  var scorpions = [];
  var saucers = [];
  var saucerShots = [];
  var bounceShrooms = [];
  var fungi = [];
  var particles = [];
  var floats = [];

  function mkey(c, r) { return c + "," + r; }
  function mushAt(c, r) { return mush[mkey(c, r)] || null; }
  function cellOf(px) { return Math.round(px / CELL); }

  /* ── Mushrooms ────────────────────────────────────────────────────── */
  function seedMushrooms() {
    mush = {};
    for (var r = MUSH_TOP_ROW; r <= MUSH_BOTTOM_ROW; r++) {
      for (var c = 1; c < COLS - 1; c++) {
        if (r > ROWS - 5 && Math.random() < 0.55) continue; /* keep player lane freer */
        if (Math.random() < 0.22) {
          mush[mkey(c, r)] = { c: c, r: r, hp: 4, poison: false, expl: 0 };
        }
      }
    }
    /* guaranteed mushroom cluster mid-field (center spawn never bare) */
    var cc = 8 + Math.floor(Math.random() * 14), cr = 12 + Math.floor(Math.random() * 5);
    mush[mkey(cc, cr)] = { c: cc, r: cr, hp: 4, poison: false, expl: 0 };
  }

  function addMushroom(c, r, poison) {
    c = Math.max(1, Math.min(COLS - 2, c));
    r = Math.max(0, Math.min(ROWS - 1, r));
    if (mushAt(c, r)) return;
    /* pushing down if occupied below later — replace any occupant */
    mush[mkey(c, r)] = { c: c, r: r, hp: 4, poison: !!poison, expl: 0 };
  }

  function hitMushroom(m) {
    m.hp--;
    addScore(5);
    if (m.hp <= 0) {
      /* Exploding mushrooms burst into six bouncing mushrooms */
      if (m.expl > 0 || (Math.random() < 0.06 && state === "playing")) {
        delete mush[mkey(m.c, m.r)];
        spawnBurst(m.c * CELL, m.r * CELL);
      } else {
        delete mush[mkey(m.c, m.r)];
      }
      puff(m.c * CELL, m.r * CELL, pal().mush, 5);
    } else {
      sfx("mushHit");
    }
  }

  /* ── Centipedes: trail-based grid movement ────────────────────────── */
  function speedCells() {
    /* odd waves fast (~2 cells * 15/7.5 ratio), even waves slow */
    var base = (wave % 2 === 1) ? 10 : 6.5;
    return base + Math.min(wave, 8) * 0.25;
  }

  function makeCentipede(segs, dir, startTrail, headIdx, poison) {
    /* segs: array of {x,y} head-first. trail: path points behind head. */
    var trail = startTrail || initTrail(segs, dir);
    return {
      segs: segs, trail: trail, dir: dir,
      acc: 0, poison: !!poison, headIdx: headIdx || 0,
      zig: 0, dropping: 0,
    };
  }

  function initTrail(segs, dir) {
    /* trail = [head position, ...points behind]: straight line at CELL
       spacing opposite to travel direction (no first-frame teleport) */
    var t = [{ x: segs[0].x, y: segs[0].y }];
    for (var i = 1; i < segs.length * 3 + 40; i++) {
      t.push({ x: segs[0].x - dir * i, y: segs[0].y });
    }
    return t;
  }

  function spawnWaveCentipede() {
    var n = Math.min(26, 12 + (wave - 1) * 2);
    var dir = (wave % 2 === 1) ? 1 : -1;
    var startCol = (wave % 2 === 1) ? 1 : COLS - 2;
    var segs = [];
    for (var i = 0; i < n; i++) {
      segs.push({ x: (startCol - dir * i) * CELL, y: CELL });
    }
    centipedes.push(makeCentipede(segs, dir, null, 0, false));
  }

  /* place segments along stored path at fixed CELL spacing */
  function retrace(cen) {
    var trail = cen.trail;
    /* cumulative distances backwards from head */
    var d = 0, idx = 0, acc2 = 0;
    cen.segs[0].x = trail[0].x; cen.segs[0].y = trail[0].y;
    for (var i = 1; i < cen.segs.length; i++) {
      var want = i * CELL;
      while (acc2 < want - 0.0001 && idx + 1 < trail.length) {
        var a = trail[idx], b = trail[idx + 1];
        var dd = Math.hypot(b.x - a.x, b.y - a.y);
        if (acc2 + dd >= want) {
          var t = (want - acc2) / (dd || 1);
          cen.segs[i].x = a.x + (b.x - a.x) * t;
          cen.segs[i].y = a.y + (b.y - a.y) * t;
          acc2 = want;
          break;
        }
        acc2 += dd; idx++;
      }
      if (acc2 < want - 0.0001) { /* trail exhausted: stack last */
        cen.segs[i].x = trail[trail.length - 1].x;
        cen.segs[i].y = trail[trail.length - 1].y;
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

      /* HEAD blocked? wall or mushroom in the next cell */
      var nc = hc + cen.dir;
      var blocked = (nc < 0 || nc > COLS - 1);
      var blocker = blocked ? null : mushAt(nc, hr);
      if (blocker) blocked = true;

      if (blocked) {
        /* ONLY the head drops one row and reverses */
        cen.dir = -cen.dir;
        var dropRow = hr + 1;
        if (dropRow >= ROWS - 1) {
          /* reached bottom: whole centipede respawns at top */
          respawnCenti(cen);
          return;
        }
        head.y = dropRow * CELL;
        /* touching a poison mushroom while blocked poisons the centipede */
        if (blocker && blocker.poison && !cen.poison) { cen.poison = true; sfx("fiveX"); }
      } else {
        head.x = nc * CELL;
        /* zig-zag visual: half-cell vertical bob every cell */
        cen.zig = 1 - cen.zig;
      }

      /* poison mushroom turns centipede purple */
      var m0 = mushAt(cellOf(head.x), cellOf(head.y));
      if (m0 && m0.poison && !cen.poison) {
        cen.poison = true;
        sfx("fiveX");
      }

      /* record path point */
      cen.trail.unshift({ x: head.x, y: head.y });
      var maxTrail = cen.segs.length * CELL * 3 + 60;
      while (cen.trail.length > maxTrail) cen.trail.pop();
    }
    /* sub-frame slide for smooth motion between cell steps */
    var partial = cen.acc;
    var hx = cen.segs[0].x;
    /* (visual interpolation handled at draw) */

    retrace(cen);

    /* poisoned: actively plunge downward */
    if (cen.poison && frame % 24 === 0) {
      cen.trail.unshift({ x: cen.segs[0].x, y: cen.segs[0].y + CELL });
      cen.segs[0].y += CELL;
      retrace(cen);
      if (cen.segs[0].y >= ROWS * CELL) respawnCenti(cen);
    }
  }

  function respawnCenti(cen) {
    /* reached the bottom (or player lane too far): collapse to top */
    var segs = cen.segs, dir = (Math.random() < 0.5 ? 1 : -1);
    var startCol = dir === 1 ? 1 : COLS - 2;
    for (var i = 0; i < segs.length; i++) {
      segs[i].x = (startCol - dir * i) * CELL;
      segs[i].y = CELL;
    }
    cen.dir = dir; cen.trail = initTrail(segs, dir); cen.poison = cen.poison;
  }

  /* ── Scoring ──────────────────────────────────────────────────────── */
  function addScore(n) {
    score += n;
    if (score >= nextExtraLife) {
      nextExtraLife += 10000;
      lives = Math.min(9, lives + 1);
      sfx("extra");
      floats.push({ x: ship.x, y: PLAYER_TOP + 8, text: "EXTRA LIFE", color: "#ffff33", life: 90 });
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
          var sc = cen.segs[0];
          /* destroyed segment becomes a mushroom */
          addMushroom(cellOf(s.x), cellOf(s.y), cen.poison && false);
          if (si === 0) {
            /* HEAD hit */
            if (cen.segs.length === 1) {
              addScore(200 * mult);
              floats.push({ x: s.x, y: s.y, text: "+200", color: "#ff3333", life: 70 });
              centipedes.splice(ci, 1);
              sfx("lastSeg");
            } else {
              addScore(100 * mult);
              floats.push({ x: s.x, y: s.y, text: "+" + 100 * mult, color: pal().head, life: 60 });
              /* body continues as new centipede, SAME direction */
              cen.segs.shift();
              cen.trail = initTrail(cen.segs, cen.dir);
              sfx("headHit");
            }
          } else {
            /* BODY segment: split; rear half continues SAME direction */
            addScore(10 * mult);
            floats.push({ x: s.x, y: s.y, text: "+" + 10 * mult, color: "#ffffff", life: 45 });
            var front = cen.segs.slice(0, si);
            var rear = cen.segs.slice(si + 1);
            cen.segs = front; cen.trail = initTrail(front, cen.dir);
            if (rear.length > 0) {
              centipedes.push(makeCentipede(rear, cen.dir, initTrail(rear, cen.dir), 0, cen.poison));
            }
            sfx("segHit");
          }
          puff(s.x + CELL / 2, s.y + CELL / 2, pal().centi, 6);
          return true;
        }
      }
    }
    return false;
  }

  /* ── Spider ───────────────────────────────────────────────────────── */
  function spawnSpider() {
    if (spiders.length >= 2) return;
    var side = Math.random() < 0.5 ? 0 : FW - CELL;
    spiders.push({ x: side, y: PLAYER_TOP + Math.random() * (FH - PLAYER_TOP - CELL), vx: 0, vy: 0, jump: 0, age: 0 });
    sfx("spider");
  }

  function updateSpiders() {
    for (var i = spiders.length - 1; i >= 0; i--) {
      var s = spiders[i];
      s.age++;
      if (--s.jump <= 0) {
        /* erratic jump; speed grows with age (authentic ramp) */
        var sp = 2.2 + Math.min(2.4, s.age * 0.004);
        var ang = Math.atan2(ship.y - s.y + (Math.random() - 0.5) * 60, ship.x - s.x + (Math.random() - 0.5) * 60);
        s.vx = Math.cos(ang) * sp; s.vy = Math.abs(Math.sin(ang)) * sp * (Math.random() < 0.7 ? 1 : -1);
        s.jump = 10 + Math.floor(Math.random() * 8);
      }
      s.x += s.vx; s.y += s.vy;
      if (s.x < 0) { s.x = 0; s.vx = Math.abs(s.vx); }
      if (s.x > FW - CELL) { s.x = FW - CELL; s.vx = -Math.abs(s.vx); }
      if (s.y < CELL) { s.y = CELL; s.vy = Math.abs(s.vy); }
      if (s.y > FH - CELL) { s.y = FH - CELL; s.vy = -Math.abs(s.vy); }
      /* eats mushrooms */
      var m = mushAt(cellOf(s.x), cellOf(s.y));
      if (m) { delete mush[mkey(m.c, m.r)]; puff(m.c * CELL + 4, m.r * CELL + 4, pal().spider, 4); }
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
      /* poison mushrooms it passes over */
      var m = mushAt(cellOf(s.x), cellOf(s.y));
      if (m && !m.poison) { m.poison = true; m.hp = 4; }
      /* occasionally change row */
      if (++s.step % 40 === 0) s.y += CELL * (Math.random() < 0.5 ? 1 : -1);
      if (s.x < -CELL * 2 || s.x > FW + CELL) { scorpions.splice(i, 1); i--; }
    }
  }

  /* ── Flying saucer ────────────────────────────────────────────────── */
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
    for (var i = 0; i < saucers.length; i++) {
      var s = saucers[i];
      s.x += s.dir * 2.4;
      s.y += Math.sin(frame * 0.05 + i) * 0.4;
      if (--s.fire <= 0) {
        s.fire = 90 + Math.floor(Math.random() * 60);
        saucerShots.push({ x: s.x + 3, y: s.y + 6, vy: 3.2 });
      }
      if (s.x < -CELL * 2 || s.x > FW + CELL * 2) { saucers.splice(i, 1); i--; }
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
  }

  /* ── Bouncing mushrooms / fungi ──────────────────────────────────── */
  function spawnBurst(x, y) {
    sfx("boom");
    var made = 0;
    for (var k = 0; k < 6; k++) {
      var a = (k / 6) * Math.PI * 2 + Math.random() * 0.4;
      bounceShrooms.push({
        x: x, y: y, vx: Math.cos(a) * 2.2, vy: Math.sin(a) * 2.2 - 1,
        bounces: 4 + Math.floor(Math.random() * 4), timer: 120,
      });
      made++;
    }
    if (made) sfx("bounce");
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
      /* bounce off mushrooms too */
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
        if (nr >= ROWS - 1 || mushAt(f.c, nr)) { delete fungi[i]; fungi.splice(i, 1); }
        else { delete mush[mkey(f.c, nr)]; f.r = nr; }
      }
    }
  }

  /* ── Particles / float text ──────────────────────────────────────── */
  function puff(x, y, color, n) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2, sp2 = 0.4 + Math.random() * 1.6;
      particles.push({ x: x, y: y, vx: Math.cos(a) * sp2, vy: Math.sin(a) * sp2, life: 18 + Math.floor(Math.random() * 12), color: color });
    }
  }
  function updateFx() {
    for (var i = particles.length - 1; i >= 0; i--) { var p = particles[i]; p.x += p.vx; p.y += p.vy; if (--p.life <= 0) particles.splice(i, 1); }
    for (var j = floats.length - 1; j >= 0; j--) { var f = floats[j]; f.y -= 0.3; if (--f.life <= 0) floats.splice(j, 1); }
  }

  /* ── Player death / flow ─────────────────────────────────────────── */
  function shipAlive() { return ship.alive && state === "playing"; }
  function killPlayer() {
    if (!shipAlive() || ship.inv > 0) return;
    ship.alive = false;
    lives--;
    sfx("hurt");
    puff(ship.x, ship.y, "#33ccff", 20);
    dyingTimer = 120;
    state = "dying";
  }
  function afterDeath() {
    if (lives > 0) {
      ship.x = FW / 2; ship.y = FH - 12;
      ship.alive = true; ship.inv = 150;
      bullet = null;
      spiders.length = 0; scorpions.length = 0; saucers.length = 0; saucerShots.length = 0;
      state = "playing";
    } else {
      state = "gameover";
      attractFrame = 0;
    }
  }

  function startWave() {
    centipedes.length = 0;
    spiders.length = 0; scorpions.length = 0; saucers.length = 0; saucerShots.length = 0;
    bounceShrooms.length = 0; fungi.length = 0;
    bullet = null;
    fiveX = false;
    spawnWaveCentipede();
    if (Math.random() < 0.18 && wave > 1) bounceShrooms.push({ x: FW / 2, y: PLAYER_TOP, vx: 2.4, vy: -2, bounces: 6 + Math.floor(Math.random() * 4), timer: 420 });
    saucerTimer = 500 + Math.floor(Math.random() * 400);
    fungiTimer = 480;
    ship.inv = 90;
    state = "playing";
    sfx("wave");
  }

  function startGame() {
    score = 0; lives = 3; wave = 1; nextExtraLife = 10000;
    particles.length = 0; floats.length = 0;
    seedMushrooms();
    ship.x = FW / 2; ship.y = FH - 12; ship.alive = true; ship.inv = 90;
    startWave();
  }

  /* ── Input ────────────────────────────────────────────────────────── */
  var touchDrag = null;
  function initInput() {
    window.addEventListener("keydown", function (e) {
      getAudio();
      if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Space"].indexOf(e.code) >= 0) e.preventDefault();
      keys[e.code] = true;
      if (e.code === "KeyM") toggleMute();
      if (state === "attract" || state === "gameover") { if (e.code === "Space" || e.code === "Enter") startGame(); }
      if (e.code === "Space") fireHeld = true;
    });
    window.addEventListener("keyup", function (e) { keys[e.code] = false; if (e.code === "Space") fireHeld = false; });
    window.addEventListener("resize", resize);

    var touchBtn = document.getElementById("fireBtn");
    if (touchBtn) {
      touchBtn.addEventListener("pointerdown", function (e) { e.preventDefault(); getAudio(); if (state !== "playing") { startGame(); return; } fireHeld = true; });
      touchBtn.addEventListener("pointerup", function (e) { e.preventDefault(); fireHeld = false; });
      touchBtn.addEventListener("pointercancel", function () { fireHeld = false; });
    }

    canvas.addEventListener("pointerdown", function (e) {
      getAudio();
      if (state !== "playing") { startGame(); return; }
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

  function toggleMute() { muted = !muted; var mb = document.getElementById("muteBtn"); if (mb) mb.textContent = muted ? "SOUND ON" : "MUTE"; }

  function updateShip() {
    if (!ship.alive) return;
    var sp = 2.4;
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
    ship.x += dx * sp; ship.y += dy * sp;
    /* bound to bottom playfield lane */
    ship.x = Math.max(4, Math.min(FW - 4, ship.x));
    ship.y = Math.max(PLAYER_TOP, Math.min(FH - 4, ship.y));
    if (ship.inv > 0) ship.inv--;

    if (fireHeld && !bullet) {
      bullet = { x: ship.x, y: ship.y - 6 };
      sfx("shoot");
    }
    /* contact deaths */
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
      for (var b2 = 0; b2 < bounceShrooms.length; b2++) { /* bouncing mushrooms are harmless */ }
      for (var p2 = 0; p2 < particles.length; p2++) {}
    }
  }

  function updateBullet() {
    if (!bullet) return;
    bullet.y -= 6;
    if (bullet.y < -CELL) { bullet = null; return; }
    /* centipede first */
    if (shotVsCenti(bullet)) { bullet = null; return; }
    /* spider */
    for (var j = 0; j < spiders.length; j++) {
      var s = spiders[j];
      if (bullet.x > s.x - 2 && bullet.x < s.x + CELL + 2 && bullet.y > s.y - 2 && bullet.y < s.y + CELL + 2) {
        spiders.splice(j, 1); bullet = null; addScore(75);
        floats.push({ x: s.x, y: s.y, text: "+75", color: pal().spider, life: 55 });
        puff(s.x + 4, s.y + 4, pal().spider, 8); sfx("boom");
        return;
      }
    }
    /* scorpion */
    for (var k = 0; k < scorpions.length; k++) {
      var sc = scorpions[k];
      if (bullet.x > sc.x - 2 && bullet.x < sc.x + CELL + 2 && bullet.y > sc.y - 2 && bullet.y < sc.y + CELL + 2) {
        scorpions.splice(k, 1); bullet = null; addScore(100);
        floats.push({ x: sc.x, y: sc.y, text: "+100", color: pal().scorp, life: 55 });
        puff(sc.x + 4, sc.y + 4, pal().scorp, 8); sfx("boom");
        return;
      }
    }
    /* saucer */
    for (var q = 0; q < saucers.length; q++) {
      var sa = saucers[q];
      if (bullet.x > sa.x - 4 && bullet.x < sa.x + CELL + 4 && bullet.y > sa.y - 2 && bullet.y < sa.y + CELL) {
        saucers.splice(q, 1); bullet = null; addScore(50);
        floats.push({ x: sa.x, y: sa.y, text: "+50", color: pal().saucer, life: 55 });
        puff(sa.x + 4, sa.y + 4, pal().saucer, 10); sfx("boom");
        /* saucer breaks into spiders */
        spawnSpider(); spawnSpider();
        return;
      }
    }
    /* bouncing mushrooms (shoot to bank points) */
    for (var z = 0; z < bounceShrooms.length; z++) {
      var bm = bounceShrooms[z];
      if (Math.abs(bm.x + 4 - bullet.x) < 6 && Math.abs(bm.y + 4 - bullet.y) < 6) {
        bounceShrooms.splice(z, 1); bullet = null; addScore(100);
        floats.push({ x: bm.x, y: bm.y, text: "+100", color: BOUNCE_COLOR, life: 55 });
        addMushroom(cellOf(bm.x), cellOf(bm.y), false);
        sfx("segHit");
        return;
      }
    }
    /* fungi */
    for (var f2 = 0; f2 < fungi.length; f2++) {
      var fu = fungi[f2];
      if (Math.abs(fu.c * CELL + 4 - bullet.x) < 5 && Math.abs(fu.r * CELL + 4 - bullet.y) < 5) {
        fungi.splice(f2, 1); bullet = null; addScore(10);
        addMushroom(fu.c, fu.r, false);
        sfx("segHit");
        return;
      }
    }
    /* mushroom */
    var m = mushAt(cellOf(bullet.x), cellOf(bullet.y - 2));
    if (m) { bullet = null; hitMushroom(m); return; }
  }

  /* ── Update ───────────────────────────────────────────────────────── */
  function update() {
    frame++;
    if (state === "attract" || state === "gameover") { attractFrame++; return; }
    if (state === "dying") { if (--dyingTimer <= 0) afterDeath(); updateFx(); return; }
    if (state === "waveclear") { if (--waveClearTimer <= 0) { wave++; startWave(); } updateFx(); return; }

    updateShip();
    updateBullet();
    for (var i = centipedes.length - 1; i >= 0; i--) updateCenti(centipedes[i]);
    updateSpiders();
    updateScorpions();
    updateSaucers();
    updateBounces();
    updateFungi();
    updateFx();

    if (Math.random() < 0.0018) spawnSpider();
    if (Math.random() < 0.0010) spawnScorpion();

    /* wave clear when no centipede segments remain */
    if (centipedes.length === 0 && state === "playing") {
      waveClearTimer = 100;
      state = "waveclear";
      sfx("wave");
    }
  }

  /* ── Resize / mapping ─────────────────────────────────────────────── */
  function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
    var hudH = 28;
    SCALE = Math.min((W - 12) / FW, (H - hudH - 12) / FH);
    if (SCALE < 1) SCALE = Math.max(1, SCALE);
    OX = Math.floor((W - FW * SCALE) / 2);
    OY = Math.floor(hudH + (H - hudH - FH * SCALE) / 2);
  }

  /* ── Drawing (chunky arcade sprites, light bloom) ────────────────── */
  var legFrame = 0;
  function px(x) { return OX + x * SCALE; }
  function py(y) { return OY + y * SCALE; }
  function rect(x, y, w, h, color, glow) {
    ctx.fillStyle = color;
    ctx.shadowColor = glow === undefined ? color : glow;
    ctx.shadowBlur = glow === 0 ? 0 : 6 * Math.min(2, SCALE);
    ctx.fillRect(Math.round(px(x)), Math.round(py(y)), Math.max(1, Math.round(w * SCALE)), Math.max(1, Math.round(h * SCALE)));
    ctx.shadowBlur = 0;
  }

  function drawMushroom(m, color) {
    var x = m.c * CELL, y = m.r * CELL;
    var s = 0.5 + 0.5 * (m.hp / 4); /* shrink with damage */
    var capW = CELL * s, capH = CELL * 0.55 * s;
    var cx = x + (CELL - capW) / 2;
    var col = m.poison ? POISON_COLOR : (m.expl > 0 && frame % 20 < 10 ? EXPLODING_COLOR : color);
    rect(cx, y + CELL - capH - CELL * 0.18, capW, capH, col);
    rect(x + CELL * 0.35, y + CELL - CELL * 0.18, CELL * 0.3, CELL * 0.18, "#cccccc", "#888888");
    /* spots */
    if (m.hp > 2) rect(cx + capW * 0.2, y + CELL - capH - CELL * 0.12, 2, 2, "#ffffff", "#ffffff");
  }

  function drawCenti(cen) {
    var color = cen.poison ? POISON_COLOR : pal().centi;
    var bob = (cen.acc / CELL) * CELL; /* sub-cell slide amount */
    for (var i = cen.segs.length - 1; i >= 0; i--) {
      var s = cen.segs[i];
      var xoff = cen.dir * bob;
      var zigY = ((cellOf(s.x) + i) % 2 === 0 ? 0 : 1) * 2 * ((cen.zig) ? 1 : -1);
      var x = s.x + (i === 0 ? xoff : 0), y = s.y + zigY * 0.5;
      if (i === 0) {
        /* head: bigger block + antennae */
        rect(x, y, CELL, CELL, color);
        rect(x + CELL + cen.dir * -1, y + (cen.dir === 1 ? 0 : CELL - 2), 3, 2, color);
        rect(x + (cen.dir === 1 ? CELL : -3), y - 2, 2, 2, color);
      } else {
        rect(x + 1, y + 1, CELL - 2, CELL - 2, color);
        /* legs: jumpy 4-frame */
        var lf = (legFrame + i) % 4;
        if (lf < 2) {
          rect(x - 1, y + 2, 1, 4, color, color);
          rect(x + CELL, y + 2, 1, 4, color, color);
        } else {
          rect(x - 1, y + 4, 1, 3, color, color);
          rect(x + CELL, y + 1, 1, 3, color, color);
        }
      }
    }
  }

  function drawSpider(s) {
    var c = pal().spider;
    rect(s.x + 2, s.y + 2, CELL - 4, CELL - 4, c);
    var lf = legFrame % 4;
    for (var k = 0; k < 3; k++) {
      var off = (lf + k) % 2 === 0 ? -2 : -1;
      rect(s.x + off, s.y + 1 + k * 2, 2, 1, c, c);
      rect(s.x + CELL - off - 2, s.y + 1 + k * 2, 2, 1, c, c);
    }
  }

  function drawScorpion(s) {
    var c = pal().scorp;
    rect(s.x + 1, s.y + 2, CELL - 2, CELL - 4, c);
    /* pincers */
    var fx = s.dir === 1 ? s.x + CELL : s.x - 3;
    rect(fx, s.y, 3, 2, c, c);
    rect(fx, s.y + CELL - 2, 3, 2, c, c);
    /* curled tail */
    rect(s.dir === 1 ? s.x - 2 : s.x + CELL - 1, s.y + 1, 2, 2, c, c);
    var lf = legFrame % 4;
    for (var k = 0; k < 3; k++) {
      rect(s.x + 1 + k * 2, s.y + (lf < 2 ? CELL - 1 : CELL - 2), 1, 2, c, c);
    }
  }

  function drawSaucer(s) {
    var c = pal().saucer;
    rect(s.x, s.y + 3, CELL + 4, 3, c);
    rect(s.x + 2, s.y, CELL, 3, c);
    rect(s.x + 3 + (frame % 20 < 10 ? 2 : 0), s.y + 4, 2, 1, "#ff3333", "#ff3333");
  }

  function drawShip() {
    if (!ship.alive) return;
    if (ship.inv > 0 && Math.floor(frame / 4) % 2 === 0) return;
    var x = ship.x, y = ship.y;
    rect(x - 1.5, y - 6, 3, 6, "#dddddd");
    rect(x - 4, y, 8, 4, "#33ccff");
    rect(x - 6, y + 4, 12, 2, "#33ccff");
  }

  function drawBullet(b) { rect(b.x - 1, b.y - 3, 2, 6, "#ffffff"); }
  function drawSaucerShot(b) { rect(b.x - 1, b.y - 4, 2, 8, "#ff6633"); }

  function drawFx() {
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      rect(p.x - 1, p.y - 1, 2, 2, p.color, p.color);
    }
    ctx.shadowBlur = 0;
  }

  function drawBouncing(m) { rect(m.x, m.y, CELL, CELL, BOUNCE_COLOR); }
  function drawFungus(f) { rect(f.c * CELL, f.r * CELL, CELL, CELL, "#33ff99"); }

  function text(t, x, y, size, color, align) {
    ctx.font = "bold " + size + "px 'Courier New', monospace";
    ctx.textAlign = align || "left";
    ctx.textBaseline = "top";
    ctx.shadowColor = color; ctx.shadowBlur = 8;
    ctx.fillStyle = color;
    ctx.fillText(t, x, y);
    ctx.shadowBlur = 0;
  }

  function drawHUD() {
    text("1UP", 8, 4, 13, "#ff3333");
    text(String(score).padStart(6, "0"), 8, 15, 13, "#ffffff");
    text("HI", FW * SCALE / 2 + OX / 2 - 60, 4, 13, "#ffcc00");
    text(String(highScore).padStart(6, "0"), FW * SCALE / 2 + OX / 2 - 60, 15, 13, "#ffff33");
    /* lives as ship glyphs bottom-right */
    for (var i = 0; i < lives; i++) {
      var lx = OX + FW * SCALE - 14 - i * 16, ly = OY + FH * SCALE + 4;
      ctx.fillStyle = "#33ccff";
      ctx.fillRect(lx, ly, 8, 3);
      ctx.fillRect(lx + 3, ly - 3, 2, 3);
    }
    text("WAVE " + wave, OX + FW * SCALE - 70, OY + FH * SCALE + 4, 11, "#33ff33");
    if (fiveX) text("x5 SCORE!", OX + 8, OY + FH * SCALE + 4, 11, BOUNCE_COLOR);
  }

  function drawField() {
    /* field frame */
    ctx.strokeStyle = "#00ff44";
    ctx.shadowColor = "#00ff44"; ctx.shadowBlur = 6;
    ctx.lineWidth = 2;
    ctx.strokeRect(OX - 2, OY - 2, FW * SCALE + 4, FH * SCALE + 4);
    ctx.shadowBlur = 0;
  }

  /* ── Attract / attract demo ──────────────────────────────────────── */
  function drawAttract() {
    var cx = W / 2;
    text("CENTIPEDE", cx - 90, OY, 26, attractFrame % 60 < 30 ? "#33ff33" : "#00cc00");
    /* demo centipede */
    var t = attractFrame * 0.05;
    var dcol = PALETTES[Math.floor(attractFrame / 240) % PALETTES.length].centi;
    for (var i = 0; i < 10; i++) {
      var x = cx - 80 + ((attractFrame * 2 + i * 8) % 160);
      var y = OY + 60 + ((Math.floor((attractFrame - i * 4) / 16) % 2) * 4);
      ctx.fillStyle = dcol;
      ctx.shadowColor = dcol; ctx.shadowBlur = 6;
      ctx.fillRect(x, y, 7, 7);
      ctx.shadowBlur = 0;
    }
    var rows = [
      ["CENTIPEDE SEGMENT", "10 PTS (50 x5)"],
      ["CENTIPEDE HEAD", "100 PTS (500 x5)"],
      ["LAST SEGMENT", "200 PTS"],
      ["FLYING SAUCER", "50 PTS"],
      ["SPIDER", "75 PTS"],
      ["SCORPION", "100 PTS"],
      ["MUSHROOM HIT", "5 PTS"],
      ["EXTRA LIFE / 10,000", ""],
    ];
    for (var r = 0; r < rows.length; r++) {
      text(rows[r][0], cx - 95, OY + 100 + r * 18, 12, "#aaaaaa");
      text(rows[r][1], cx + 100, OY + 100 + r * 18, 12, "#ffffff");
    }
    if (attractFrame % 60 < 36) text("PUSH FIRE TO START", cx - 80, OY + FH * SCALE - 30, 14, "#ffff33");
    text("HI-SCORE " + String(highScore).padStart(6, "0"), cx - 66, OY + FH * SCALE - 52, 12, "#ffcc00");
  }

  function drawGameOver() {
    text("GAME OVER", W / 2 - 55, OY + FH * SCALE / 2 - 24, 22, "#ff3333");
    text("SCORE " + String(score).padStart(6, "0"), W / 2 - 55, OY + FH * SCALE / 2 + 4, 14, "#ffffff");
    if (attractFrame % 60 < 36) text("PUSH FIRE TO PLAY", W / 2 - 70, OY + FH * SCALE / 2 + 30, 13, "#ffff33");
  }

  /* ── Render ───────────────────────────────────────────────────────── */
  function render() {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    legFrame = Math.floor(frame / 6) % 4;

    if (state === "attract") { drawField(); drawAttract(); return; }

    /* world */
    var k;
    for (k in mush) drawMushroom(mush[k], pal().mush);
    for (k = 0; k < fungi.length; k++) drawFungus(fungi[k]);
    for (k = 0; k < bounceShrooms.length; k++) drawBouncing(bounceShrooms[k]);
    for (k = 0; k < centipedes.length; k++) drawCenti(centipedes[k]);
    for (k = 0; k < spiders.length; k++) drawSpider(spiders[k]);
    for (k = 0; k < scorpions.length; k++) drawScorpion(scorpions[k]);
    for (k = 0; k < saucers.length; k++) drawSaucer(saucers[k]);
    if (bullet) drawBullet(bullet);
    for (k = 0; k < saucerShots.length; k++) drawSaucerShot(saucerShots[k]);
    drawShip();
    drawFx();
    drawField();
    drawHUD();

    if (state === "waveclear") {
      text("WAVE " + wave + " CLEAR", W / 2 - 70, OY + FH * SCALE / 2 - 10, 18, "#ffff33");
    }
    if (state === "gameover") drawGameOver();

    /* float texts */
    for (k = 0; k < floats.length; k++) {
      var f = floats[k];
      text(f.text, px(f.x) - 10, py(f.y), 11, f.color);
    }
  }

  /* placeholder-safe scorpion draws (single pass) */
  function drawScorpions_off() {}
  function drawScorpions_live() { for (var i = 0; i < scorpions.length; i++) drawScorpion(scorpions[i]); }
  function updateScorpionsDraw() {}

  /* ── Boot / loop ──────────────────────────────────────────────────── */
  var lastT = 0, acc2 = 0;
  function loop(now) {
    if (!lastT) lastT = now;
    acc2 += now - lastT; lastT = now;
    if (acc2 > 1000 / 60 * 5) acc2 = 1000 / 60 * 5;
    while (acc2 >= 1000 / 60) { update(); acc2 -= 1000 / 60; }
    render();
    requestAnimationFrame(loop);
  }

  function init() {
    resize();
    initInput();
    seedMushrooms();
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
  window._bullet = function () { return bullet; };
  window._centipedes = function () { return centipedes; };
  window._mush = function () { return mush; };
  window._mushAt = function (c, r) { return mushAt(c, r); };
  window._spiders = function () { return spiders; };
  window._scorpions = function () { return scorpions; };
  window._saucers = function () { return saucers; };
  window._bounceShrooms = function () { return bounceShrooms; };
  window._fiveX = function () { return fiveX; };
  window._shotVsCenti = shotVsCenti;
  window._makeCenti = function (segs, dir) { return makeCentipede(segs, dir, null, 0, false); };
  window._forceShoot = function (x, y) { bullet = { x: x, y: y + 8 }; updateBullet(); };
  window._keepAlive = function () { ship.inv = 999999; };
  window._testReset = function () { state = "playing"; ship.alive = true; ship.inv = 999999; };
  window._setLives = function (n) { lives = n; };
  window._spawnSpider = spawnSpider;
  window._spawnScorpion = function () { wave = Math.max(wave, 2); spawnScorpion(); };
  window._addMushroom = addMushroom;
  window._spawnBurst = spawnBurst;
  window._killPlayer = killPlayer;
  window._speedCells = speedCells;
  window._consts = { COLS: COLS, ROWS: ROWS, CELL: CELL, ONE_BULLET: true };
})();
