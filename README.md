# Centipede

A faithful browser recreation of the 1981 Atari arcade classic (design:
Ed Logg / Dona Bailey). Original code, no ROMs or ripped assets.

## Fidelity model
- 30x28 cell grid; centipede snakes one cell at a time
- ONLY the head drops a row and reverses when blocked; body winds via
  a trail buffer (authentic serpentine descent)
- Body hit: 10 pts, split into two, both halves SAME direction, shot
  segment becomes a mushroom
- Head hit: 100 pts, body continues; last segment alone: +200 bonus
- Mushrooms: 4 hits, 5 pts per hit, shrink with damage
- Poison mushrooms (from scorpions) turn centipedes purple and make
  them plunge downward
- Spider (75): erratic, eats mushrooms. Scorpion (100): poisons
  mushrooms. Saucer (50): fires at player, breaks into spiders
- Exploding mushrooms burst into 6 bouncing mushrooms; while bouncing,
  centipede hits score x5 (head 500 / body 50)
- One bullet on screen at a time (trackball rule); player bounded to
  the bottom lane
- 12 segments wave 1, +2 per wave; odd waves fast, even waves slow
- Extra life every 10,000 points (max 9)
- Stage color cycling, attract mode with scoring table

## Run
    python3 -m http.server 8000

## Test
    npm test              # static smoke tests
    npm run verify        # Playwright gameplay verification (30 checks)
