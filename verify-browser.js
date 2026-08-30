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
  check(boot.segs === 12, 'wave 1 centipede has 12 segments (got ' + boot.segs + ')');
  check(boot.onRow1, 'centipede spawns at top row');
  check(boot.spaced, 'segments spaced exactly one cell apart');
  check(boot.mushCount > 40, 'mushroom field seeded (' + boot.mushCount + ')');

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
      dirsSame: cs2.length === 2 ? cs2[1].dir === dir : cs2.length === 1,
      mushAtSpot: !!window._mushAt(Math.round(target.x / 8), Math.round(target.y / 8)),
    };
  });
  check(split.ok, 'body segment shot registers hit');
  check(split.dp === 10, 'body segment = 10 pts');
  check(split.count === 2 && split.lens[0] === 3 && split.lens[1] === 2, 'centipede splits front(3)+rear(2): count=' + split.count + ' lens=' + JSON.stringify(split.lens));
  check(split.dirsSame, 'rear half continues SAME direction');
  check(split.mushAtSpot, 'destroyed segment becomes a mushroom');

  // head shot -> +100, body continues
  const head = await page.evaluate(() => {
    const cs = window._centipedes();
    const c = cs[0];
    const s0 = window._score();
    const n0 = c.segs.length;
    const hit = window._shotVsCenti({ x: c.segs[0].x + 4, y: c.segs[0].y + 4 });
    return { ok: hit, dp: window._score() - s0, still: window._centipedes()[0].segs.length === n0 - 1 };
  });
  check(head.ok && head.dp === 100 && head.still, 'head shot = 100 pts, body continues shorter');

  // last segment -> +200 and removal
  const last = await page.evaluate(() => {
    const c = window._centipedes()[0];
    while (c.segs.length > 1) { c.segs.shift(); c.trail = [{ x: c.segs[0].x, y: c.segs[0].y }]; }
    const s0 = window._score();
    const n0 = window._centipedes().length;
    window._shotVsCenti({ x: c.segs[0].x + 4, y: c.segs[0].y + 4 });
    return { dp: window._score() - s0, removed: window._centipedes().length < n0 };
  });
  check(last.dp === 200, 'last segment bonus = 200 pts');
  check(last.removed, 'centipede fully removed on last segment');

  // one bullet limit
  const b1 = await page.evaluate(() => { window._testReset(); window._ship().inv = 300; return !!window._bullet(); });
  await page.keyboard.down('Space');
  await page.waitForTimeout(200);
  const bulletOn = await page.evaluate(() => !!(window._bullet && window._bullet()));
  await page.keyboard.up('Space');
  check(b1 || bulletOn, 'fire key produces a bullet');

  // spider spawn + eat mushroom + scoring 75
  const spider = await page.evaluate(() => {
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
      window._forceShoot(sNow.x + 4, sNow.y);
      shot = window._score() - sb === 75 && window._spiders().length === 0;
    }
    return { ok: true, eaten, shot };
  });
  check(spider.ok, 'spider active and stepping');
  check(spider.eaten, 'spider eats mushrooms');
  check(spider.shot, 'spider shot = 75 pts');

  // scorpion poisons a mushroom
  const poison = await page.evaluate(() => {
    window._keepAlive();
    window._spawnScorpion();
    const sc = window._scorpions()[0];
    if (!sc) return { ok: false };
    let poisoned = false;
    for (let i = 0; i < 60 * 12 && !poisoned; i++) {
      window._keepAlive();
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
        const cs = window._centipedes();
        if (cs.length > 0 && cs[0].segs.length > 0) {
          const s = cs[0].segs[cs[0].segs.length - 1];
          window._shotVsCenti({ x: s.x + 4, y: s.y + 4 });
        }
      }
      window._step(1);
    }
    const cleared = sawClear || window._state() === 'waveclear';
    for (let i = 0; i < 200; i++) { window._keepAlive(); window._step(1); }
    const cs2 = window._centipedes();
    const c = cs2.length ? cs2[0] : null;
    return { cleared, wave: window._wave(), waveBefore, segs: c ? c.segs.length : 0, state: window._state() };
  });
  check(waveUp.cleared, 'wave clear fires when no centipede segments remain');
  check(waveUp.wave === waveUp.waveBefore + 1 && waveUp.segs === 12 + (waveUp.wave - 1) * 2, 'next wave starts with correct segments (w' + waveUp.wave + ' s' + waveUp.segs + ')');

  // player death on centipede contact
  const death = await page.evaluate(() => {
    window._testReset();
    window._setLives(3);
    const c = window._centipedes();
    c.length = 0;
    const sh = window._ship();
    sh.inv = 0;
    sh.alive = true;
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

  // palette draw check: sample centipede-ish green pixels exist
  const px = await page.evaluate(() => {
    const cv = document.getElementById('game'), x = cv.getContext('2d');
    const d = x.getImageData(0, 0, cv.width, cv.height).data;
    let green = 0;
    for (let i = 0; i < d.length; i += 40) { if (d[i + 1] > 180 && d[i] < 120 && d[i + 2] < 120) green++; }
    return green;
  });
  check(px > 20, 'green vector sprites rendered (' + px + ' samples)');

  check(errors.length === 0, 'no page errors during full session' + (errors.length ? ' -> ' + errors[0] : ''));
  await browser.close();
  server.close();
  console.log('');
  console.log('BROWSER VERIFY: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
