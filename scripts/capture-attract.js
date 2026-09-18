const { chromium } = require('/Users/davidpence/.hermes/node/lib/node_modules/playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = '/Users/davidpence/centipede';
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  let p = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const f = path.join(root, p);
  if (!fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': mime[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
(async () => {
  await new Promise(r => server.listen(8942, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://localhost:8942/', { waitUntil: 'networkidle' });
  // capture attract at several beats of the palette cycle
  for (const [ms, name] of [[600, 'attract-a'], [4000, 'attract-b'], [8000, 'attract-c']]) {
    await page.waitForTimeout(ms === 600 ? 600 : 3400);
    await page.screenshot({ path: '/tmp/centipede/' + name + '.png' });
  }
  // fill-rate forensics on attract frame
  const info = await page.evaluate(() => {
    const cv = document.getElementById('game'), x = cv.getContext('2d');
    const d = x.getImageData(0, 0, cv.width, cv.height).data;
    let nonblack = 0, total = 0;
    const buckets = {};
    for (let i = 0; i < d.length; i += 40) {
      total++;
      const r = d[i], g = d[i + 1], b = d[i + 2];
      if (Math.max(r, g, b) > 24) {
        nonblack++;
        const key = (r >> 5) + ',' + (g >> 5) + ',' + (b >> 5);
        buckets[key] = (buckets[key] || 0) + 1;
      }
    }
    const top = Object.entries(buckets).sort((a, b) => b[1] - a[1]).slice(0, 8);
    return { state: window._state(), pct: (nonblack / total * 100).toFixed(1), top, errors: 0 };
  });
  console.log(JSON.stringify({ ...info, pageErrors: errors }, null, 1));
  await browser.close();
  server.close();
})().catch(e => { console.error(e); process.exit(2); });
