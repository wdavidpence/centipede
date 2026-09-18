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
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto('http://localhost:8947/', { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    window._startGame(); window._keepAlive();
    window._spiders().length = 0; window._scorpions().length = 0; window._saucers().length = 0;
    window._centipedes()[0].maxSegs = 24;
  });
  let geo = null;
  for (let i = 0; i < 14; i++) {
    await page.waitForTimeout(1000);
    geo = await page.evaluate(() => {
      const c = window._centipedes()[0];
      const cv = document.getElementById('game');
      const W = cv.clientWidth, H = cv.clientHeight;
      let SC = Math.min((W-16)/240, (H-34-20)/224); SC = Math.max(0.5, Math.min(SC, 6));
      const OX = Math.floor((W-240*SC)/2), OY = Math.floor(34+(H-34-224*SC)/2);
      let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;
      c.segs.forEach(s=>{x0=Math.min(x0,s.x);y0=Math.min(y0,s.y);x1=Math.max(x1,s.x+8);y1=Math.max(y1,s.y+8);});
      return { n: c.segs.length, bites: c.bites, SC,
        clip: { x: OX + x0*SC - 16, y: OY + y0*SC - 16, w: (x1-x0)*SC + 32, h: (y1-y0)*SC + 32 } };
    });
    if (geo.n >= 14 && geo.clip.w > 120 && geo.clip.h > 60) break;
  }
  console.log('worm', geo.n, 'bites', geo.bites, 'clip', JSON.stringify(geo.clip));
  await page.screenshot({ path: '/tmp/centipede/worm-final.png' });
  await page.screenshot({ path: '/tmp/centipede/worm-crop.png',
    clip: { x: Math.max(0, geo.clip.x), y: Math.max(0, geo.clip.y),
            width: Math.max(40, geo.clip.w), height: Math.max(40, geo.clip.h) } });
  console.log('errors:', errs.length ? errs[0] : 'none');
  await browser.close();
  server.close();
})().catch(e => { console.error('ERR', e); process.exit(2); });
