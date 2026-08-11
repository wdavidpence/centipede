# CENTIPEDE GAME - WORK IN PROGRESS

## Status: Arcade-authentic overhaul (2026-08-11)

### Completed
1. **Player sprite** - Humanoid head with gun barrel (matching original)
2. **2D movement** - Full up/down/left/right like trackball, clamped to bottom half
3. **Bullet limit** - 1 at a time (original constraint)
4. **Centipede head** - Rectangular shape with antennae, stage color
5. **Centipede body** - Rectangular segments, all same stage color, jumpy 4-frame legs
6. **Centipede tail** - Smaller rectangle with wag, same color as head/body
7. **Fast/slow waves** - Odd waves fast (2px/frame), even waves slow (0.75px/frame)
8. **Segment count** - 15 on wave 1, +2 per wave, max 24
9. **Scoring** - Head=100, segment=10, scorpion=100, spider=75, saucer=250, mushroom=+1/shot
10. **Saucer shooting** - Flying saucers fire orange bullets at player (wave 3+)
11. **Saucer color** - Yellow/gold (#ffcc00) matching original
12. **Scorpions** - Spawn from destroyed heads (wave 2+), seek player, jumpy 4-frame animation
13. **Spiders** - Dropped by saucers, jump toward player, jumpy 4-frame legs
14. **Color cycling** - 6 palettes per stage (centipede, mushroom)
15. **Field border** - Always green (#00ff44)
16. **Background** - Pure black (no grid lines)
17. **HUD** - Lives as rectangular player heads, score/wave/high score
18. **Attract screen** - Compact layout: title (40px), field with demo mushrooms+centipede, score table, start prompt
19. **Wave clear** - "WAVE CLEARED!" with pulsing green glow
20. **Game over** - Bold red text, score/wave display, blinking restart prompt
21. **Responsive scaling** - Canvas transform at 240x500 game coords
22. **Extra life** - Every 10,000 points
23. **Particles** - Radial spread with variable speed
24. **Sound effects** - Web Audio API (shoot, explode, bonus, waveclear, gameover, hurt, mushroom)
25. **No connection lines** between centipede segments (cleaner look)

### Remaining Gaps
- Visual testing needed: attract screen layout, HUD overlap (Safari banner blocks view)
- Could add more mushroom variety/detail
- Could improve centipede downward drop timing
- Could add authentic attract mode music loop

### Architecture
- Single file: `/Users/davidpence/centipede/index.html` (~1480 lines)
- Game logic at fixed FIELD_W=240, FIELD_H=500 (field-relative coords)
- Rendering uses ctx.translate(OX,OY) + ctx.scale(SCALE,SCALE)

### GitHub
- Repo: wdavidpence/centipede (gh-pages branch)
- Live: https://wdavidpence.github.io/centipede/
