# Working on Team Minimap (guide for coding agents)

Read this before you change anything. It holds the house rules and a map from each feature to its code, so you can open the right files without reading the whole project first. When you add, move or rename a feature, update the map at the end of this file in the same change.

## What the project is

A small React + TypeScript app that shows where the team works today, on a 2D and a 3D map, with a basketball arcade in the park. One API (`server/core.ts`) runs in two places:

- **Node.js** (`server/server.ts`): data is kept in a JSON file, `data/data.json`. Used locally and in Docker.
- **Cloudflare Workers** (`worker/index.ts`): the same data is kept as one value (key `data`) in the `Minimap` Durable Object named `team`. Only `main` is deployed.

Features with their own data live in their own folder (`server/basketball/`, `server/vote/`, `server/fund/`, `server/celebrate/`, `server/pet/`) and keep their own file (`data/basketball.json`, `data/vote.json`, `data/fund.json`, `data/celebrate.json`, `data/pet.json`) or storage key (`basketball`, `vote`, `fund`, `celebrate`, `pet`).

`core.ts` never knows where data comes from or goes to. The host hands it `saved`, `save()` and `onChange()`, and does the same for each feature. A feature's `save()` may return a promise: on Cloudflare it resolves once the write is stored.

## House rules

### Keep it simple, clean and robust
- Write the smallest change that solves the task, and don't build for needs nobody has asked for yet.
- Don't add a dependency when a few lines will do. The Node server uses built-ins only, and should stay that way.
- Check every value that comes from a request on the server (types, lengths, limits), like the `clean*` functions in `core.ts` do. Throw `ApiError(status, message)` for bad input. Never trust the browser.
- Messages shown to people are plain, short sentences that say what to do next.
- Keep logic that doesn't touch React, the DOM or three.js in `src/lib/*.ts` or `shared/*.ts`, with a `*.test.ts` next to it. That is how the picker, layout, ambience, status, drawing, wander, basketball and voting rules are built. A `shared/*.test.ts` is type-checked by `server/tsconfig.json`, like the server's tests.
- Comments say *why*, in plain words. Every file starts with a comment that says what it is for. Keep that comment, and write one for every new file.
- TypeScript is run directly by Node (type stripping), so use erasable syntax only: no `enum`, no `namespace`, and no constructor parameter properties. Import local files with their `.ts` / `.tsx` extension.
- Keep 2D and 3D in step. A change to how the map looks or behaves usually needs both `src/map/Map2D.tsx` and `src/map/scene3d.ts`, so put the shared rules in `src/lib/`. Every 3D view must still work in 2D when WebGL is missing or lost (`supportsWebGL`, `watchContextLoss`).

### UI: a heavy feature gets its own page
- A small control or panel can go into an existing page.
- A big feature (a game, a dashboard, an editor, anything with its own state or 3D scene) gets **its own page** instead of making `MonitorPage`, `MePage` or `AdminPage` bigger. Steps:
  1. Add `src/pages/<Feature>Page.tsx`, starting with a one-line comment about what it is for.
  2. Add the path to the `switch` in `src/main.tsx`, and load the page with `lazy()` so other pages don't download it.
  3. Add the path to `PAGES` in **both** `server/server.ts` and `worker/index.ts`. If you miss one, the page returns 404 on that host.
  4. Add a row to the Pages table in `README.md`.
- If the feature must open from the map (as the arcade does), keep only a small entry point on the map, such as a button or cabinet, and link to the page or `lazy()`-load the rest.
- Load three.js scenes and other heavy components with `lazy()`, as `Map3D`, `ClawMachine3D` and `BasketballCourt3D` are loaded.
- Use the shared controls in `src/styles/ui.ts` and the tokens in `src/styles/theme.ts` before making new ones.

### API and data: a new feature gets its own module and its own data file
Don't add new features to `server/core.ts` or to the main `Data` / `data.json`. For example, game scores belong in `data/<game>.json`, not in `data.json`. **Copy `server/basketball/`**: it is the working example of everything below.

Layout for a feature called `<feature>`:

