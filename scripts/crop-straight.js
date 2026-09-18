const { chromium } = require('/Users/davidpence/.hermes/node/lib/node_modules/playwright');
const http = require('http'), path = require('path'), fs = require('fs');
const root = '/Users/davidpence/centipede';
const mime = { '.html': 'text/html', '.js': 'text/javascript' };
const server = http.createServer((req, res) => {
  let p = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const f = path.join(root, p);
  if (!fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': mime[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
(async () => {
  await new Promise(r => server.listen(8947, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 3 });
  await page.goto('http://localhost:8947/', { waitUntil: 'networkidle' });
  const clip = await page.evaluate(() => {
    window._startGame(); window._keepAlive();
    const cs = window._centipedes(); cs.length = 0;
    const segs = [];
    for (let i = 0; i < 16; i++) segs.push({ x: 168 - i * 8, y: 96 });
    const c = window._makeCenti(segs, -1);
    c.chomp = 10;
    cs.push(c);
    window._freeze(true);
    window._bullets().length = 0;
    const sh = window._ship(); sh.x = 12;   // park cannon off the worm lane
    window._spiders().length = 0; window._scorpions().length = 0; window._saucerShots().length = 0;
    const cv = document.getElementById('game');
    const W = cv.clientWidth, H = cv.clientHeight;
    let SC = Math.min((W-16)/240, (H-34-20)/224); SC = Math.max(0.5, Math.min(SC, 6));
    const OX = Math.floor((W-240*SC)/2), OY = Math.floor(34+(H-34-224*SC)/2);
    // worm spans field x 168-12*8=72 .. 176, y 96
    return { x: OX + 60 * SC - 12, y: OY + 96 * SC - 14, width: (176 - 60) * SC + 24, height: 28 * SC };
  });
  await page.evaluate(() => { window._bullets().length = 0; window._freeze(true); });
  await page.screenshot({ path: '/tmp/centipede/worm-straight.png', clip });
  const alive = await page.evaluate(() => window._centipedes()[0].segs.length);
  console.log('worm alive at capture:', alive);
  await browser.close();
  server.close();
})().catch(e => { console.error('ERR', e); process.exit(2); });
