---
name: seasonal-theme
description: Add, change or check a seasonal look on the Team Minimap maps (Christmas now; Tết, Halloween or another holiday next). Use when asked for holiday decorations, a seasonal theme, festive art, or when the Christmas look (tree, fairy lights, snow, Santa, sleigh) needs fixing.
---

# Seasonal looks on the map

A seasonal look dresses up both maps for some dates. It changes only how the map looks:
no server code, no stored data, no setting. The Christmas look is the working example.
Copy it.

## How the Christmas look works

| Part | Where |
|---|---|
| Which look shows on a date, the `?season=` preview, and every number both maps share (light colours, twinkle timing, where the big tree and Santa stand, the sleigh's trips) | `src/lib/season.ts`, tested in `src/lib/season.test.ts` |
| Picks the look once a minute, or takes the preview | `useSeason()` in `src/lib/hooks.ts`, read in `MonitorPage.tsx` and passed as `season` in `MapProps` (`src/map/types.ts`) |
| 2D art (SVG and CSS) | `src/map/Christmas2D.tsx`; furniture swaps in `FESTIVE_DECOR` (`src/map/decor.tsx`); placed in `Map2D.tsx` |
| 3D models (three.js shapes) | `src/map/christmas3d.ts`; placed and animated in `scene3d.ts`, section "Christmas" |
| Snow falling in dry weather (both maps) | `festive` prop of `WeatherOverlay.tsx` |

Its dates: 1–31 December (`'christmas'`), Santa and his sleigh included. It goes by the date on the screen showing the map, which hangs in the office.

## Rules to keep

- **2D and 3D together.** Every decoration exists in both maps, in the same place. Shared
  positions come from one function in `season.ts` (like `christmasTreeSpot`), never from
  numbers copied into both maps.
- **The date logic is pure.** Keep it in `src/lib/season.ts` with tests: the first and last
  day, the special days, the year boundary, and the preview names.
- **Easy to preview.** Each look gets a `previewSeason` name, so `/?season=<name>` shows it on
  any day. Mention it in the README.
- **Never hide what people use.** Decorations get `pointer-events: none` (2D) and stay out of
  the click targets (3D). Nothing may cover names, the notice board's text, or the PLAY and
  Start draw buttons. Check both maps, landscape and phone size.
- **Fill the rooms before you trust it.** Put about 15 people in Main Office (log in as
  `test01`–`test15`, PIN `1234`, after `npm run test-members`, and move them there) and check that
  no decoration sits behind someone. Office decorations shrink when the room is full
  (`crowdedWidth`).
- **People can walk around it.** In 3D, `block(x, z, halfW, halfD)` every decoration that stands
  on the floor, so wandering characters go round it.
- **Reduced motion.** Twinkling, waving and flying stop (`media.reducedMotion` in CSS,
  `reducedMotion` in the scene). The decorations stay, still.
- **Twinkling shows by day too.** In 3D, a toon material lit by the sun barely changes when its
  glow changes, so fairy lights are unlit `MeshBasicMaterial`s whose colour is dimmed nearly
  dark and back (`lightBulbs` in `christmas3d.ts`). Do the same for any new blinking light.
- **Colours say the holiday.** Christmas leans on red and green with some gold
  (`LIGHT_COLOURS`, presents, bows, holly). Pick a look's colours once and use them in both maps.
- **Night.** Lights should glow after dark: in 2D through `--night` and `--lamps`, in 3D
  through `lampLevel`, emissive materials, and the shared `lampGlow` sprite.
- **Cheap on an always-on TV.** Share materials (`mat`, `festiveMaterials`), animate a few
  materials instead of many meshes, and build decorations with the town (`buildWorld`), not
  every frame. `setSeason` rebuilds the town only when the look changes.
- **Not fixed until the next day.** The look comes from `useNow`, so it changes at midnight
  without a reload.

## Adding another look (for example Tết)

1. In `season.ts`, add the name to `Season`, its dates to `seasonOn`, and its preview to
   `previewSeason`. If the new look isn't the Christmas look, don't let `isFestive` return true
   for it. Give the new look its own check (for example `isTet`). Add tests.
2. Draw its 2D art in its own `src/map/<Look>2D.tsx` and its 3D models in
   `src/map/<look>3d.ts`, with the same parts in each.
3. Place them where `Map2D.tsx` and `scene3d.ts` place the Christmas parts, under the new check.
4. Update the README ("Christmas on the map" is the example) and the "Christmas look" table in
   `AGENTS.md`.
5. Run `npm run typecheck`, `npm test` and `npm run build`.

## Checking it by eye

With `npm run dev:api` and `npm run dev` running, open these pages, in 2D (`mode=2d`) and 3D
(`mode=3d`), wide and at phone width:

- `http://localhost:5173/?season=christmas`
- `http://localhost:5173/?season=christmas&time=night`
- `http://localhost:5173/?season=none`: the map must look exactly as it does on other days.
