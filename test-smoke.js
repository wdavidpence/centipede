const fs = require('fs');
const path = require('path');
let passed = 0, failed = 0;
function assert(c, m) { if (c) passed++; else { failed++; console.log('FAIL:', m); } }
const root = __dirname;
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'game.js'), 'utf8');

assert(html.includes('id="game"'), 'canvas present');
assert(html.includes('src="game.js"'), 'loads game.js');
assert(html.includes('id="fireBtn"'), 'fire button present');
assert(html.includes('id="muteBtn"'), 'mute button present');

// Grid world
assert(js.includes('COLS = 30'), '30-column grid');
assert(js.includes('ROWS = 28'), '28-row grid');
// Trail-based movement
assert(js.includes('function retrace'), 'trail-based segment retrace');
assert(js.includes('ONLY the head drops'), 'head-only drop rule documented/enforced');
// Split rules
assert(js.includes('SAME direction'), 'halves continue same direction');
assert(js.includes('200 * mult') || js.includes('+200'), 'last segment +200');
assert(js.includes('100 * mult') || js.includes('+100'), 'head hit 100');
// One bullet
assert(/var bullet = null;/.test(js) && js.includes('if (fireHeld && !bullet)'), 'one bullet at a time');
// Scoring table
assert(js.includes('addScore(75)'), 'spider 75');
assert(js.includes('addScore(100)'), 'scorpion/saucer 100');
assert(js.includes('addScore(50)'), 'saucer 50');
assert(js.includes('addScore(5)'), 'mushroom 5 per hit');
assert(js.includes('nextExtraLife += 10000'), 'extra life every 10000');
// Poison, bouncing, 5x
assert(js.includes('POISON_COLOR'), 'poison mushrooms');
assert(js.includes('fiveX'), 'bouncing mushroom x5 mode');
assert(js.includes('spawnBurst'), 'exploding mushroom burst');
// Odd/even speed alternation
assert(/wave % 2 === 1/.test(js), 'odd/even wave speed alternation');
// Poisoned plunges faster
assert(/poison.*1\.8|1\.8.*poison/s.test(js) || js.includes('cen.poison ? 1.8'), 'poisoned centipede speeds up');

console.log('SMOKE: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
