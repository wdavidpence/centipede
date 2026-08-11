# CENTIPEDE GAME - WORK IN PROGRESS

## Status: Arcade-authentic overhaul in progress (2026-08-10)

### Completed
1. **Visual overhaul** - Vector-style neon graphics, pure black background (no grid lines)
2. **Player sprite** - Humanoid head with gun barrel (matching original "somewhat humanoid head")
3. **2D movement** - Full up/down/left/right like trackball, clamped to bottom half of field
4. **Bullet limit** - 1 at a time (original constraint)
5. **Centipede head** - Same oval shape as body segments with different color + tiny antennae
6. **Centipede body** - Uses stage colors (not rainbow gradient), animated conveyor-belt legs
7. **Centipede tail** - Smaller oval with gentle wag
8. **Fast/slow waves** - Odd waves fast, even waves slow (matching original)
9. **Scoring** - Head=100, segment=10, scorpion=100, spider=75, saucer=250, mushroom=+1/shot
10. **Saucer shooting** - Flying saucers fire orange bullets downward at player
11. **Scorpions** - Spawn from destroyed heads (wave 2+), seek player
12. **Spiders** - Dropped by saucers, jump toward player, destroy mushrooms
13. **Color cycling** - 6 distinct palettes per stage
14. **Attract screen** - Proper layout with title, field, scores, start prompt
15. **Responsive scaling** - Canvas transform system at 240x500 game coords

### Remaining Gaps
- Centipede speed tuning (may need adjustment)
- Scorpion visual polish
- Wave transition animations
- Sound effect authenticity
- Touch controls for mobile
- Extra life at 10,000 points (present)

### Architecture
- Single file: `/Users/davidpence/centipede/index.html` (~1460 lines)
- Game logic at fixed FIELD_W=240, FIELD_H=500 (field-relative coords)
- Rendering uses ctx.translate(OX,OY) + ctx.scale(SCALE,SCALE)

### GitHub
- Repo: wdavidpence/centipede (gh-pages branch)
- Live: https://wdavidpence.github.io/centipede/