| What | Where |
|---|---|
| API and rules | `server/<feature>/core.ts`: `create<Feature>({ saved, save, team, now })` returns `{ handle, save, feature }`. `handle(req)` answers only `/api/<feature>/...` and returns `null` for any other path. |
| Tests | `server/<feature>/<feature>.test.ts` (`npm test` finds it, and `.dockerignore` already leaves out `server/**/*.test.ts`) |
| Types and rules shared with the browser | `shared/<feature>.ts` |
| Data on Node.js | `data/<feature>.json`, next to the main data file: `path.join(path.dirname(dataFile), '<feature>.json')`. Write a `.tmp` file and rename it, as `server.ts` does. |
| Data on Cloudflare | Its own storage key `<feature>` in the same Durable Object: `ctx.storage.get('<feature>')` / `ctx.storage.put('<feature>', ...)`. Never write it into the `data` value. |
| Page | `src/pages/<Feature>Page.tsx` (see the UI rules above) |

How to connect it (see how `basketball` is wired):
- In **both** `server/server.ts` and `worker/index.ts`, create the feature after the core with `team: core.team`, call `core.attach(feature.feature)`, and try its `handle` first: `(await feature.handle(req)) ?? (await core.handle(req))`. Give it its own `save`.
- To know who is calling, use `team.player(req)` (throws a 401), `team.members()`, `team.sign(purpose, text)` and `team.requireAdmin(req)` (`Team` in `core.ts`). Never copy the PIN, token or lock logic. If a feature needs more from the team, add it to `Team`.
- `core.attach` takes a `TeamFeature` (`core.ts`), which does two jobs:
  - **Backups:** the feature's data goes into the admin's one backup file under its `key`. `checkBackup` checks it against the people in that backup (throw `backupError`) before anything changes, then returns a restore function.
  - **Deleted people:** `forget(usernames)` drops what the feature keeps about them.
- Moving data that used to live in `data.json`: take it out of the saved team data before `createCore` reads it (as `takeOldBasketball` does), and save the feature's own copy before the team's is written again.
- If a reply tells someone their data is stored (a score, a payment, a booking), `await` the save before replying, and undo the change in memory if the save fails. Put changes in a queue, so saves happen one at a time (`queue` / `saveOrUndo` in `server/basketball/core.ts`).
- A Cloudflare value can be at most 2 MB. Keep feature data small, cap list lengths, and drop old entries.
- Keep per-person data in a `Map`, not a plain object: a username such as `__proto__` breaks a plain object.
- Live updates: send the feature's own `onChange` events over the existing `/api/events` stream with an event name (`event: <feature>`), or poll. Don't put feature state into `TeamState`.
- Things that must happen at a set time: Node runs `runTimedChanges` every 30 s, but a Durable Object sleeps and has **only one alarm**. Add the feature's next time to the time `syncAlarm` sets (the earliest time wins), and run the feature's catch-up from `runTimedChanges` in both hosts. The daily reset always goes first.
- Docker copies the whole `server/` folder, so a new feature folder needs no Dockerfile change.

### Before you finish
Run all three. CI (`.github/workflows/check.yml`) runs the same commands on every pull request:

```bash
npm run typecheck
```

```bash
npm test
```

```bash
npm run build
```

`npm test` runs `scripts/run-tests.ts`, which fails if no tests ran and stops a test that hangs for 2 minutes. `worker/worker.test.ts` starts the real Worker in workerd, so test anything only the Worker does (storage, alarms, routing) there.

