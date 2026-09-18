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
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto('http://localhost:8947/', { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    window._startGame(); window._keepAlive();
    window._spiders().length = 0; window._scorpions().length = 0; window._saucers().length = 0;
    const c = window._centipedes()[0]; c.maxSegs = 24;
  });
  await page.waitForTimeout(9000);
  const geo = await page.evaluate(() => {
    const c = window._centipedes()[0];
    const pts = c.segs.map(s => [Math.round(s.x), Math.round(s.y)]);
    // min gap between consecutive segs (continuity metric)
    let gaps = [];
    for (let i = 1; i < pts.length; i++)
      gaps.push(Math.round(Math.hypot(pts[i][0]-pts[i-1][0], pts[i][1]-pts[i-1][1])));
    return { n: pts.length, bites: c.bites, maxGap: Math.max(...gaps), minGap: Math.min(...gaps), rows: [...new Set(pts.map(p=>p[1]))].length };
  });
  console.log('n', geo.n, 'bites', geo.bites, 'gapMin', geo.minGap, 'gapMax', geo.maxGap, 'rowsOccupied', geo.rows);
  await page.screenshot({ path: '/tmp/centipede/worm2.png' });
  console.log('errors:', errs.length ? errs[0] : 'none');
  await browser.close();
  server.close();
})().catch(e => { console.error('ERR', e); process.exit(2); });
