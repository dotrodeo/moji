# Moji

Real-time multiplayer party game: players craft emoji clues for secret prompts and race to guess
each other's.

- [`CLAUDE.md`](CLAUDE.md) — design invariants and the decisions behind them. Read this before
  changing game rules, scoring, or anything the serializer touches.
- [`docs/content-guidelines.md`](docs/content-guidelines.md) — how prompts and packs are stored, and
  what makes a prompt worth adding.
- [`docs/design-system.md`](docs/design-system.md) — the "Retro Internet Party" visual system:
  color roles, type, sticker shapes and shadows, motion, components.
- [`docs/case-study-brief.md`](docs/case-study-brief.md) — a written-up tour of the project for
  external readers.

Code comments cite sections of the original design doc (§3 state machine, §5 persistence, §6
dealing, §7 rules & anti-cheat). That doc is lost; `CLAUDE.md` and the code are the record now.

## How it plays

A host creates a room, everyone joins with a 5-character code or the `/r/CODE` link, and each round
runs: every player is dealt a **secret prompt** from a content pack, builds a clue from **1–10
emoji**, then the room plays the clues back one at a time and races to guess each.

- **Scoring** — guessers get 1000 points decaying to 150 across the guess window; authors are paid
  per solver, weighted by how long that solve took, so the most literal clue is not the best one.
- **Packs** — 17 of them. The pack name is shown to guessers as their one free hint. `packMode`
  is `shared` (one pack for the round) or `mixed` (every player draws from a different pack).
- **Prompt swaps** — 3 per round, 150 points each, so a swap is a real choice.
- **Letter hints** — blanks fill in during the guess window, planned and ticked server-side.
- **Solving** — gets you the answer, a side channel with the other solvers, and a bump to pay the
  author.
- **Dropping out** — lose your connection for under a minute and you're put back in your seat
  automatically. Gone longer and the seat is given up: you're brought back in as a new player, and
  told so. Open the room in a second tab and the game moves there (the other tab offers to take it
  back).

Defaults: 3 rounds, 60s to build a clue, 30s to guess each one. 2 players minimum, built for 4–10,
and a room seats at most 12 players plus 8 spectators.

### Solo (vs Mojibot)

`/solo`, or the link under the buttons on the landing page: one human against a bot, no lobby, two
rounds, about four minutes. The bot is a **headless client** — it is handed the same role-filtered
`RoomView` a browser gets and issues the same commands, so it cannot see the answer to your clue and
has to genuinely guess it from your emoji and the pack name. How sure it is sets *when* it guesses,
so a literal clue gets cracked early and earns you very little. It plays hand-written clues
(`server/src/content/database/bot-clues.ts`) and rounds are dealt only from prompts that library
covers. See `server/src/bots/`.

## Stack

- **Client** — React + TypeScript + Vite + Tailwind (`packages/client`)
- **Server** — Node + TypeScript + Express + Socket.IO (`packages/server`)
- **Shared** — event contracts, domain types, scoring, hints, emoji rules (`packages/shared`)
- **DB** — PostgreSQL via Drizzle ORM
- **Tests** — Vitest, run from the repo root across all workspaces
- **Deploy** — single Docker image (server serves the built client) behind a Cloudflare Tunnel

The server is authoritative, and runs as **one process**. Live room state is in that process's
memory: the `RoomStore` seam holds live `Room` objects, phase timers included, so it is not a drop-in
point for an external store. Running more than one process would mean routing each room's players to
the process that owns it. Everything sent to a client goes through the role-filtered serializer in
`packages/server/src/realtime/serialize.ts`. See `packages/server/src/rooms/` and
`packages/server/src/realtime/`.

## Prerequisites

- Node 24 (`nvm use` reads `.nvmrc`)
- Docker (for Postgres locally, and for the production image)

## Local development

```bash
cp .env.example .env            # then edit SESSION_SECRET
docker compose up -d db         # Postgres on :5432
npm install
npm run db:migrate              # apply schema
npm run db:seed                 # load the prompt library (also runs on every server boot)
npm run dev                     # server :3000, vite client :5173 (proxied to server)
```

Open http://localhost:5173 during development (Vite proxies socket/API traffic to the server on
:3000).

The server applies migrations and reconciles the database's prompts with the code's on every boot
(`AUTO_MIGRATE=false` to manage that externally): new prompts are added, edited ones updated, and
removed ones retired, never deleted, in one transaction. `ContentProvider` falls back to the bundled
prompt set when the database is empty or unreachable, so the game runs even with no Postgres at all.
Only completed-game records and the landing-page counter need the database.

