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
  await page.evaluate(() => {
    window._startGame(); window._keepAlive();
    window._spiders().length = 0; window._scorpions().length = 0; window._saucers().length = 0;
    window._freeze(true);
    const cs = window._centipedes(); cs.length = 0;
    const segs = [];
    for (let i = 0; i < 12; i++) segs.push({ x: 80 - i * 8, y: 88 });
    const c = window._makeCenti(segs, 1);
    cs.push(c);
    window._freeze(false); window._step(1); window._freeze(true);
    window._spiders().length = 0; window._scorpions().length = 0;
  });
  await page.waitForTimeout(200);
  const out = await page.evaluate(() => {
    const cv = document.getElementById('game'), ctx = cv.getContext('2d');
    const c = window._centipedes()[0];
    const dpr = cv.width / cv.clientWidth;
    const W = cv.clientWidth, H = cv.clientHeight;
    let SC = Math.min((W-16)/240, (H-34-20)/224); SC = Math.max(0.5, Math.min(SC, 6));
    const OX = Math.floor((W-240*SC)/2), OY = Math.floor(34+(H-34-224*SC)/2);
    const toScreen = (x, y) => [ (OX + x*SC)*dpr, (OY + y*SC)*dpr ];
    const px = (x, y) => { const [sx, sy] = toScreen(x, y);
      const d = ctx.getImageData(Math.round(sx), Math.round(sy), 1, 1).data; return [d[0], d[1], d[2]]; };
    const segs = c.segs.map(s => [s.x + 4, s.y + 4]);
    const headColor = px(segs[0][0], segs[0][1]);
    const bodyColors = segs.slice(1).map(s => px(s[0], s[1]));
    // gaps between consecutive segments: sample 5 points along each join
    const joinColors = [];
    for (let i = 1; i < Math.min(8, segs.length); i++) {
      for (let t = 0.2; t < 0.85; t += 0.2) {
        joinColors.push(px(segs[i-1][0] + (segs[i][0]-segs[i-1][0])*t, segs[i-1][1] + (segs[i][1]-segs[i-1][1])*t));
      }
    }
    const lum = c2 => (c2[0]*0.299 + c2[1]*0.587 + c2[2]*0.114);
    const darkJoins = joinColors.filter(c2 => lum(c2) < 25).length;
    return { headColor, bodyLum: bodyColors.map(l2 => Math.round(lum(l2))),
      joinLum: joinColors.map(c2 => Math.round(lum(c2))), darkJoins, joins: joinColors.length };
  });
  console.log(JSON.stringify(out));
  await browser.close();
  server.close();
})().catch(e => { console.error('ERR', e); process.exit(2); });
