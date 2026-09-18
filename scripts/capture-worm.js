const { chromium } = require('/Users/davidpence/.hermes/node/lib/node_modules/playwright');
const http = require('http'), fs = require('fs'), path = require('path');
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
  // start game, freeze nothing, let the worm crawl and bite for a while
  await page.evaluate(() => { window._startGame(); window._keepAlive(); });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: '/tmp/centipede/worm-play.png' });
  // mid-crawl: check worm stretched state + grown length
  const info = await page.evaluate(() => {
    const cs = window._centipedes();
    return { state: window._state(), n: cs.length, lens: cs.map(c => c.segs.length), bites: cs.map(c => c.bites), score: window._score() };
  });
  // fill-rate forensics
  const px = await page.evaluate(() => {
    const cv = document.getElementById('game'), x = cv.getContext('2d');
    const d = x.getImageData(0, 0, cv.width, cv.height).data;
    let nonblack = 0, total = 0, buckets = {};
    for (let i = 0; i < d.length; i += 16) {
      total++;
      const r = d[i], g = d[i + 1], b = d[i + 2];
      if (r + g + b > 60) { nonblack++; const k = (r >> 5) + ',' + (g >> 5) + ',' + (b >> 5); buckets[k] = (buckets[k] || 0) + 1; }
    }
    const top = Object.entries(buckets).sort((a, b) => b[1] - a[1]).slice(0, 6);
    return { pct: (nonblack / total * 100).toFixed(1), top };
  });
  console.log('state:', info.state, 'centipedes:', info.n, 'lengths:', JSON.stringify(info.lens), 'bites:', JSON.stringify(info.bites), 'score:', info.score);
  console.log('fill:', px.pct + '% non-black; top buckets:', JSON.stringify(px.top));
  console.log('errors:', errs.length ? errs[0] : 'none');
  await browser.close();
  server.close();
})().catch(e => { console.error('CAP ERR', e); process.exit(2); });