## Production-style run (single container)

Set a real `SESSION_SECRET` in `.env` first: the container runs with `NODE_ENV=production`, and in
production the server refuses to start with the built-in default (session tokens are signed with it).

```bash
docker compose up --build moji   # builds client + server into one image, serves 127.0.0.1:3000
```

The app port is published on `127.0.0.1` only; the public path in is the tunnel below. The image runs
as the unprivileged `node` user.

Add the Cloudflare Tunnel by setting `CLOUDFLARE_TUNNEL_TOKEN` in `.env` and running:

```bash
docker compose --profile tunnel up -d
```

Point the tunnel's public hostname at `http://moji:3000` and enable WebSockets. Set `PUBLIC_ORIGIN`
to the real origin: it drives CORS and the `og:url`/`og:image` tags stamped into the HTML shell, so
a domain move needs no code change.

## HTTP endpoints

Everything else is Socket.IO. See `packages/shared/src/events.ts` for the event contract.

| Route | What it serves |
|---|---|
| `/healthz` | liveness + live room count |
| `/api/stats` | public counters for the landing page (nulls when the DB is down) |
| `/r/:code` | the app shell with live Open Graph tags for that room (`Cache-Control: no-store`) |
| `/solo` | served by `*`; on that path the client starts a game against the bot |
| `*` | the app shell with origin-corrected Open Graph tags |

Every response carries security headers: a CSP limited to `frame-ancestors 'none'`, `base-uri`,
`object-src` and `form-action`, plus `X-Frame-Options`, `nosniff`, a referrer policy, and HSTS in
production.

## Limits

Nothing a client sends is trusted: every Socket.IO payload is checked at runtime
(`packages/server/src/realtime/validate.ts`) before it reaches the game. The deliberate limits:

| Limit | Value | Where |
|---|---|---|
| Socket.IO message size | 16 KB | `maxHttpBufferSize` in `server/src/index.ts` |
| Guess length | 100 characters | `MAX_GUESS_LENGTH` in `shared/src/events.ts` |
| Players / spectators per room | 12 / 8 | `server/src/rooms/Room.ts` |
| Live rooms per server | 300 | `MAX_ROOMS` in `server/src/rooms/RoomManager.ts` |
| Idle room lifetime | 60 min without a player action | `IDLE_ROOM_MS`, same file |
| Seat held after a disconnect | 60 s | `DISCONNECT_GRACE_MS`, same file |
| Joins per visitor | 30 a minute | `server/src/realtime/handlers.ts` |
| New rooms per visitor | 10 per 10 minutes | same file |

Visitors are told apart by `cf-connecting-ip`, which is only trustworthy because production is
reachable solely through the Cloudflare Tunnel. The server logs which key source it uses.

## Workspace scripts

| Command | What it does |
|---|---|
| `npm run dev` | Build shared, then run server + client dev servers concurrently |
| `npm run build` | Build shared → client → server |
| `npm run typecheck` | Typecheck all workspaces |
| `npm test` | Run the Vitest suite once (CI) |
| `npm run test:watch` | Run Vitest in watch mode |
| `npm run db:generate` | Generate a Drizzle migration from schema changes |
| `npm run db:migrate` | Apply migrations |
| `npm run db:seed` | Reconcile the database's prompts with the code (add, update, retire) |
| `npm start` | Run the built server (serves the built client) |

CI (`.github/workflows/ci.yml`) runs `npm ci`, `typecheck`, `test` and `build` on every PR and every
push to `main`, on the Node version in `.nvmrc` (the same major the Dockerfile ships).

## Shipping changes

`main` only takes merged PRs whose CI passed (branch protection, admins included). Every production
deploy is a versioned release: the PR bumps `version` in `package.json`, the merge commit is tagged
`vX.Y.Z` with a GitHub release, and the built image is tagged `moji-moji:X.Y.Z` so an earlier version
can be put back by re-tagging it. The details, including how to roll back, are in `CLAUDE.md` under
*Shipping changes*.

## Layout

```
packages/
  shared/   # @moji/shared — types, socket events, scoring, hints, emoji rules
  server/   # @moji/server — http + socket.io, state machine, content, bots, db, seams
  client/   # @moji/client — react app
.github/workflows/     # CI: typecheck, test, build
docs/                  # content guidelines, case-study brief
.nvmrc                 # the Node major for dev and CI (the Dockerfile's must match)
Dockerfile             # multi-stage: build client+server, run server
docker-compose.yml     # db + moji server (+ cloudflared profile)
```
