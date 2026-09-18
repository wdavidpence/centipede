const { chromium } = require('/Users/davidpence/.hermes/node/lib/node_modules/playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = __dirname;
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  let p = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const f = path.join(root, p);
  if (!fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': mime[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
let pass = 0, fail = 0;
function check(c, m) { if (c) { pass++; console.log('PASS:', m); } else { fail++; console.log('FAIL:', m); } }

(async () => {
  await new Promise(r => server.listen(8941, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('http://localhost:8941/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  check(errors.length === 0, 'no page errors on load' + (errors.length ? ' -> ' + errors[0] : ''));

  check(await page.evaluate(() => window._state()) === 'attract', 'attract mode at boot');

  const boot = await page.evaluate(() => {
    window._startGame();
    const c = window._centipedes()[0];
    return {
      state: window._state(),
      segs: c.segs.length,
      onRow1: c.segs.every(s => s.y === 8),
      cols: c.segs.map(s => s.x / 8),
      spaced: c.segs.every((s, i) => i === 0 || Math.abs(s.x - c.segs[i-1].x) === 8),
      mushCount: Object.keys(window._mush()).length,
    };
  });
  check(boot.state === 'playing', 'startGame enters playing');
  check(boot.segs === 6, 'wave 1 centipede starts short (6 segs, got ' + boot.segs + ')');
  check(boot.onRow1, 'centipede spawns at top row');
  check(boot.spaced, 'segments spaced exactly one cell apart');
  check(boot.mushCount > 40, 'mushroom field seeded (' + boot.mushCount + ')');

  // bite & grow: head bumping a mushroom bites it, reverses, and grows
  const bite = await page.evaluate(() => {
    window._testReset();
    const cs = window._centipedes();
    cs.length = 0;
    const segs = [];
    for (let i = 0; i < 5; i++) segs.push({ x: (10 - i) * 8, y: 8 });
    const c = window._makeCenti(segs, 1);
    cs.push(c);
    window._freeze(false);
    window._keepAlive();
    /* isolate: remove all mushrooms, then plant one directly in the path */
    const mm = window._mush();
    Object.keys(mm).forEach(k => delete mm[k]);
    const bc = Math.round(c.segs[0].x / 8) + 1, br = 1;
    window._addMushroom(bc, br, false);
    const len0 = c.segs.length;
    const dir0 = c.dir;
    let bit = false, grew = false, reversed = false, hpSeen = [];
    for (let i = 0; i < 400; i++) {
      window._keepAlive();
      window._step(1);
      const m = window._mushAt(bc, br);
      if (m) hpSeen.push(m.hp);
      if (m && m.hp < 4) bit = true;
      if (c.segs.length > len0) { grew = true; break; }
    }
    reversed = c.dir !== dir0;
    /* keep arena stable for following sections */
    return { bit, grew, reversed, len0, len1: c.segs.length, minHp: Math.min(...hpSeen, 4) };
  });
  check(bite.bit && bite.minHp < 4, 'head bites mushroom on bump (hp shrinks)');
  check(bite.reversed, 'centipede reverses direction after bump');
  check(bite.grew, 'centipede grows after bite (' + bite.len0 + '->' + bite.len1 + ')');

  // growth cap respected
  const cap = await page.evaluate(() => {
    window._testReset();
    const cs = window._centipedes();
    cs.length = 0;
    const segs = [];
    for (let i = 0; i < 5; i++) segs.push({ x: (10 - i) * 8, y: 8 });
    const c = window._makeCenti(segs, 1);
    c.maxSegs = 7;
    cs.push(c);
    const clampC = v => Math.max(1, Math.min(28, v));
    let over = false;
    for (let i = 0; i < 900; i++) {
      window._keepAlive();
      /* seed mushrooms onto the head's live forward cell each step */
      const hc = Math.round(c.segs[0].x / 8), hr = Math.round(c.segs[0].y / 8);
      const fc = clampC(hc + c.dir);
      if (!window._mushAt(fc, hr)) window._addMushroom(fc, hr, false);
      window._step(1);
      if (c.segs.length > c.maxSegs) { over = true; break; }
      if (!window._centipedes().includes(c)) { over = true; break; }
    }
    return { len: c.segs.length, cap: c.maxSegs, over };
  });
  check(!cap.over && cap.len <= cap.cap, 'growth respects cap (' + cap.len + '/' + cap.cap + ')');

  // head-only drop winding: controlled centipede running into right wall
  const wind = await page.evaluate(() => {
    const cs = window._centipedes();
    cs.length = 0;
    const segs = [];
    for (let i = 0; i < 8; i++) segs.push({ x: (20 - i) * 8, y: 8 });
    const c = window._makeCenti(segs, 1);
    cs.push(c);
    let wound = false, dropRow = -1;
    for (let i = 0; i < 600; i++) {
      window._keepAlive();
      window._step(1);
      const ys = c.segs.map(s => s.y);
      if (Math.max(...ys) > Math.min(...ys)) { wound = true; break; }
      if (c.segs[0].y > 8 && dropRow < 0) dropRow = c.segs[0].y;
    }
    const ys = c.segs.map(s => s.y);
    return { wound, dropRow, min: Math.min(...ys), max: Math.max(...ys) };
  });
  check(wind.wound || wind.dropRow === 16, 'head drops one row and reverses at wall; body winds behind (rows ' + wind.min + '-' + wind.max + ')');

  // body segment hit -> split, same direction, +10, mushroom appears
  const split = await page.evaluate(() => {
    // control the arena: single known centipede, straight line, dir=+1
    const cs = window._centipedes();
    cs.length = 0;
    const segs = [];
    for (let i = 0; i < 6; i++) segs.push({ x: (10 - i) * 8, y: 8 });
    const fake = window._makeCenti(segs, -1);
    cs.push(fake);
    window._step(1);
    const midIdx = 3;
    const lenBefore = fake.segs.length;
    const target = fake.segs[midIdx];
    const dir = fake.dir;
    const s0 = window._score();
    const hit = window._shotVsCenti({ x: target.x + 4, y: target.y + 4 });
    const cs2 = window._centipedes();
    return {
      ok: hit, dp: window._score() - s0,
      len0: lenBefore, count: cs2.length,
      lens: cs2.map(c => c.segs.length),
      dirsOpp: cs2.length === 2 ? cs2[1].dir === -dir : cs2.length === 1,
      mushAtSpot: !!window._mushAt(Math.round(target.x / 8), Math.round(target.y / 8)),
    };
  });
  check(split.ok, 'body segment shot registers hit');
  check(split.dp === 10, 'body segment = 10 pts');
  check(split.count === 2 && split.lens[0] === 3 && split.lens[1] === 2, 'centipede splits front(3)+rear(2): count=' + split.count + ' lens=' + JSON.stringify(split.lens));
  check(split.dirsOpp, 'rear half reverses — halves go different directions');
  check(split.mushAtSpot, 'destroyed segment becomes a mushroom');

  // head kill -> +100 and ENTIRE centipede dies (user-spec: no fractured body)
  const head = await page.evaluate(() => {
    const cs = window._centipedes();
    const c = cs[0];
    const s0 = window._score();
    const n0 = c.segs.length;
    const count0 = cs.length;
    const hit = window._shotVsCenti({ x: c.segs[0].x + 4, y: c.segs[0].y + 4 });
    const cs2 = window._centipedes();
    const gone = !cs2.includes(c);
    return { ok: hit, dp: window._score() - s0, gone, count0, count1: cs2.length, n0 };
  });
  check(head.ok && head.dp === 100, 'head shot = 100 pts');
  check(head.gone, 'head hit kills the ENTIRE centipede (body does not continue)');

  // spider withheld until wave 3 (user-spec: gentle first rounds)
  const spiderGate = await page.evaluate(() => {
    window._testReset();
    window._spiders().length = 0;
    const origWave = window._wave();
    let w1 = window._wave();
    /* simulate ~30s of wave 1/2 play; no spider may self-deploy */
    let appeared = false;
    for (let i = 0; i < 1800; i++) {
      window._keepAlive();
      if (window._wave() < 3) { if (window._spiders().length > 0) appeared = true; }
      else break;
      window._step(1);
    }
    const gated = window._wave() < 3 ? !appeared : true;
    return { gated, wave: window._wave(), appeared };
  });
  check(spiderGate.gated, 'no spider harassment during waves 1-2');

  // last segment -> +200 and removal
  const last = await page.evaluate(() => {
    if (window._centipedes().length === 0) window._spawnWave();
    const c = window._centipedes()[0];
    while (c.segs.length > 1) { c.segs.shift(); c.trail = [{ x: c.segs[0].x, y: c.segs[0].y }]; }
    const s0 = window._score();
    const n0 = window._centipedes().length;
    window._shotVsCenti({ x: c.segs[0].x + 4, y: c.segs[0].y + 4 });
    return { dp: window._score() - s0, removed: window._centipedes().length < n0 };
  });
  check(last.dp === 200, 'last segment bonus = 200 pts');
  check(last.removed, 'centipede fully removed on last segment');

  // fire key produces a bullet. CRITICAL: do NOT empty centipedes -- that flips
  // state to 'waveclear' and freezes updateShip (no bullet ever spawns).
  // Instead make every segment out of bullet range via _keepAlive invincibility
  // on the ship plus clearing lane mushrooms, and poll.
  await page.evaluate(() => {
    window._testReset();
    window._spiders().splice(0);
    window._scorpions().splice(0);
    window._bullets().splice(0);
    window._saucerShots().splice(0);
    window._bounceShrooms().splice(0);
    /* head-kill may have emptied the list: guarantee one live centipede so
       update() doesn't flip to waveclear and freeze updateShip (no bullets) */
    if (window._centipedes().length === 0) window._spawnWave();
    /* push live centipedes up to row 1 so their columns rarely align with shots */
    window._centipedes().forEach(c => { c.segs.forEach(s => { s.y = 8; }); c.poison = false; });
    const mm = window._mush();
    Object.keys(mm).forEach(k => { if (mm[k].r >= 19) delete mm[k]; });
    const sh = window._ship();
    sh.inv = 999999; sh.alive = true; sh.x = 120; sh.y = 210;
    window._freeze(true);
    window._step(1);
  });
  await page.keyboard.down('Space');
  let bulletSeen = false;
  for (let t = 0; t < 14 && !bulletSeen; t++) {
    await page.waitForTimeout(40);
    bulletSeen = await page.evaluate(() => window._bullets().length > 0 || window._state() !== 'playing');
  }
  await page.keyboard.up('Space');
  check(bulletSeen, 'fire key produces a bullet');

  // spider spawn + eat mushroom + scoring 75
  const spider = await page.evaluate(() => {
    window._freeze(false);
    window._keepAlive();
    window._spawnSpider();
    let s = null, tries = 0;
    while (!s && tries++ < 60) { window._keepAlive(); window._step(1); s = window._spiders()[0]; }
    if (!s) return { ok: false, why: 'no spider' };
    const clampC = v => Math.max(1, Math.min(28, v));
    const clampR = v => Math.max(1, Math.min(27, v));
    let eaten = false;
    for (let i = 0; i < 400 && window._spiders().length > 0; i++) {
      const cur = window._spiders()[0];
      const mc = clampC(Math.round(cur.x / 8)), mr = clampR(Math.round(cur.y / 8));
      if (!window._mushAt(mc, mr)) window._addMushroom(mc, mr, false);
      window._keepAlive(); window._step(1);
      if (!window._mushAt(mc, mr)) { eaten = true; break; }
    }
    const sNow = window._spiders()[0];
    let shot = false;
    if (sNow) {
      const sb = window._score();
      /* freeze centipedes AND teleport every segment to the top row so no
         stale lower-lane segment can intercept the test bullet; keep the list
         non-empty; forceShoot calls updateBullet directly */
      window._freeze(true);
      window._centipedes().forEach(c => {
        c.segs.forEach(s => { s.y = 8; });
        c.trail.forEach(tp => { tp.y = 8; });
      });
      window._forceShoot(sNow.x + 4, sNow.y);
      shot = window._score() - sb === 75 && window._spiders().length === 0;
      window._freeze(false);
    }
    return { ok: true, eaten, shot };
  });
  check(spider.ok, 'spider active and stepping');
  check(spider.eaten, 'spider eats mushrooms');
  check(spider.shot, 'spider shot = 75 pts');

  // scorpion poisons a mushroom
  const poison = await page.evaluate(() => {
    window._testReset();
    window._spiders().splice(0);
    window._scorpions().splice(0);
    window._bullets().splice(0);
    window._saucerShots().splice(0);
    window._bounceShrooms().splice(0);
    /* keep exactly one far top-row dummy centipede: state stays 'playing'
       (clearing centipedes would trigger waveclear, freezing entity updates) */
    const cs = window._centipedes();
    cs.splice(0);
    const dummy = [];
    for (let i = 0; i < 2; i++) dummy.push({ x: (3 - i) * 8, y: 8 });
    cs.push(window._makeCenti(dummy, 1));
    window._keepAlive();
    window._spawnScorpion();
    const sc = window._scorpions()[0];
    if (!sc) return { ok: false };
    let poisoned = false;
    const clampC = v => Math.max(1, Math.min(28, v));
    const clampR = v => Math.max(1, Math.min(26, v));
    for (let i = 0; i < 60 * 12 && !poisoned; i++) {
      window._keepAlive();
      /* re-seed mushrooms directly onto the scorpion's live cell each frame
         (random-walker recipe: seed the live cell, assert same-cell conversion) */
      const mc = clampC(Math.round(sc.x / 8)), mr = clampR(Math.round(sc.y / 8));
      if (!window._mushAt(mc, mr)) window._addMushroom(mc, mr, false);
      window._step(1);
      const m = window._mushAt(Math.round(sc.x / 8), Math.round(sc.y / 8));
      if (m && m.poison) poisoned = true;
    }
    return { ok: poisoned };
  });
  check(poison.ok, 'scorpion poisons mushrooms');

  // poison turns centipede purple + speeds up
  const poisonCenti = await page.evaluate(() => {
    const cs = window._centipedes();
    cs.length = 0;
    const segs = [];
    for (let i = 0; i < 5; i++) segs.push({ x: (4 + i) * 8, y: 8 });
    const c = window._makeCenti(segs, 1);
    cs.push(c);
    const head = c.segs[0];
    const nc = Math.round(head.x / 8) + c.dir, nr = Math.round(head.y / 8);
    window._mush()[nc + ',' + nr] = { c: nc, r: nr, hp: 4, poison: true, expl: 0 };
    for (let i = 0; i < 900; i++) { window._keepAlive(); window._step(1); if (c.poison) break; }
    return { ok: c.poison };
  });
  check(poisonCenti.ok, 'poison mushroom turns centipede purple');

  // bouncing mushrooms -> x5 mode active
  const bounce = await page.evaluate(() => {
    window._testReset();
    window._bounceShrooms().length = 0;
    window._spawnBurst(100, 100);
    const n = window._bounceShrooms().length;
    for (let i = 0; i < 30; i++) { window._keepAlive(); window._bounceShrooms().forEach(b => b.timer = 60); window._step(1); }
    return { n, five: window._fiveX() };
  });
  check(bounce.n === 6, 'exploding mushroom bursts into 6 bouncing mushrooms');
  check(bounce.five, 'x5 multiplier active while bouncing mushrooms live');

  // wave progression: clear all centipedes -> waveclear -> next wave with more segments
  const waveUp = await page.evaluate(async () => {
    window._testReset();
    const waveBefore = window._wave();
    let sawClear = false;
    for (let guard = 0; guard < 4000; guard++) {
      window._keepAlive();
      window._spiders().length = 0; window._scorpions().length = 0;
      if (window._state() === 'waveclear') { sawClear = true; break; }
      if (window._state() === 'playing') {
        /* shoot ONLY the head of the LAST centipede: head+tail shots obliterate
           whole centipedes and never splinter (splinter fragments would make
           this check and later sections nondeterministic) */
        const cs = window._centipedes();
        if (cs.length > 0 && cs[cs.length - 1].segs.length > 0) {
          const c = cs[cs.length - 1];
          const s = c.segs[0];
          window._shotVsCenti({ x: s.x + 4, y: s.y + 4 });
        }
      }
      window._step(1);
    }
    const cleared = sawClear || window._state() === 'waveclear';
    for (let i = 0; i < 200; i++) { window._keepAlive(); window._step(1); }
    window._centipedes().length = 0;   // waveclear passed; clean for next sections
    window._spawnWave();               // deterministic fresh-wave spawn length
    const cs2 = window._centipedes();
    const c = cs2.length ? cs2[0] : null;
    return { cleared, wave: window._wave(), waveBefore, segs: c ? c.segs.length : 0, state: window._state() };
  });
  check(waveUp.cleared, 'wave clear fires when no centipede segments remain');
  check(waveUp.wave === waveUp.waveBefore + 1 && waveUp.segs === Math.min(12, 6 + Math.floor(waveUp.wave / 2)), 'next wave starts short with per-wave growth (w' + waveUp.wave + ' s' + waveUp.segs + ')');

  // player death on centipede contact
  const death = await page.evaluate(() => {
    window._testReset();
    window._setLives(3);
    const c = window._centipedes();
    c.length = 0;
    const sh = window._ship();
    sh.inv = 0;
    sh.alive = true;
    /* park ship off the bottom clamp so lane-row math can't miss */
    sh.y = 200;
    /* build the centipede ON the ship's clamped lane row */
    const segs = [];
    const laneRow = Math.round(sh.y / 8);
    for (let i = 0; i < 4; i++) segs.push({ x: (10 - i) * 8, y: laneRow * 8 });
    c.push(window._makeCenti(segs, -1));
    /* park ship exactly on the head cell (no slipping past the hitbox) */
    const head0 = c[0].segs[0];
    sh.x = head0.x + 4; sh.y = head0.y + 4;
    const l0 = window._lives();
    window._step(1);
    if (window._state() !== 'dying') {
      const h = window._centipedes()[0].segs[0];
      sh.inv = 0; sh.x = h.x + 4; sh.y = h.y + 4; window._step(1);
    }
    return { state: window._state(), l0, l1: window._lives() };
  });
  check(death.state === 'dying' && death.l1 === death.l0 - 1, 'centipede contact kills player, life lost');
  await page.waitForTimeout(2300);
  const respawn = await page.evaluate(() => window._state());
  check(respawn === 'playing', 'respawn after death');

  await page.screenshot({ path: '/tmp/centipede/gameplay.png' });

  // sprite draw check: saturated colorful pixels exist (palette cycles per wave)
  const px = await page.evaluate(() => {
    const cv = document.getElementById('game'), x = cv.getContext('2d');
    const d = x.getImageData(0, 0, cv.width, cv.height).data;
    let colored = 0;
    for (let i = 0; i < d.length; i += 40) {
      const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]);
      if (mx > 140 && mx - mn > 60) colored++;
    }
    return colored;
  });
  check(px > 20, 'colorful sprites rendered (' + px + ' samples)');

  check(errors.length === 0, 'no page errors during full session' + (errors.length ? ' -> ' + errors[0] : ''));
  await browser.close();
  server.close();
  console.log('');
  console.log('BROWSER VERIFY: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
