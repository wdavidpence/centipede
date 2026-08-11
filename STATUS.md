# CENTIPEDE GAME - WORK IN PROGRESS

## Status: Arcade-authentic overhaul substantially complete (2026-08-10)

### Completed
1. **Player sprite** - Humanoid head with gun barrel (matching original "somewhat humanoid head")
2. **2D movement** - Full up/down/left/right like trackball, clamped to bottom half of field
3. **Bullet limit** - 1 at a time (original constraint)
4. **Centipede head** - Same oval shape as body segments with different color + tiny antennae
5. **Centipede body** - Uses stage colors (not rainbow gradient), animated conveyor-belt legs
6. **Centipede tail** - Smaller oval with gentle wag
7. **Fast/slow waves** - Odd waves fast (2px/frame), even waves slow (0.75px/frame)
8. **Segment count** - 15 on wave 1, +2 per wave, max 24 (original formula)
9. **Scoring** - Head=100, segment=10, scorpion=100, spider=75, saucer=250, mushroom=+1/shot
10. **Saucer shooting** - Flying saucers fire orange bullets downward at player
11. **Scorpions** - Spawn from destroyed heads (wave 2+), seek player
12. **Spiders** - Dropped by saucers (wave 3+), jump toward player, destroy mushrooms
13. **Color cycling** - 6 distinct palettes per stage (centipede head/tail, mushroom)
14. **Field border** - Always green (original didn't cycle border color)
15. **Background** - Pure black (no grid lines)
16. **HUD** - Lives shown as small player head sprites
17. **Attract screen** - Proper layout with title, field, scores, start prompt
18. **Wave clear/NEXT WAVE** - Authentic styling with pulsing glow
19. **Game over screen** - Bold text, high score display, blinking restart prompt
20. **Responsive scaling** - Canvas transform system at 240x500 game coords
21. **Extra life** - Every 10,000 points
22. **ctx.restore() fixed** - Balanced save/restore throughout

### Remaining Gaps
- Sound effects could be more authentic (currently using Web Audio API oscillators)
- Scorpion visual polish (currently decent but could be more bitmap-like)
- Centipede speed could use fine-tuning
- Touch controls for mobile (basic implementation exists)

### Architecture
- Single file: `/Users/davidpence/centipede/index.html` (~1450 lines)
- Game logic at fixed FIELD_W=240, FIELD_H=500 (field-relative coords)
- Rendering uses ctx.translate(OX,OY) + ctx.scale(SCALE,SCALE)

### GitHub
- Repo: wdavidpence/centipede (gh-pages branch)
- Live: https://wdavidpence.github.io/centipede/
