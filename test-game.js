const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  let errors = [];
  page.on('pageerror', err => { errors.push(err.message); });

  await page.goto('http://localhost:8765/');
  await page.waitForTimeout(1000);

  // Check for JS errors first
  console.log('=== JS ERRORS ===');
  console.log(errors.length > 0 ? errors.join('\n') : 'No JS errors');

  // Test: game state after load
  const init = await page.evaluate(() => {
    return {
      W: window.innerWidth, H: window.innerHeight,
      score, lives, wave, gameOver,
      shipX: ship ? ship.x : null,
      shipY: ship ? ship.y : null,
      bulletCount: bullets.length,
      centiCount: centipedes.length,
      mushCount: mushrooms.length,
      FIELD_W, MUSH_COLS, MUSH_ROWS
    };
  });
  console.log('\n=== INIT STATE ===');
  console.log(JSON.stringify(init, null, 2));

  // Test: fire bullets and check they spawn
  const fireTest = await page.evaluate(() => {
    // Simulate pressing fire
    keys.fire = true;
    // Manually trigger one frame of bullet creation
    if (keys.fire && bullets.length < 5) {
      keys.fire = false;
      bullets.push({ x: ship.x, y: ship.y - 8, dy: -10 });
    }
    return { bulletCount: bullets.length, lastBulletY: bullets[bullets.length-1].y };
  });
  console.log('\n=== FIRE TEST ===');
  console.log(JSON.stringify(fireTest, null, 2));

  // Test: centipede positions and movement
  const centiTest = await page.evaluate(() => {
    if (centipedes.length === 0) return 'no centipedes';
    const c = centipedes[0];
    return {
      segCount: c.segs.length,
      headX: c.segs[0].x,
      headY: c.segs[0].y,
      dirX: c.dirX,
      speed: c.speed,
      trailLen: c.trail ? c.trail.length : 0,
      allSegsAboveZero: c.segs.every(s => s.y < 0), // initially above screen
    };
  });
  console.log('\n=== CENTIPEDE TEST ===');
  console.log(JSON.stringify(centiTest, null, 2));

  // Test: run several frames and check centipede movement
  const moveTest = await page.evaluate(() => {
    // Clear bullets to avoid collision noise
    bullets.length = 0;

    const c = centipedes[0];
    if (!c) return 'no centipede';

    const headBefore = { x: c.segs[0].x, y: c.segs[0].y };

    // Run 60 frames of centipede update
    for (let i = 0; i < 60; i++) {
      for (let ci = centipedes.length - 1; ci >= 0; ci--) {
        updateCenti(centipedes[ci]);
      }
    }

    const headAfter = { x: c.segs[0].x, y: c.segs[0].y };
    return {
      headBefore,
      headAfter,
      dx: headAfter.x - headBefore.x,
      dy: headAfter.y - headBefore.y,
      movedRight: c.dirX === 1 ? headAfter.x > headBefore.x : headAfter.x < headBefore.x,
      movedDown: headAfter.y > headBefore.y,
    };
  });
  console.log('\n=== MOVEMENT TEST ===');
  console.log(JSON.stringify(moveTest, null, 2));

  // Test: bullet-centipede collision
  const collisionTest = await page.evaluate(() => {
    // Reset state for clean test
    bullets.length = 0;

    const c = centipedes[0];
    if (!c) return 'no centipede';

    const segsBefore = c.segs.length;
    const totalCentisBefore = centipedes.length;

    // Place bullet directly on head
    const head = c.segs[0];
    bullets.push({ x: head.x, y: head.y });

    // Run collision check
    checkCollisions();

    return {
      segsBefore,
      totalCentisBefore,
      segsAfter: c.segs.length,
      totalCentisAfter: centipedes.length,
      scoreDelta: score - init.score, // approximate
    };
  });
  console.log('\n=== COLLISION TEST ===');
  console.log(JSON.stringify(collisionTest, null, 2));

  // Test: mushroom positions
  const mushTest = await page.evaluate(() => {
    if (mushrooms.length === 0) return 'no mushrooms';
    const m = mushrooms[0];
    return {
      count: mushrooms.length,
      firstMushX: m.x,
      firstMushY: m.y,
      mushW: m.w,
      mushH: m.h,
      mushHP: m.hp,
    };
  });
  console.log('\n=== MUSHROOM TEST ===');
  console.log(JSON.stringify(mushTest, null, 2));

  // Test: ship boundary clamping
  const clampTest = await page.evaluate(() => {
    // Move ship way left
    ship.x = -100;
    if (keys.left) ship.x = Math.max(12, ship.x - 6);
    // Simulate one frame of left movement
    keys.left = true;
    ship.x = Math.max(12, ship.x - 6);
    const leftClamp = ship.x;

    // Move ship way right
    ship.x = FIELD_W + 100;
    keys.right = true;
    ship.x = Math.min(FIELD_W - 12, ship.x + 6);
    const rightClamp = ship.x;

    keys.left = false;
    keys.right = false;
    return { leftClamp, rightClamp, FIELD_W };
  });
  console.log('\n=== CLAMP TEST ===');
  console.log(JSON.stringify(clampTest, null, 2));

  // Test: game over condition
  const goTest = await page.evaluate(() => {
    // Simulate centipede reaching bottom
    const c = centipedes[0];
    if (!c) return 'no centipede';
    c.segs[0].y = H + 100; // way below bottom
    gameOver = false;
    updateCenti(c);
    return { gameOver, headY: c.segs[0].y };
  });
  console.log('\n=== GAME OVER TEST ===');
  console.log(JSON.stringify(goTest, null, 2));

  // Test: wave progression
  const waveTest = await page.evaluate(() => {
    // Clear all centipedes to trigger wave clear
    const before = { wave, waveClearMsg: waveClearMsg || '', nextWaveDelay };
    centipedes.length = 0;
    checkWaveClear();
    return {
      before,
      after: { waveClearMsg, nextWaveDelay },
    };
  });
  console.log('\n=== WAVE TEST ===');
  console.log(JSON.stringify(waveTest, null, 2));

  // Test: touch controls exist
  const touchTest = await page.evaluate(() => {
    return {
      hasLeftBtn: !!document.querySelector('.btn.left'),
      hasRightBtn: !!document.querySelector('.btn.right'),
      hasFireBtn: !!document.querySelector('.btn.fire'),
    };
  });
  console.log('\n=== TOUCH TEST ===');
  console.log(JSON.stringify(touchTest, null, 2));

  // Test: canvas sizing
  const canvasTest = await page.evaluate(() => {
    return {
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
    };
  });
  console.log('\n=== CANVAS TEST ===');
  console.log(JSON.stringify(canvasTest, null, 2));

  // Test: screenshot for visual inspection
  await page.screenshot({ path: '/Users/davidpence/centipede/screenshot.png' });
  console.log('\nScreenshot saved to /Users/davidpence/centipede/screenshot.png');

  await browser.close();
})();
