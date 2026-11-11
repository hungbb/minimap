# Team Minimap

A cute 2D and 3D map showing where your team is working today. It's a React and TypeScript frontend (built with Vite and styled with styled-components) and one small Node.js server with no dependencies. There's no database: data is kept in a JSON file. It can also run on Cloudflare Workers instead (see [Deploy to Cloudflare](#deploy-to-cloudflare)).

| Page | Address | Who uses it |
|---|---|---|
| Map | `/` | Everyone. Team members logged in on that browser can drag their own character to another room to change their place. Add `?mode=3d` for a wall TV. If the browser takes away 3D graphics and doesn't give them back within 10 seconds, the screen switches to the 2D map until it's reloaded |
| Update status | `/me` | Log in or claim a username, then set place, status and scheduled changes |
| Account settings | `/account` | Manage nickname, character appearance, fund preferences and logout |
| Admin | `/admin` | The admin creates usernames, sets the team address, clocks and office location, and links people to the team fund's sheet |
| Team votes | `/vote` | Everyone sees open votes and results. Logged-in members start votes and vote. `/vote?id=<id>` opens one vote, and each vote's **Share** button sends or copies that link |

## Run on your own computer (no Docker)

You need [Node.js](https://nodejs.org) 24 or newer.

1. Copy `.env.example` to `.env` and set `ADMIN_PASSWORD`.
2. Install the dependencies:

   ```bash
   npm install
   ```

3. Build the pages and start the server:

   ```bash
   npm start
   ```

4. Open http://localhost:8080/admin, add some usernames, then claim one at http://localhost:8080/me.

Data is saved in `data/data.json`, the basketball arcade's records in `data/basketball.json`, team votes in `data/vote.json`, the team fund's settings in `data/fund.json`, birthdays and start dates in `data/celebrate.json`, and the office cat in `data/pet.json`. Delete those files while the server is stopped to start over.

## Develop

Run the API and the Vite dev server in two terminals, then open http://localhost:5173. Page edits appear instantly, and server edits restart the API.

```bash
npm run dev:api
```

```bash
npm run dev
```

To try the map with a full team, add 20 pretend members (usernames `test01` to `test20`, PIN `1234`) to the running app. The morning reset moves them to Not checked in; run the command again to put them back.

```bash
npm run test-members
```

Remove them with:

```bash
npm run test-members -- remove
```

Check your changes with:

```bash
npm run typecheck
```

```bash
npm test
```

| Folder | What's in it |
|---|---|
| `server/` | The API, daily reset and weather (`core.ts`), the Node.js server and data files (`server.ts`), plus their tests |
| `server/basketball/` | The basketball arcade's API and records, kept apart from the team's data |
| `server/vote/` | Team voting's API and votes, kept apart from the team's data |
| `server/fund/` | The team fund: reads the fund's Google Sheet and keeps who is who on it |
| `worker/` | The Cloudflare Worker and Durable Object that run the same API |
| `shared/` | Types used by both the server and the frontend |
| `src/pages/` | The Monitor, User, Admin and Team votes pages |
| `src/components/` | Badge, detail card, characters and the clocks, weather and QR panel |
| `src/map/` | The 2D map, and the 3D map with its three.js scene |
| `src/lib/` | API calls, React hooks, where rooms and seats go, and the time-of-day look (`ambience.ts`) |
| `src/styles/` | Colors and fonts (`theme.ts`), page-wide styles, and shared buttons and form pieces. Other styles sit in the component that uses them |
| `public/` | Fonts and Cloudflare's cache rules (`_headers`), copied as they are into the build |

Want to send a change? Anyone can open a pull request from a fork; see [CONTRIBUTING.md](CONTRIBUTING.md).

## Run on the office server (Docker)

1. Copy this folder to the server.
2. Copy `.env.example` to `.env` and set `ADMIN_PASSWORD`, `TZ`, `RESET_AT` and `PORT`.
3. Start it:

   ```bash
   docker compose up -d --build
   ```

4. Team members open `http://<server-ip>:8080`.

The container restarts by itself after a crash or reboot. Data is kept in the Docker volume `minimap-data`, so it survives rebuilds.

**First-run checklist**

- `docker compose ps` shows the service as `healthy`.
- After `docker compose restart`, your users are still there.
- After `docker compose up -d --build`, your users are still there.
- The server's firewall allows the port you chose.

**Back up the data**

This copies the whole data folder: the team's `data.json`, the arcade's `basketball.json`, the votes' `vote.json`, the fund's `fund.json`, the birthdays' `celebrate.json` and the cat's `pet.json`. **Download backup** on the Admin page also saves all six, in one file.

```bash
docker compose cp minimap:/app/data ./backup
```

## Deploy to Cloudflare

The app also runs on [Cloudflare Workers](https://developers.cloudflare.com/workers/), with no server to look after and HTTPS included. Cloudflare serves the pages, and one [Durable Object](https://developers.cloudflare.com/durable-objects/) runs the same API as the Node.js server: it keeps the data in its own storage and sends live updates to every open map. The Workers Free plan is enough for a team.

**Deploy from GitHub (Workers Builds)**

This repository is connected to the `minimap` Worker with [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/), so Cloudflare deploys every push to `main` by itself. Other branches are not built or deployed on Cloudflare; GitHub Actions checks them instead.

1. Set `RESET_AT` and `TZ` under `vars` in `wrangler.jsonc`.
2. In the Cloudflare dashboard, open **Workers & Pages → minimap → Settings → Variables and Secrets**, and add a **Secret** named `ADMIN_PASSWORD`. It stays in place through every deploy.
3. In **Settings → Build**, keep the deploy command as `npx wrangler deploy`. The build command can stay empty: Wrangler builds the pages itself (`build` in `wrangler.jsonc`). On the **Previews Base** tab of the same section, turn off **Builds for Preview branches**.
4. Push to `main`. Then open `https://minimap.<your-subdomain>.workers.dev/admin` and set **Team address** to that address so the QR code points there.

`.github/workflows/check.yml` runs the typecheck, tests and build on every pull request. It doesn't deploy.

**Deploy from your computer**

```bash
npx wrangler login
```

```bash
npx wrangler secret put ADMIN_PASSWORD
```

```bash
npm run deploy
```

**Try it locally first**

Put `ADMIN_PASSWORD=change-me` in a file named `.dev.vars`, then run this and open http://localhost:8787. Local data is kept in `.wrangler/`.

```bash
npm run dev:cf
```

**Good to know on Cloudflare**

- **Data:** it lives in the Durable Object, not in `data.json`, and starts empty. To bring over an existing `data.json`, or to keep backups, see [Back up and move data](#back-up-and-move-data). Cloudflare can also [restore it to any point in the last 30 days](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#pitr-point-in-time-recovery-api).
- **Morning reset:** runs on time while a map is open, and otherwise when someone next opens the app, so nobody ever sees yesterday's places.
- **Scheduled changes:** a Durable Object alarm applies them on time, even with no map open.
- **Weather:** refreshed every 15 minutes while someone is looking.
- **Logs:** run `npx wrangler tail`, or open the Worker's **Logs** in the Cloudflare dashboard.
- **Custom domain:** add one under the Worker's **Settings → Domains & Routes**, then update **Team address**.
- **Anyone with the address can see the map**, as on an office network. Put [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/applications/configure-apps/self-hosted-public-app/) in front if the map should stay private.

## Back up and move data

On the Admin page, under **Backup**:

- **Download backup** saves everything, PINs included, to a file. Keep backups private: with one, anyone could work out every PIN.
- **Restore from a file** replaces all usernames, PINs and settings with a backup's. It also accepts the `data.json` from the office server, which is how you move to Cloudflare.

A restore brings over usernames, nicknames, PINs, characters, scheduled changes, offices, clocks, the weather location, arcade records, team votes and the team fund's settings, and people stay logged in. If the backup is from before the last morning reset, places, statuses and scheduled changes are cleared, as on any morning. Otherwise, scheduled changes that are overdue apply straight away. Backups can be up to 2 MB.

## Random member picker

Select the pink **Random pick** claw-machine cabinet in the park to draw a teammate in a little claw machine. The machine opens in the same style as the map, and its own **2D / 3D** switch changes it at any time, even in the middle of a draw, without changing the result. The 3D machine uses the same decorated characters as the 3D map, and browsers that can't show 3D graphics use the 2D one. Give the draw a title (for example, "Who's buying coffee?") and choose who's in it. Everyone is included to start with, whatever filter the map is showing. **Start draw** picks the winner fairly before anything moves. The claw then looks around, grabs the winner, drops them in the prize chute and reveals them with confetti, which takes about six seconds. **Skip animation** shows the same winner straight away, and devices set to reduce motion always skip it. **Pick again** runs another draw with the same settings, and earlier winners can win again.

The tray shows up to 15 characters. In a bigger draw, everyone still has the same chance, the winner is always among the characters shown, and a note says how many more are in the draw. Draws happen only in your browser: they don't change anyone's status and nothing is saved.

## Home page settings

Set these on the Admin page. They apply straight away and are saved with the rest of the data.

- **Team address:** the address the QR code opens, such as `http://192.168.1.20:8080`. Set it for each deployment. If it's empty, the QR code uses the address the map was opened on. On `localhost` there is no QR code, because a phone couldn't open that address.
- **Clocks:** a name and time zone for each of the two clocks.
- **Main office location:** search for a city and pick it to show its weather. Remove it to hide the weather.
- **Show the office's daylight and weather on the map:** on by default. Turn it off to keep the map in its plain daytime look for everyone.

### Daylight and weather on the map

Once the main office location is set, the 2D and 3D maps follow the time of day there, using the office's real sunrise and sunset. The town gets warm light around sunrise and sunset, and a starry sky at night with glowing street lamps and lit office windows. Names, statuses and characters stay as readable as in the daytime. In the middle of the day, and without an office location, the map looks just as it always has.

The map also shows the office's current weather: drifting clouds (with their shadows passing over the 3D town), fog, drizzle, rain and snow, and thunderstorms with an occasional soft flash of lightning (never a strobe). Clouds, precipitation, fog, and storm flashes appear in a foreground layer over rooms, characters, park objects, and their labels in both map modes. Weather stays inside the map, lets pointer and touch input pass through, and sits below toolbars, camera controls, and dialogs. People outdoors (in **Out of Office** and **Off**) open umbrellas in rain and snow, puddles shine on the street while it rains, snow settles on the room tops, roofs and trees, and trees sway in the wind. With reduced motion turned on in the device's settings, the weather is shown as a still picture, with no lightning or swaying.

Each screen can turn the effects off with the **Weather** button on the map's toolbar, which the browser remembers. The button shows when an office location is set and the setting above is on.

### Votes on the map

People invited to an open vote that has **Show on the map** turned on, and who haven't voted yet, get a small ballot over their head. For 3 hours after a vote closes with at least one ballot, its result hangs on a banner across the street in 2D, or trails behind a blimp over the town in 3D. Each screen can hide the ballots and the banner with the **Votes** button on the map's toolbar, which the browser remembers. The notice board, the wall TV countdown and the people's reactions stay.

To preview another time of day on one screen, add `?time=dawn`, `day`, `dusk`, `night` or a time such as `?time=21:30` (in the time zone of the screen showing the map, not the office's) to the map's address (for example `/?mode=3d&time=dusk`). To preview weather, add `?weather=` with `clear`, `partly`, `windy`, `cloudy`, `fog`, `drizzle`, `rain`, `downpour`, `snow` or `storm`. Previews show even when the effects are turned off. They can be combined, as in `/?weather=storm&time=night`, and only change that screen. Without an office location, the preview uses a 06:00 sunrise and an 18:00 sunset.

## Settings

Set these in `.env`, then restart.

| Setting | Default | Meaning |
|---|---|---|
| `ADMIN_PASSWORD` | none, required | Password for the Admin page |
| `PORT` | `8080` | Port to open |
| `RESET_AT` | `05:00` | Time each day when everyone's place, status and scheduled changes clear |
| `TZ` | `Asia/Ho_Chi_Minh` in Docker, the computer's own otherwise | Time zone for `RESET_AT` |

Avoid `$` in `ADMIN_PASSWORD` when using Docker, because Docker Compose treats it as a variable.

## Good to know

- **Room sizes:** rooms grow and shrink with how many people are in them, and each keeps a minimum size so its name still fits. Park space stays available for the vote board, arcade, and random picker. Working rooms get most of the map; Not checked in and Off stay small, with a park filling the space beside them. In 2D they glide to their new size; in 3D they change straight away.
- **Working and not working:** Main Office, Other Office and Work from home count as working. Off and Out of Office count as not working, with Out of Office people on the street through the middle of the map. The map's top buttons and the people list use the same groups.
- **Wandering in 3D:** people walk around inside their own room and never leave it. Everyone in the lobby, at home, on the street or at the beach keeps strolling, stopping now and then to turn and face the camera. In an office, people stay at their desk most of the time and get up for a short walk every so often, going round the desks, plants and other people. A room too crowded to walk in keeps everyone still. The Wander button turns it off, which sends everyone back to their spot, and it's always off when the device asks for reduced motion. Street pedestrians still step aside for traffic when Wander is off, and return after the car passes.
- **Street traffic (2D and 3D):** compact cars, sedans, vans and pickups spawn at random intervals with colors chosen from a shared palette. They enter nose-first at the street edges, keep right in two opposing lanes, and leave at the opposite edge. Traffic stays quiet: at most three cars, with 10–18 seconds between spawns in each lane and a safe following gap. Street pedestrians step aside before cars reach them, and cars yield until the path clears, including on crowded maps. Headlights and rear lamps are off during the day and fade on at dusk with the map’s daylight. The headlights have a soft warm halo like the street lamps and a triangular beam that fades into the road; rear lamps glow softly red. Reduced motion shows a static pair of cars and stops pedestrian sidesteps. Traffic is decorative and needs no API or saved data.
- **Recent updates:** when someone changes their place or status, a small card over the map's bottom left corner lists the latest changes, newest first, such as *Lan moved to Work from home* or *Minh: "Out for lunch"*. It shows up to five people, one line each with their latest change, and a scheduled change that fires is marked *(scheduled)*. A line leaves after 5 minutes, so the card hides by itself when nothing new has happened for that long. **✕** closes it until the next update, and a reload doesn't bring the closed lines back. Clicking a line shows that person on the map, like a row of the people list. A new nickname or character and the morning reset add nothing to it. A page that has just opened, or that was cut off from the server for a while, says where people are now instead, such as *Lan is in Work from home*. On a phone the card sits across the top of the map.
- **Moving yourself on the map:** once you've logged in on the User page, go back to the map and drag your own character, or its name, onto another room to change your place there. Dropping it on Not checked in clears your place. Your status message stays the same, and choosing Out of Office this way cancels a scheduled change, just as it does on the User page. A plain click still opens your card. Nobody can move anyone else, and if your login has ended the map asks you to log in again.
- **Leaving early:** on the User page, **Schedule a change** moves someone to Out of Office at a chosen time before the next morning reset, with an optional status message, even with their browser closed. Until then they stay where they are, and teammates see the time and message wherever a status appears. Each person can have one pending change, and can edit or cancel it at any time. When it fires, the message replaces the status, or the status is cleared if there's no message. Choosing Out of Office by hand cancels it; choosing any other place keeps it.
- **Decorating characters:** on the User page, anyone can change their character's body color, add a hat, glasses or a mustache, and draw on its face with a pen. A hat replaces the character's automatic accessory. Drawings are saved as lines (up to 40 lines and 600 points each person), wrap around the face in 3D, and stay through the morning reset.
- **Forgotten PIN:** the admin clicks Release on that username, and the person claims it again with a new PIN.
- **Morning reset:** clears place, status and scheduled changes for everyone. Nicknames and PINs stay. If the server was off at reset time, the reset runs when it next starts, and it goes before any overdue scheduled changes, so nobody starts the day in Out of Office.
- **More offices:** stop the server and add an entry to `places` in `data.json`. The first entry is the main office, and both maps make room for the rest. In Docker, copy the file out and back with `docker compose cp`.
- **Weather:** the server gets it from [Open-Meteo](https://open-meteo.com) every 15 minutes, sending only the office coordinates. It also gets the sunrise and sunset times, cloud cover, rain amount and wind speed for the map's daylight and weather. Browsers never contact it. The server needs internet access for this, and everything else works without it. If updates fail, the last reading stays for up to 3 hours, then the map shows "Weather unavailable". Check [Open-Meteo's terms](https://open-meteo.com/en/terms) for your use, because its free service is for non-commercial use. Its data license requires the credit line shown under the weather, so keep that in place.
- **Working from home:** teammates can only update their status if they can reach the server, for example over your VPN.
- **Security:** this is built for a trusted office network. The Node.js server uses plain HTTP, so passwords and PINs are not encrypted on the network. Put a reverse proxy with HTTPS in front before exposing it more widely, or deploy to Cloudflare, which uses HTTPS.

## Team votes

Anyone logged in on **Update status** can start a vote on `/vote` (or from the notice board in the park): a lunch place, a sprint name, a retro topic. They pick its name, when it ends (up to 90 days away), 2 to 20 options, and who can vote (they are always invited themselves). Three settings are fixed once the vote is made:

- **Single** or **multiple** choice.
- **Custom options**: invited voters can add options while the vote is open, up to 20 in all.
- **Named** or **anonymous**. A named vote shows who picked each option. An anonymous vote shows only counts: the server never sends anyone's picks to anyone else, not to the creator, the admin or the map. Each voter still sees their own picks. Who *has voted* is shown on both kinds, for turnout and the map's markers.

**Share** on a vote opens the phone's share sheet, or copies the vote's link where there is none. The link uses the team address set on the Admin page when there is one, so it opens on other people's devices. Where the browser can't copy (a plain `http://` address), the link is shown to copy by hand. Opening a link to a vote that was deleted says so.

Invited people can vote, and change their vote, until the end time; the server closes the vote exactly then. Results are live for everyone, logged in or not, so a wall TV can show them. The creator can change the end time while the vote is open. The creator or the admin (with the admin password saved in that browser tab) can **Close now** to end an open vote early: it moves to **History** straight away, its end time becomes the moment it was closed, and nobody can vote or add options after that. Closing can't be undone. The creator or the admin can also delete a vote. There can be up to 30 open votes, and the newest 100 closed votes are kept in **History**; older ones are dropped by themselves.

On the map, the **notice board** in the park shows up to four open votes, ending soonest first, with a **+N** for the rest. A note turns red and pulses in a vote's last hour. In its last hour, the side panel also counts it down for the wall TV: *Team lunch closes in 42 min, 2 people left*. Clicking a note opens that vote; clicking the board opens `/vote`. Clicking someone shows which votes they haven't voted on yet. When someone votes, their character hops. When a named vote closes, the people who picked the winner cheer and everyone else invited claps; when an anonymous vote closes, everyone invited gets the same confetti, so no reaction gives away a pick. A vote closed early gets the same reactions, banner and History entry as one that ends on time. With reduced motion turned on, none of this moves.

Votes are kept apart from the team's data: in `data/vote.json` on Node.js, and under their own `vote` key in the Durable Object on Cloudflare. The admin's backup file holds them under `vote`, **with every ballot, anonymous ones included**, because a restore needs them; keep backups private. A restore checks that every creator, voter and ballot belongs to someone in the backup. Deleting a member removes their ballots and invitations, so old results may drop by one; votes they made stay, shown as made by *a former member*, and only the admin can close or delete them.

The API: `GET /api/vote` (anyone; adds the caller's own picks as `mine` when a login is sent), and with a login: `POST /api/vote`, `PATCH /api/vote/:id` (`endsAt`, creator only), `POST /api/vote/:id/ballot` (`choices`), `POST /api/vote/:id/options` (`text`), and `POST /api/vote/:id/close` (sets the end time to now) and `DELETE /api/vote/:id` (each by the creator, or the admin with `x-admin-password`). Live updates come on `/api/events` as `event: vote`.

## Team fund looks

The team keeps its fund (50k a month) in a Google Sheet. The map reads the tab named after the current year and dresses each person's character by how far ahead or behind they are:

| Months ahead (column B) | Title on the sheet | Look on the map | Can hide it? |
|---|---|---|---|
| 2 or more behind | Ốt dột | Patches, a band-aid, a frown, a rain cloud and a fly | No |
| 1 behind | Con nợ | A "50k" debt note, a sweat drop and a flat mouth | No |
| 0 | Hm... | Nothing | – |
| 1 to 2 ahead | Tốn tiền | Bow tie and gold medal | Yes |
| 3 to 5 ahead | Hào sảng | Suit, bow tie and gold medal | Yes |
| 6 to 11 ahead | Đại gia | Suit, gold chain, top hat and sparkles | Yes |
| 12 ahead | Forbes Billionaires | All of that, a monocle and a crown | Yes |

The look shows on both maps, the arcade, the picker and every avatar. The detail card shows the person's title as the sheet writes it. People who paid ahead can turn their look off in **Account settings**; people behind can't, until they pay.

To set it up, open **Team fund** on the Admin page:

1. In Google Sheets, share the sheet with **Anyone with the link** can view. The server reads it without a login.
2. Paste the sheet's link and select **Save link**.
3. Pick each username's name on the sheet, or select **Suggest matches** to fill in the obvious ones, then **Save links**.

How the sheet works, so the map stays right: the hidden column B counts the months marked `x` (paid) or `o` (excused), minus this month's number, and the Title column looks that number up in a hidden table. The map takes the look from the number and shows the title as written. A blank number counts as 0 (Hm...), as it does on the sheet, so give every row the formula. Hidden rows (people who left) are skipped. In January, add a tab for the new year with the same columns; until then the Admin page says the tab is missing and the map keeps the last looks it read.

The server reads the sheet when it starts and every hour (on Cloudflare: when someone opens the map and the last read is an hour old), and right away with **Read now**. If a read fails, the map keeps the last looks and the Admin page says why. The settings, links and last rows are kept in `data/fund.json` on Node.js and under the `fund` key on Cloudflare, and go into the admin's backup under `fund`. Deleting a member removes their link.

The API: `GET /api/fund` (anyone: each linked member's title, months, tier and whether they hid it), `PATCH /api/fund/me` (`hidden`, with a login), and with `x-admin-password`: `GET /api/fund/admin`, `PATCH /api/fund/admin` (`sheet`, `links` as `[username, name]` pairs) and `POST /api/fund/admin/refresh`. Live updates come on `/api/events` as `event: fund`.

## Office cat

A cat lives in the first office on the map, on both the 2D and 3D maps. In 2D it sits by the plant in the room's bottom-right corner; in 3D it walks around the room like the team's characters do, steering round desks and now and then trotting over to someone. It naps when nobody is in that office. Otherwise its mood comes from how many people are there and how many have fed it today: content, happy, or overjoyed with hearts. After two or more quiet days in a row with nobody feeding it, it looks lonely until someone does. It never goes away.

Click the cat to open its card. People who are logged in can select **Feed** once a day, and the cat hops on every open map. Three feeds make a **good day**. After 5 good days the kitten grows into a cat, and after 20 into a big cat; it never shrinks. Days follow the team's time zone (`TZ`) and start at midnight, not at the daily reset time (`RESET_AT`).

The admin names the cat under **Office cat** on the Admin page (it starts as Miu). To let the team choose, start a vote on `/vote` and save the winner there. The cat is kept in `data/pet.json` on Node.js and under the `pet` key on Cloudflare, and goes into the admin's backup under `pet`.

The API: `GET /api/pet` (anyone: name, today's feeds, good days, quiet days, stage), `POST /api/pet/feed` (with a login) and `PATCH /api/pet/admin` (`name`, with `x-admin-password`). Live updates come on `/api/events` as `event: pet`.

## Birthdays and anniversaries

Each person can set their birthday (month and day only, never the year) and their first day on the team in **Account settings**. The admin can set or fix anyone's under **Birthdays and anniversaries** on the Admin page. Both are optional.

On someone's birthday, or on each anniversary of their first day (from one year on), their character wears a party hat and holds a balloon (red for a birthday, gold for an anniversary) on both maps, the arcade and every avatar. The side panel lists today's celebrations and the next three coming up within 30 days. Clicking the person opens their card, where teammates who are logged in can select **Send wishes 🎉** once each; confetti plays over the person on every open map, and the card lists who sent wishes. A 29 February birthday is celebrated on 28 February in other years.

Days follow the team's time zone (`TZ`), so hats come and go at midnight there. Wishes only last for the day. The dates and today's wishes are kept in `data/celebrate.json` on Node.js and under the `celebrate` key on Cloudflare, and go into the admin's backup under `celebrate`. Deleting a member removes their dates and wishes.

The API: `GET /api/celebrate` (anyone: today's and the next 30 days' celebrations, with today's wishes), with a login `GET/PATCH /api/celebrate/me` (`birthday` as `MM-DD`, `joined` as `YYYY-MM-DD`, empty to clear) and `POST /api/celebrate/wish` (`to`), and with `x-admin-password` `GET /api/celebrate/admin` and `PATCH /api/celebrate/admin` (`username`, `birthday`, `joined`). Live updates come on `/api/events` as `event: celebrate`.

## Basketball arcade

Open the arcade cabinet’s **Play** button in the park. The illustrated 2D cabinet sits inside the floor plan; the 3D cabinet is a scene object that follows rotation and zoom and can also be clicked directly. The park reserves space for the vote board, arcade, and random picker even on busy days. Landscape keeps a minimum 38-unit-wide park; portrait adds a 32-unit park row and a 3-unit gap, so the fitted rooms become a little smaller. The arcade opens in the current map mode, with its own 2D/3D switch that keeps the round in progress. The 2D arena is illustrated; the 3D arena has a rendered court, backboard, net and basketball. Your saved character shoots the ball, while up to six randomly selected teammates stand around the sidelines using their own saved designs. Every character has a nameplate. Each new round samples a fresh crowd, which stays the same when switching views. Up to two supporters carry cheering signs with different front-facing or tilted poses, without arms or hands; the holders and signs stay fixed for the round. Baskets trigger a bigger celebration. Guest practice uses a default player, and reduced motion keeps character poses still. If 3D is unavailable, the game falls back to 2D. Shoot with touch, mouse, or Space/Enter on the Shoot button. A round lasts 60 seconds; shots recharge every 450 ms. A basket earns 2 points, with a bonus for each three consecutive baskets (up to +5 per shot). The aim meter completes a back-and-forth cycle in 2.4 seconds. The target starts at 34% width and narrows with the streak to 18%. Its seeded position changes after every shot and stays fixed while aiming; the server replays the same positions. Reduced motion keeps the ball and characters still, while the aim meter stays smooth so shots remain playable. Escape or Close returns focus to the cabinet; closing an active round abandons it.

Use **Log in** on the home page to post under your existing username. Guests can practice. Weekly rankings start Monday at 00:00 UTC and use the round's start week. Weekly and all-time boards keep one personal best per member, with earlier results winning ties. Records are kept apart from the team's data: in `data/basketball.json` next to `data.json` on Node.js, and under their own `basketball` key in the Durable Object on Cloudflare. Records that an older version kept inside the team's data move there by themselves on the next start. They survive daily resets, and are still included in the admin's one backup file (under `basketball`) and in restore. Deleting a member removes their rankings. Older backups without arcade data import with empty rankings.

The common API exposes `GET /api/basketball`, authenticated `POST /api/basketball/round`, and authenticated `POST /api/basketball/score` (`ticket`, `shots` in elapsed milliseconds). The server signs rounds, checks identity, duration and shot cadence, and replays the game rules to calculate points. Starting another round replaces the previous ticket. Identical submissions can be retried for 24 hours after a round starts, including after a server restart; changing a completed round's shots is rejected. Save failures appear in the game with Retry, and an unsaved completed round stays available while the dialog is closed. Reloading the page discards local unsaved shots. Leaderboards are honour-based: a signed-in member can submit fabricated, mechanically valid shot timings without playing. Server validation rejects invalid rounds and scores, but does not prove human play.

## Team, assemble!

When at least 75% of all team members are checked into a configured office (across both offices), occupied offices get gold trim, signal emblems and lights, plus an **Assemble** button. Empty teams do not unlock it. Home, leave and unchecked members remain in the attendance denominator.

Press **Assemble** to open an original superhero-style celebration: a signal, staggered portal entrances, then a final team lineup. The 2D sequence finishes after about 6.8 seconds. The 3D finale gives each person a 2.5-second camera close-up before returning to the wide lineup, for a total of 7.7 seconds plus 2.5 seconds per person. It uses the saved designs and names of the people in the office when Play was pressed. Switch between 2D and 3D, skip to the final pose, replay, or return to the map. Escape closes it and restores focus. Reduced motion shows the final lineup immediately. It never starts automatically, and the decorations disappear when attendance falls below 75%.


## Account navigation and park activities

The home header shows **Log in** when signed out. Once the server verifies the saved session, it shows **Update status** and your username. These actions (and **Log in**) open dialogs on the home page, preserving the map mode, filters, and camera. Use **Open full page**, or a modified click on a header link, to visit the dedicated `/me` and `/account` pages. Both `/me` and `/account` support the same login/claim flow, retaining the destination you opened. Invalid or released sessions return to login; temporary connection failures offer Retry. The dialogs and standalone pages share the same forms. Successful saves apply server-confirmed member values and fund preferences immediately to the current view, even if live events are delayed. Failed saves retain edits and show an error. Fields keep focus during saves; trying another save before one finishes asks you to wait and retry. Escape, Close, or a backdrop click closes a dialog and returns focus to its entry control.

The park groups the vote board, basketball arcade, and a pink **Random pick** claw-machine cabinet. Select the picker cabinet to open the existing random draw; it replaces the header's Random picker button. Both 2D and 3D use the same reserved activity footprints, keeping games clear of rooms and characters even on busy maps. Keyboard controls remain available on all three objects. The board is vertically centered in the park, both cabinets have base plates, and trees use stable randomized positions along the back and between activities; in 2D their crowns overlap the panel above. Phone and tablet layouts reflow the rooms and park together on resize; 3D also uses the portrait arrangement on tall viewports. Its **Park** camera view brings the three activities into focus. The picker cabinet shares the full picker’s pink, yellow and blue palette, with matching **Random pick**, **Start draw**, and **PRIZE** labels.
