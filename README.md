# Team Minimap

A cute 2D and 3D map showing where your team is working today. It's a React and TypeScript frontend (built with Vite and styled with styled-components) and one small Node.js server with no dependencies. There's no database: data is kept in a JSON file. It can also run on Cloudflare Workers instead (see [Deploy to Cloudflare](#deploy-to-cloudflare)).

| Page | Address | Who uses it |
|---|---|---|
| Map | `/` | Everyone. Add `?mode=3d` for a wall TV |
| My status | `/me` | Team members claim a username, then set their nickname, place and status |
| Admin | `/admin` | The admin creates usernames, and sets the team address, clocks and office location |

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

Data is saved in `data/data.json`. Delete that file while the server is stopped to start over.

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
| `server/` | The API, daily reset and weather (`core.ts`), the Node.js server and data file (`server.ts`), plus their tests |
| `worker/` | The Cloudflare Worker and Durable Object that run the same API |
| `shared/` | Types used by both the server and the frontend |
| `src/pages/` | The Monitor, User and Admin pages |
| `src/components/` | Badge, detail card, characters and the clocks, weather and QR panel |
| `src/map/` | The 2D map, and the 3D map with its three.js scene |
| `src/lib/` | API calls, React hooks, where rooms and seats go, and the time-of-day look (`ambience.ts`) |
| `src/styles/` | Colors and fonts (`theme.ts`), page-wide styles, and shared buttons and form pieces. Other styles sit in the component that uses them |
| `public/` | Fonts and Cloudflare's cache rules (`_headers`), copied as they are into the build |

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

```bash
docker compose cp minimap:/app/data/data.json ./backup.json
```

## Deploy to Cloudflare

The app also runs on [Cloudflare Workers](https://developers.cloudflare.com/workers/), with no server to look after and HTTPS included. Cloudflare serves the pages, and one [Durable Object](https://developers.cloudflare.com/durable-objects/) runs the same API as the Node.js server: it keeps the data in its own storage and sends live updates to every open map. The Workers Free plan is enough for a team.

**Deploy from GitHub (Workers Builds)**

This repository is connected to the `minimap` Worker with [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/), so Cloudflare deploys every push to `main` by itself, and uploads a preview version for other branches.

1. Set `RESET_AT` and `TZ` under `vars` in `wrangler.jsonc`.
2. In the Cloudflare dashboard, open **Workers & Pages → minimap → Settings → Variables and Secrets**, and add a **Secret** named `ADMIN_PASSWORD`. It stays in place through every deploy.
3. In **Settings → Build**, keep the deploy command as `npx wrangler deploy`. The build command can stay empty: Wrangler builds the pages itself (`build` in `wrangler.jsonc`).
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
- **Weather:** refreshed every 15 minutes while someone is looking.
- **Logs:** run `npx wrangler tail`, or open the Worker's **Logs** in the Cloudflare dashboard.
- **Custom domain:** add one under the Worker's **Settings → Domains & Routes**, then update **Team address**.
- **Anyone with the address can see the map**, as on an office network. Put [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/applications/configure-apps/self-hosted-public-app/) in front if the map should stay private.

## Back up and move data

On the Admin page, under **Backup**:

- **Download backup** saves everything, PINs included, to a file. Keep backups private: with one, anyone could work out every PIN.
- **Restore from a file** replaces all usernames, PINs and settings with a backup's. It also accepts the `data.json` from the office server, which is how you move to Cloudflare.

A restore brings over usernames, nicknames, PINs, characters, offices, clocks and the weather location, and people stay logged in. If the backup is from before the last morning reset, places and statuses are cleared, as on any morning. Backups can be up to 2 MB.

## Random member picker

Click **Random picker** on the map page to draw a teammate in a little claw machine. The machine opens in the same style as the map, and its own **2D / 3D** switch changes it at any time, even in the middle of a draw, without changing the result. The 3D machine uses the same decorated characters as the 3D map, and browsers that can't show 3D graphics use the 2D one. Give the draw a title (for example, "Who's buying coffee?") and choose who's in it. Everyone is included to start with, whatever filter the map is showing. **Start draw** picks the winner fairly before anything moves. The claw then looks around, grabs the winner, drops them in the prize chute and reveals them with confetti, which takes about six seconds. **Skip animation** shows the same winner straight away, and devices set to reduce motion always skip it. **Pick again** runs another draw with the same settings, and earlier winners can win again.

The tray shows up to 15 characters. In a bigger draw, everyone still has the same chance, the winner is always among the characters shown, and a note says how many more are in the draw. Draws happen only in your browser: they don't change anyone's status and nothing is saved.

## Home page settings

Set these on the Admin page. They apply straight away and are saved with the rest of the data.

- **Team address:** the address the QR code opens, such as `http://192.168.1.20:8080`. Set it for each deployment. If it's empty, the QR code uses the address the map was opened on. On `localhost` there is no QR code, because a phone couldn't open that address.
- **Clocks:** a name and time zone for each of the two clocks.
- **Main office location:** search for a city and pick it to show its weather. Remove it to hide the weather.
- **Show the office's daylight and weather on the map:** on by default. Turn it off to keep the map in its plain daytime look for everyone.

### Daylight and weather on the map

Once the main office location is set, the 2D and 3D maps follow the time of day there, using the office's real sunrise and sunset. The town gets warm light around sunrise and sunset, and a starry sky at night with glowing street lamps and lit office windows. Names, statuses and characters stay as readable as in the daytime. In the middle of the day, and without an office location, the map looks just as it always has.

The map also shows the office's current weather: drifting clouds (with their shadows passing over the 3D town), fog, drizzle, rain and snow, and thunderstorms with an occasional soft flash of lightning (never a strobe). Rain and snow fall behind people and their names, so everyone stays easy to read. People outdoors (in **Out of Office** and **Off today**) open umbrellas in rain and snow, puddles shine on the street while it rains, snow settles on the room tops, roofs and trees, and trees sway in the wind. With reduced motion turned on in the device's settings, the weather is shown as a still picture, with no lightning or swaying.

Each screen can turn the effects off with the **Weather** button on the map's toolbar, which the browser remembers. The button shows when an office location is set and the setting above is on.

To preview another time of day on one screen, add `?time=dawn`, `day`, `dusk`, `night` or a time such as `?time=21:30` (in the time zone of the screen showing the map, not the office's) to the map's address (for example `/?mode=3d&time=dusk`). To preview weather, add `?weather=` with `clear`, `partly`, `windy`, `cloudy`, `fog`, `drizzle`, `rain`, `downpour`, `snow` or `storm`. Previews show even when the effects are turned off. They can be combined, as in `/?weather=storm&time=night`, and only change that screen. Without an office location, the preview uses a 06:00 sunrise and an 18:00 sunset.

## Settings

Set these in `.env`, then restart.

| Setting | Default | Meaning |
|---|---|---|
| `ADMIN_PASSWORD` | none, required | Password for the Admin page |
| `PORT` | `8080` | Port to open |
| `RESET_AT` | `05:00` | Time each day when everyone's place and status clear |
| `TZ` | `Asia/Ho_Chi_Minh` in Docker, the computer's own otherwise | Time zone for `RESET_AT` |

Avoid `$` in `ADMIN_PASSWORD` when using Docker, because Docker Compose treats it as a variable.

## Good to know

- **Room sizes:** rooms grow and shrink with how many people are in them, and each keeps a minimum size so its name still fits. Working rooms get most of the map; Not checked in and Off today stay small, with a park filling the space beside them. In 2D they glide to their new size; in 3D they change straight away.
- **Working and not working:** Main Office, Other Office and Work from home count as working. Off today and Out of Office count as not working, with Out of Office people on the street through the middle of the map. The map's top buttons and the people list use the same groups.
- **Wandering in 3D:** people walk around inside their own room and never leave it. Everyone in the lobby, at home, on the street or at the beach keeps strolling, stopping now and then to turn and face the camera. In an office, people stay at their desk most of the time and get up for a short walk every so often, going round the desks, plants and other people. A room too crowded to walk in keeps everyone still. The Wander button turns it off, which sends everyone back to their spot, and it's always off when the device asks for reduced motion.
- **Stopping early:** on the User page, **Leaving early** moves someone to Off with that reason in one tap. Choosing any place again clears the reason.
- **Decorating characters:** on the User page, anyone can change their character's body color, add a hat, glasses or a mustache, and draw on its face with a pen. A hat replaces the character's automatic accessory. Drawings are saved as lines (up to 40 lines and 600 points each person), wrap around the face in 3D, and stay through the morning reset.
- **Forgotten PIN:** the admin clicks Release on that username, and the person claims it again with a new PIN.
- **Morning reset:** clears place and status for everyone. Nicknames and PINs stay. If the server was off at reset time, the reset runs when it next starts.
- **More offices:** stop the server and add an entry to `places` in `data.json`. The first entry is the main office, and both maps make room for the rest. In Docker, copy the file out and back with `docker compose cp`.
- **Weather:** the server gets it from [Open-Meteo](https://open-meteo.com) every 15 minutes, sending only the office coordinates. It also gets the sunrise and sunset times, cloud cover, rain amount and wind speed for the map's daylight and weather. Browsers never contact it. The server needs internet access for this, and everything else works without it. If updates fail, the last reading stays for up to 3 hours, then the map shows "Weather unavailable". Check [Open-Meteo's terms](https://open-meteo.com/en/terms) for your use, because its free service is for non-commercial use. Its data license requires the credit line shown under the weather, so keep that in place.
- **Working from home:** teammates can only update their status if they can reach the server, for example over your VPN.
- **Security:** this is built for a trusted office network. The Node.js server uses plain HTTP, so passwords and PINs are not encrypted on the network. Put a reverse proxy with HTTPS in front before exposing it more widely, or deploy to Cloudflare, which uses HTTPS.
