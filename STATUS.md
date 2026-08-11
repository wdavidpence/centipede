# CENTIPEDE GAME - WORK IN PROGRESS

## Status: Steps 1-9 COMPLETE, Responsive scaling added (2026-08-10)

### Completed
1. **Visual overhaul** - Vector-style neon graphics, pure black background, animated centipede legs (conveyor belt), rainbow body gradient, pulsing mushrooms
2. **Scorpions** - Spawn from destroyed centipede heads (wave 2+), 3 states (cocoon/emerging/moving), seek player with mushroom avoidance, vector-style drawing with pincers/tail/legs
3. **Flying Saucers + Spiders** - Saucers spawn every 8s (wave 3+), move across top, drop spiders that fall then jump toward player. Spiders destroy mushrooms on contact.
4. **Grid-based movement** - Deferred (trail-based system already produces serpentine descent)
5. **Color cycling** - 6 distinct palettes cycling every wave (head, tail, mushroom, border colors all shift per stage)
6. **Authentic title screen** - Animated centipede crawls across field on attract mode, score table showing all enemy point values
7. **Mushroom density** - Grid-based placement (30x28 grid) at ~65% fill, bottom 3 rows clear for player
8. **Sound improvements** - Sharper shoot, longer explode, square-wave hit, 5-note wave clear jingle, saucer hum, bonus fanfare
9. **Polish** - Bonus sound on centipede kill, all stage colors applied, scoring table on attract screen
10. **Responsive scaling** - Canvas transform system: game logic at 240x500 fixed coords, rendered at screen size via ctx.translate/scale

### Architecture
- Single file: `/Users/davidpence/centipede/index.html` (~1450 lines)
- Game logic at fixed FIELD_W=240, FIELD_H=500 (field-relative coords)
- Rendering uses ctx.translate(OX,OY) + ctx.scale(SCALE,SCALE) for responsive display
- All draw functions take entity only (no ox param) — coords are field-relative
- Attract screen: field content in scaled context, text/HUD in screen coords

### Scoring
- Centipede segment: +10
- Centipede head: +50 (spawns scorpion on wave 2+)
- Last centipede segment: +200 BONUS
- Scorpion: +100
- Spider: +75
- Flying saucer: +250
- Mushroom (per shot): +5

### Known Issues / TODOs
- Ship speed (6px/frame) and bullet speed (10px/frame) may feel too fast at high SCALE values — could scale movement by 1/SCALE
- Centipede speed formula (1.0 + wave*0.08) doesn't alternate fast/slow like original
- Original had trackball controls; we use arrow keys + touch buttons
- No "Insert Coin" or multiplayer support

### GitHub
- Repo: wdavidpence/centipede (gh-pages branch)
- Live: https://wdavidpence.github.io/centipede/

### Running
- Open `/Users/davidpence/centipede/index.html` in any browser
- No build step required (single HTML file)