To see a change: run `npm run dev:api` and `npm run dev` together (Vite at http://localhost:5173 sends `/api` to the API), or run `npm run dev:cf` for the Cloudflare version. `npm run test-members` adds 20 pretend users.

- Update `README.md` when what people do or set up changes.
- Branch from `main`. Don't commit to `main` or push without being asked.

## Feature map

Paths are from the project root. Function names are given instead of line numbers, because line numbers change. Inside a table, a bare file name such as `core.ts` means the file named in full above it.

### Hosts and plumbing
| Feature | Code |
|---|---|
| Team API routes, data shape (`Data`), validation, `ApiError` | `server/core.ts`: `createCore` → `route()`; the routes are `if (route === 'METHOD /api/...')` blocks; `handle()` and `errorResponse` turn errors into JSON |
| What features may use from the team | `core.ts`: `Team` (`core.team`: `player`, `members`, `sign`, `requireAdmin`), `TeamFeature` (`core.attach`), `backupError`, `safeEqual` |
| Node server: static files, data files, SSE, timers | `server/server.ts`: `createApp` (`readFile` / `writeFile`, `answer`, `openEvents`, `sendAll`, `voteEvent`, `fundEvent`, `celebrateEvent`, `petEvent`, `serveStatic`, `runTimedChanges`, `start`) |
| Cloudflare Worker + Durable Object | `worker/index.ts`: default `fetch` (routing, `PAGES`), class `Minimap` (storage keys `data`, `basketball`, `vote`, `fund`, `celebrate` and `pet`, `alarm`, `syncAlarm`, `runTimedChanges`, `refreshFundIfDue`, SSE, ping), `voteEvent`, `fundEvent`, `celebrateEvent`, `petEvent` |
| Cloudflare settings (vars, bindings, build) | `wrangler.jsonc` |
| Docker | `Dockerfile`, `docker-compose.yml` (data volume `minimap-data` → `/app/data`, holding `data.json`, `basketball.json`, `vote.json`, `fund.json`, `celebrate.json` and `pet.json`), `.dockerignore` |
| Types sent to the browser | `shared/types.ts` (`TeamState`, `TeamUser` (its `fund` and `celebration` are added by the browser, never sent), `ScheduledChange`, `Weather`, ...) |
| Character design limits (server and editor) | `shared/look.ts` |
| Frontend entry and page switch | `src/main.tsx` |
| Fetch, live updates, errors in the browser | `src/lib/api.ts` (`api`, `subscribe`, which also takes features' named events such as `vote`, `fund`, `celebrate` and `pet`, `errorText`), `src/lib/hooks.ts` (`useTeamState` gives the state, with each user's fund standing and today's celebration added, the votes, the fund, the celebrations and the office cat, `useNow`, `useAmbience`, ...) |
| Styles and shared controls | `src/styles/theme.ts`, `src/styles/ui.ts`, `src/styles/GlobalStyle.ts` |
| 3D support and lost-context fallback | `src/lib/webgl.ts` (`supportsWebGL`), `src/lib/contextLoss.ts` (`watchContextLoss`, 10 s wait) |
| CI (read-only token, safe for pull requests from forks) | `.github/workflows/check.yml` |
| Guide and pull request template for outside contributors | `CONTRIBUTING.md`, `.github/pull_request_template.md` |

### Auth
| Feature | Code |
|---|---|
| Admin password check and lockout | `core.ts`: `requireAdmin`, `checkLock`, `recordFailure`; header `x-admin-password` |
| Claim a username with a PIN, log in, tokens | `core.ts`: routes `POST /api/claim`, `POST /api/login`; `tokenFor`, `userFromToken` (reads the token from the end, because usernames can contain dots), `signature` |
| Browser side | `src/lib/session.ts`: `useSession` / `storeSession`; session retention rules in `src/lib/sessionRules.ts` with `sessionRules.test.ts` (validated with `GET /api/me`, `localStorage` key `minimap.auth`, also read by the arcade); `AdminPage.tsx`: `readSavedPassword` (`minimap.admin`) |

### Monitor page (`/`)
| Feature | Code |
|---|---|
| Page, filters, people list, 2D/3D switch | `src/pages/MonitorPage.tsx`: `MonitorPage`, `PeopleList`, `chooseMode`, `chooseFilter` |
| Where rooms and seats go (both maps), park space kept for votes, arcade and picker | `src/lib/layout.ts`: `computeLayout`, `FIXED_ZONES`, `placeGroup`, `noticeBoardSpot`, `parkActivities`, `standingArea` |
| Park tree placement (stable random positions shared by both maps) | `src/lib/parkTrees.ts`, `src/lib/parkTrees.test.ts`, tree art in `src/map/decor.tsx` |
| 2D map | `src/map/Map2D.tsx` (`ZoneRoom`, `Person`, `StreetDecor`), furniture `src/map/decor.tsx` |
| 3D map | `src/map/Map3D.tsx` (React around the scene, 2D fallback), `src/map/scene3d.ts` (`createScene3D`: rooms, lights, weather, camera) |
| 3D characters (map, claw machine, arcade) | `src/map/character3d.ts` |
| 3D wandering | `src/lib/wander.ts` |
| Street traffic, right-side lanes, spawning, yielding, pedestrian escape strips and daylight head/rear lights | `src/lib/traffic.ts`, `traffic.test.ts`; 2D `src/map/Traffic2D.tsx` and `Map2D.tsx`; 3D `src/map/traffic3d.ts` and `scene3d.ts` (`dodgeTraffic`); reduced-motion cars use `parkedTraffic` |
| Person badge and detail card | `src/components/Badge.tsx`, `src/components/DetailCard.tsx` |
| Map props and focus requests (and the votes, vote marks, reactions and the mover the maps get) | `src/map/types.ts` |
| Drag yourself to another room (the logged-in person only): which room is under a point, the place to send, the move shown before the server agrees | `src/lib/dragMove.ts` (`zoneAt`, `dropPlace`, `moverFor`, `withMove`, `createPress`: a press becomes a drag); `MonitorPage.tsx` (`moveMe` sends `PATCH /api/me`, pending move, `MoveNote`); 2D: `Map2D.tsx` (`useDrag`, which listens on the window so a quick flick isn't lost, the room's `$dropTarget`); 3D: `scene3d.ts` section "Dragging yourself to another room" (`setMover`, `onHoldStart`, `letGo`), `Map3D.tsx` (`[data-drop-target]`, `[data-mover]`) |
| Side panel: clocks, weather, QR code, a vote's last-hour countdown | `src/components/InfoPanel.tsx` (`VoteCountdown`) |
| Recent updates card: the latest place and status changes, each for 5 minutes. Built in the browser from each user's `updatedAt`, so the server keeps no feed | `src/lib/recentUpdates.ts` (`diffUpdates` between two live states in a row, `seedUpdates` for a page that has just opened or was cut off for a while, `mergeUpdates`, `visibleUpdates`, `closeTime`, `updateText`, `agoText`), `src/components/RecentUpdates.tsx` (its live region stays in the page while the card is hidden); `MonitorPage.tsx` (`lastLive`, `missedStates`, `closeRecent` with key `minimap.recentClosed`, `RecentCard` for where it sits: clear of the notes, the 3D map's `CameraHint` and its `[data-vote-result]` link); `core.ts`: `updatedAt` moves only with a place or status (`isWhereabouts` in `PATCH /api/me`, `runScheduledIfDue`), never in `runResetIfDue` |

### Time of day and weather
| Feature | Code |
|---|---|
| Fetch weather and sun times (Open-Meteo), city search | `core.ts`: `refreshWeather`, `searchPlaces`, `sunTimes`; route `GET /api/admin/places` |
| How light / warm / wet the town looks | `src/lib/ambience.ts` (`ambience`, `conditions`, `previewTime`) |
| Shared foreground weather layer (2D and 3D) | `src/map/WeatherOverlay.tsx`, ordering in `src/map/layers.ts` |
| 3D daylight, night lights, weather | `scene3d.ts`: sections "Daylight", "Lights that come on after dark", "Weather" |
| Daylight/weather switches | setting `mapWeather` (`core.ts` → `PATCH /api/admin/settings`); `MonitorPage.tsx` key `minimap.weather` |

### User pages (`/me`, `/account`)
| Feature | Code |
|---|---|
| Pick a username, enter a PIN | `src/components/MemberEditor.tsx`: `PickPanel`, `PinPanel` |
| Status, place and scheduling on `/me`; nickname, character, fund preferences and logout on `/account`; home dialogs | `MemberEditor.tsx`: shared forms and login gate; lazy `MemberDialog.tsx` in `MonitorPage.tsx`; standalone `MePage.tsx` and `AccountPage.tsx`; `PATCH /api/me` in `core.ts` returns `MeUpdateResult` with public member values |
| Character color, drawing, worn items | `src/components/CharacterEditor.tsx`, `src/lib/drawing.ts`, `src/lib/wornItems.ts`, `src/lib/look.ts`; server `cleanLook` |
| Applying confirmed edits immediately | `src/lib/memberUpdates.ts` (`replaceSavedMember`) and tests; `useTeamState` callbacks in `hooks.ts`; `FundPanel.tsx` applies its API response |
| Mochi character art (2D) | `src/components/Mochi.tsx` |

### Scheduled changes ("Leaving early")
| Feature | Code |
|---|---|
| Schedule, edit or cancel a move to Out of Office | `MemberEditor.tsx`: `SchedulePanel`; field `scheduled` on `PATCH /api/me` |
| Server rules | `core.ts`: `cleanSchedule` (must be before the next reset), `runScheduledIfDue`, `nextScheduledAt`, `savedSchedule` (backups), `SCHEDULED_PLACE` |
| Running on time | `server.ts` `runTimedChanges` (every 30 s); `worker/index.ts` `alarm` + `syncAlarm` |
| Showing it | `src/lib/status.ts` (`shownStatus`, `scheduledText`, `nextInstant`, `clockTime`, `timeInputValue`); used by `Badge.tsx`, `DetailCard.tsx`, `MonitorPage.tsx` |

### Admin page (`/admin`)
| Feature | Code |
|---|---|
| Log in | `src/pages/AdminPage.tsx`: `LoginPanel`; `GET /api/admin/check` |
| Add, release, delete usernames | `AdminPage.tsx`: `AddUserForm`, `TeamPanel`; `POST /api/admin/users`, `POST /api/admin/users/:name/release`, `DELETE /api/admin/users/:name` |
| Team address, clocks, office location | `AdminPage.tsx`: `AddressForm`, `ClocksForm`, `OfficeForm`; `PATCH /api/admin/settings`, `cleanPublicUrl` / `cleanClocks` / `cleanOffice` |
| Backup and restore (includes schedules, and each attached feature under its key) | `AdminPage.tsx`: `BackupPanel`; `GET/PUT /api/admin/data`, `checkBackup`, each feature's `checkBackup` |

### Office assembly celebration
| Feature | Code |
|---|---|
| Attendance unlock, entrance timing, finale duration, formation | `src/lib/assembly.ts`, `src/lib/assembly.test.ts` |
| Map decorations and entry point | `src/components/AssemblyDecor.tsx`, `Map2D.tsx`, `Map3D.tsx`, `scene3d.ts`; roster snapshot and dialog in `MonitorPage.tsx` |
| Celebration, portal effects, office props | `src/components/TeamAssemble.tsx`, lazy `TeamAssemble3D.tsx`, `AssemblyProp.tsx`, `src/lib/assemblyProps.ts` |

### Basketball arcade
| Feature | Code |
|---|---|
| Game rules shared by browser and server (timing, aim, scoring, replay, ranking, week) | `shared/basketball.ts` (`replay`, `shoot`, `rank`, `weekKey`, `ROUND_MS`, `MAX_ROUND_SCORE`) |
| API: leaderboards, signed round tickets, score check | `server/basketball/core.ts`: `createBasketball` → `route()` with `GET /api/basketball`, `POST /api/basketball/round`, `POST /api/basketball/score`; `boards`, `queue`, `saveOrUndo` |
| Stored data | `BasketballData` (`records`, `rounds` by username): `data/basketball.json` on Node, key `basketball` on Cloudflare |
| Backup part, deleted people, moving old data | `server/basketball/core.ts`: `feature` (`checkRecords`, `forget`), `takeOldBasketball` |
| Game dialog, round flow, retry, leaderboards | `src/components/Basketball.tsx` (loaded with `lazy()` on the first Play in `MonitorPage.tsx`, inside `Guard`) |
| 2D court, with the 3D court loaded lazily | `src/components/BasketballCourt.tsx` (`ballPose`), `src/components/BasketballCourt3D.tsx` |
| Court lines, crowd and banners | `src/lib/basketballCourt.ts`, `src/lib/basketballCast.ts` (`pickTeammates`, `pickCrowd`) |
| Cabinet on the map with its Play button | `src/map/ArcadeCabinet.tsx` (`ArcadeCabinet2D`, `ArcadePlay`), `src/map/arcade3d.ts` (`createArcadeCabinet`) |
| Tests | `server/basketball/basketball.test.ts` (including moving old scores), `src/lib/basketball.test.ts`, `src/lib/basketballCast.test.ts`, the arcade test in `worker/worker.test.ts` |

### Voting
| Feature | Code |
|---|---|
| Rules shared by browser and server (limits, open or closed, `clean*` checks, the safe view, results and ties, map summaries, banner text) | `shared/vote.ts` (`isOpen`, `canVote`, `cleanNewVote`, `cleanBallot`, `cleanOption`, `toView`, `results`, `mapSummary`, `latestResult`, `waitingVoters`, `waitingVotes`, `resultText`) |
| API: create, ballot, options, extend, close early, delete; queue with undo; caps of 30 open and 100 closed | `server/vote/core.ts`: `createVote` → `route()` with `GET/POST /api/vote`, `PATCH/DELETE /api/vote/:id`, `POST /api/vote/:id/ballot`, `POST /api/vote/:id/options`, `POST /api/vote/:id/close` (creator or admin; sets `endsAt` to now); `change` (queue, save, undo), `prune`, `views` |
| Stored data | `VoteData` (`votes`, ballots as pairs): `data/vote.json` on Node, key `vote` on Cloudflare. Open or closed is never stored: it comes from `endsAt` and the time, so there is no timer or alarm |
| Backup part, deleted people | `server/vote/core.ts`: `feature` (`checkVotes`, `forget`) |
| Live updates | `onChange` → `event: vote` on `/api/events` (public views only, never `mine`), also sent when a stream opens |
| Page `/vote`: tabs, form, cards (Close now, Change end time, Delete), bar results, deep link | `src/pages/VotePage.tsx` (lazy in `main.tsx`), `src/components/VoteForm.tsx`, `src/components/VoteCard.tsx`, `src/components/VoteResults.tsx`; `useNow(ms, votes)` in `hooks.ts` reads the clock again on each update, so an early close shows at once |
| The saved login and admin password the page reads | `src/lib/savedLogin.ts` (`savedLogin`, `savedAdminPassword`) |
| Share a vote's link (team address first, share sheet, then clipboard, then shown to copy by hand); a missing linked vote | `src/lib/voteShare.ts` (`shareLink`, `shareVote`), `share` in `VoteCard.tsx`; `missing` in `VotePage.tsx` |
| Times in words, quick end picks | `src/lib/voteTime.ts` (`endsText`, `timeLeft`, `quickEnds`, `localInputValue`) |
| Notice board (both maps) | `src/lib/noticeBoard.ts` (`boardNotes`, `countdown`, `voteLink`), `src/map/NoticeBoard2D.tsx` (also `NoticeBoardLink`, the 3D board's keyboard link), `src/map/noticeBoard3d.ts` (canvas texture, `linkAt` for raycast); in `scene3d.ts`: `drawBoard` |
| Results banner and "hasn't voted" marks | `MonitorPage.tsx` builds `VoteMarks` (switch `minimap.voteMarks`); 2D: `src/map/ResultBanner2D.tsx`, `src/components/BallotMark.tsx` (on `Badge`); 3D: `src/map/blimp3d.ts`, `scene3d.ts` `setVoteMarks`, `markBallot`, `animateVoteMarks`; `DetailCard.tsx` lists pending votes |
| Character reactions | `src/lib/voteReactions.ts` (`reactions`), planned in `MonitorPage.tsx`; 2D: `Map2D.tsx` `usePlaying`; 3D: `scene3d.ts` `react`, `animateReaction`, `confettiAt`, with `hopHeight` from `wander.ts` |
| Ballot drop | `src/components/BallotDrop.tsx` (CSS and SVG, no three.js) |
| Tests | `shared/vote.test.ts`, `server/vote/vote.test.ts`, `src/lib/voteTime.test.ts`, `src/lib/voteShare.test.ts`, `src/lib/noticeBoard.test.ts`, `src/lib/voteReactions.test.ts`, `src/lib/savedLogin.test.ts`, the vote test in `worker/worker.test.ts` |

### Team fund looks
| Feature | Code |
|---|---|
| Rules shared by browser and server (tiers by months ahead, who may hide, reading the sheet's CSV, sheet links, name suggestions) | `shared/fund.ts` (`tierFor`, `canHide`, `shownTier`, `sheetId`, `csvUrl`, `parseSheet`, `suggestLinks`, `FUND_EVERY_MS`) |
| API: read the sheet, admin settings and links, hide my look | `server/fund/core.ts`: `createFund` → `route()` with `GET /api/fund`, `GET/PATCH /api/fund/admin`, `POST /api/fund/admin/refresh`, `PATCH /api/fund/me`; `refresh` (never throws, keeps the last rows on failure), `refreshIfDue`, `change` (queue, save, undo) |
| Stored data | `FundData` (`sheet`, `links`, `hidden`, last `rows`, `fetchedAt`): `data/fund.json` on Node, key `fund` on Cloudflare. Read hourly by a timer on Node; on Cloudflare when someone looks (`refreshFundIfDue`), so no alarm |
| Backup part, deleted people | `server/fund/core.ts`: `feature` (`checkBackup`, `forget`) |
| Live updates | `onChange` → `event: fund` on `/api/events`, also sent when a stream opens; `useTeamState` adds it to users with `withFund` |
| What each tier wears (lines on the body, mouth, headwear, cloud, fly, sparkles) | `src/lib/fundLook.ts` (`fundArt`, `userFundTier`, `withFund`); `Look.fund` in `src/lib/look.ts` |
| Drawing it | 2D: `src/components/Mochi.tsx` (`TOP_HAT`, `CROWN`, `RAIN_CLOUD`, `FLY`, `SPARKLES`, `MOUTHS`); 3D: `src/map/character3d.ts` (`addTopHat`, `addCrown`, `addFundProps`); `scene3d.ts` `designKeyOf` (redraw on change), `labelHeight` (name above the cloud); arcade `BasketballCourt.tsx` |
| Admin panel, account panel, title on the card | `src/components/FundAdminPanel.tsx` (on `AdminPage.tsx`), `src/components/FundPanel.tsx` (in `MemberEditor.tsx`), `CardFund` in `DetailCard.tsx` |
| Tests | `shared/fund.test.ts`, `server/fund/fund.test.ts` (a pretend sheet through `fetchImpl`), `src/lib/fundLook.test.ts`, the fund test in `worker/worker.test.ts` |

### Office cat
| Feature | Code |
|---|---|
| Rules shared by browser and server (stages, good and quiet days, closing a day, mood, names, words) | `shared/pet.ts` (`stageFor`, `rollOver`, `toView`, `moodOf`, `cleanName`, `dateIn`, `stageText`, `moodText`, `GOOD_DAY_FEEDS`, `STAGES`) |
| API: see it, feed it once a day, name it (admin) | `server/pet/core.ts`: `createPet` → `route()` with `GET /api/pet`, `POST /api/pet/feed`, `PATCH /api/pet/admin`; `change` (closes past days first, then queue, save, undo), `tick` |
| Stored data | `PetState` (`name`, `day`, `fed`, `goodDays`, `quietDays`): `data/pet.json` on Node, key `pet` on Cloudflare. No alarm: `view()` works the new day out from the date, and `tick` (run from `runTimedChanges` in both hosts) saves it and tells open maps |
| Backup part, deleted people | `server/pet/core.ts`: `feature` (`checkPet`, `forget`) |
| Live updates | `onChange` → `event: pet` on `/api/events`, also sent when a stream opens; `useTeamState` gives it as `pet` |
| Where it sits, what the maps show, when it hops | `petSpot` in `src/lib/layout.ts`; `src/lib/petLook.ts` (`petShown`, `inMainOffice`, `newFeed`, `STAGE_SCALE`, `CAT`); planned in `MonitorPage.tsx` (`cheer`), passed as `pet` / `onPet` in `MapProps` |
| Drawing it | 2D: `src/map/OfficeCat2D.tsx` (`SittingCat`, `SleepingCat`, `CatArt`); 3D: `src/map/cat3d.ts` (`createOfficeCat`: sit, walk and sleep poses), placed, clicked and walked round the main office in `scene3d.ts` (section "The office cat": `nextCatSpot`, `animateCat`, using `wander.ts`; `setPet`), name-tag button in `Map3D.tsx` (`[data-office-cat]`) |
| Card and admin panel | `src/components/PetCard.tsx` (Feed button; reuses `Card` and `place` from `DetailCard.tsx`), with the turning 3D cat in lazy `src/components/PetCat3D.tsx` (2D `CatArt` while loading or without WebGL), `src/components/PetAdminPanel.tsx` (on `AdminPage.tsx`) |
| Tests | `shared/pet.test.ts`, `server/pet/pet.test.ts`, `src/lib/petLook.test.ts`, the cat test in `src/lib/layout.test.ts`, the cat test in `worker/worker.test.ts` |

### Birthdays and anniversaries
| Feature | Code |
|---|---|
| Rules shared by browser and server (valid dates, the team's day, leap days, the coming list, words) | `shared/celebrate.ts` (`isMonthDay`, `isDate`, `dateIn`, `fallsOn`, `celebrations`, `todayKind`, `wishesFor`, `celebrationText`, `todayText`, `whenText`, `UPCOMING_DAYS`) |
| API: my dates, anyone's dates (admin), send wishes | `server/celebrate/core.ts`: `createCelebrate` → `route()` with `GET /api/celebrate`, `GET/PATCH /api/celebrate/me`, `GET/PATCH /api/celebrate/admin`, `POST /api/celebrate/wish`; `change` (queue, save, undo), `tick` |
| Stored data | `CelebrateData` (`people` as pairs, today's `wishes`): `data/celebrate.json` on Node, key `celebrate` on Cloudflare. A new day needs no alarm: `tick` runs from `runTimedChanges` in both hosts and sends the new day to open maps, and old wishes are left out by their `day` |
| Backup part, deleted people | `server/celebrate/core.ts`: `feature` (`checkPeople`, `checkWishes`, `forget`) |
| Live updates | `onChange` → `event: celebrate` on `/api/events`, also sent when a stream opens; `useTeamState` adds `celebration` to users with `withCelebration` |
| Party hat and balloon | `src/lib/celebrateLook.ts` (`withCelebration`, `wishReactions`, `BALLOON`); `Look.party` in `src/lib/look.ts`; 2D `Mochi.tsx` (`PARTY_HAT_ART`, `Balloon`); 3D `character3d.ts` (`addParty`); `scene3d.ts` `designKeyOf`, `labelHeight`; arcade `BasketballCourt.tsx` |
| Side panel, card, confetti | `Celebrations` in `src/components/InfoPanel.tsx`; `src/components/CardParty.tsx` (on `DetailCard.tsx`, Send wishes); confetti planned in `MonitorPage.tsx` with `wishReactions` |
| Account and admin panels | `src/components/CelebratePanel.tsx` (in `MemberEditor.tsx`, account view), `src/components/BirthdayInput.tsx` (shared), `src/components/CelebrateAdminPanel.tsx` (on `AdminPage.tsx`) |
| Tests | `shared/celebrate.test.ts`, `server/celebrate/celebrate.test.ts`, `src/lib/celebrateLook.test.ts`, the birthdays test in `worker/worker.test.ts` |

### Random member picker (claw machine)
| Feature | Code |
|---|---|
| Choosing the winner and planning the animation | `src/lib/picker.ts` (`createDraw`, `pickIndex`, `planSteps`) |
| 2D claw machine and draw dialog | `src/components/RandomPicker.tsx` (loaded lazily from `MonitorPage.tsx`, opened by `PickerCabinet.tsx` or `pickerCabinet3d.ts` in the park, wired through `MonitorPage.tsx`) |
| Cabinet and dialog appearance | `src/lib/pickerAppearance.ts` (shared labels and palette), `src/map/PickerCabinet.tsx`, `src/map/pickerCabinet3d.ts` |
| 3D claw machine | `src/components/ClawMachine3D.tsx` (lazy), positions `src/lib/picker3d.ts` |

### Daily reset
| Feature | Code |
|---|---|
| Clear places, statuses and scheduled changes each morning | `core.ts`: `runResetIfDue`, `latestResetDate`; `RESET_AT` and `TZ` env/vars |
| Who calls it | `runTimedChanges` in `server.ts` and `worker/index.ts` (reset first, then schedules); the Worker also calls it on each request and on the SSE ping |

### Tests and tools
| What | Where |
|---|---|
| Test runner (fails when no tests run) | `scripts/run-tests.ts`, its own test `scripts/run-tests.test.ts` |
| API tests (through a real Node server) | `server/server.test.ts` (`setup()` makes a temp data file), `server/basketball/basketball.test.ts`, `server/vote/vote.test.ts`, `server/celebrate/celebrate.test.ts`, `server/pet/pet.test.ts` |
| Worker tests (real workerd) | `worker/worker.test.ts` |
| Pure logic tests | `src/lib/*.test.ts`, `shared/*.test.ts` |
| 20 pretend users | `scripts/sample-team.ts` (`npm run test-members`) |
