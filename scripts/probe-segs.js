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
  await page.goto('http://localhost:8947/', { waitUntil: 'networkidle' });
  const d = await page.evaluate(() => {
    window._testReset(); window._keepAlive();
    window._freeze(true);
    const cs = window._centipedes();
    cs.length = 0;
    const segs = [];
    for (let i = 0; i < 12; i++) segs.push({ x: (14 - i) * 8, y: 8 });
    const c = window._makeCenti(segs, 1);
    cs.push(c);
    window._freeze(false);
    window._step(20);
    return {
      segs: c.segs.map(s => [Math.round(s.x), Math.round(s.y)]),
      trailLen: c.trail.length,
    };
  });
  console.log('trailLen', d.trailLen);
  console.log('segX:', d.segs.map(p => p[0]).join(','));
  console.log('segY:', d.segs.map(p => p[1]).join(','));
  await browser.close();
  server.close();
})().catch(e => { console.error('ERR', e); process.exit(2); });
