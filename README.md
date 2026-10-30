<p align="center">
  <img src="assets/CPL_Bot_-_Graphic.png" alt="Mite" width="100%" />
</p>

<p align="center">
  <b>Mite</b><br>
  <i>Drafts, lobbies, reporting and rankings for the Civilization Players League</i><br><br>
  <img src="https://img.shields.io/badge/version-2.0.0-blue" alt="Version 2.0.0" />
  <img src="https://img.shields.io/badge/node-24-339933" alt="Node 24" />
  <img src="https://img.shields.io/badge/discord.js-14.27-5865F2" alt="discord.js 14.27" />
  <img src="https://img.shields.io/badge/license-Apache--2.0-lightgrey" alt="Apache-2.0" />
</p>

Mite runs the game side of the CPL Discord server for Civilization VI and VII. Players set up a game with it, play, then upload the save. Mite reads the result, lets the players check it, and once it is approved moves everyone's TrueSkill rating, rank role and leaderboard place.

## Contents

- [What it does](#what-it-does)
- [Commands](#commands)
- [How it works](#how-it-works)
- [Running it](#running-it)
- [Configuration](#configuration)
- [Project layout](#project-layout)
- [License](#license)

## What it does

**Before the game**
- **Drafts.** `/draft` deals each player or team a pool of leaders (and civs, for Civ7), with optional bans picked in a form first.
- **Lobbies.** `/lobby host` sets up a Civ6 lobby with its settings, opens it to players, runs a bans vote by reactions, then deals the draft: standard, random or blind picks.
- **Voice-channel votes.** `/vote` puts every setting, the draft mode and the bans to the players in your voice channel, then deals the draft.
- **Small tools.** Balanced teams from ratings, turn orders, coin flips, map seeds and secret yes/no votes.

**After the game**
- **Reporting from the save.** `/report-game` takes a `.Civ6Save` or `.Civ7Save`. The placements, leaders and civs come from the file.
- **Fixing a report.** The reporter or staff can set the order, assign players, subs and quits, mark ties and fix civs before anything is rated.
- **Contest and approve.** Any player in the game can contest. Staff approve, and a report needing no staff is approved on its own 48 hours after upload.
- **Ratings that follow.** An approved result updates TrueSkill ratings, lifetime and seasonal stats, rank roles and the 20 leaderboard threads. A revert undoes all of it and names who reverted.

**Stats**
- `/stats` and `/stats-history` for any player, `/roomranks` for everyone in your voice channel.

## Commands

| Command | What it does | Who |
|---|---|---|
| `/draft civ6` · `/draft civ7` | Deal drafts, with optional bans | that game's rank role (Civ6 also Cloud) |
| `/lobby host` · `edit` · `browse` · `cancel` | Host and run a Civ6 lobby | Civ6 Ranked |
| `/vote civ6` · `/vote civ7` · `/vote cancel` | Vote on a game with your voice channel | that game's rank role |
| `/secretvote` | A secret yes/no vote, open for 2 minutes | any rank role |
| `/teamgen` | Two balanced teams from ratings | any rank role |
| `/roll` · `/coinflip` · `/mapseed` | Turn orders and picks, a coin, a map seed | any rank role |
| `/report-game` | Report a finished game from its save | any rank role |
| `/report-edit` · `/report-remove` | Fix or remove a report still waiting | its reporter, or staff |
| `/report-revert` | Undo an approved result | admins and developers |
| `/stats` · `/stats-history` · `/roomranks` | Ratings, records and recent games | any rank role |
| `/ping` · `/resetstats` · `/season-new` · `/get-users` | Staff tools | staff only, hidden from everyone else |

Moderators and developers pass every rank-role check. The table above lives in [`config/command-access.ts`](apps/bot/src/config/command-access.ts): the bot enforces it, and at startup logs any place where Discord's Integrations settings differ from it.

## How it works

```
Discord ──▶ Mite ──HTTPS, service token──▶ core-api ──▶ MongoDB Atlas
```

Mite holds no data of its own. Every read and write goes through [core-api](https://github.com/ElementalEngine/core-api-backend), which parses the saves, owns the rules and the ratings, and is the only service that talks to the database.

- **One client.** [`api/client.ts`](apps/bot/src/api/client.ts) is the only place Mite calls core-api: native `fetch`, a timeout on every call, Mite's Bearer token, and retries only where core-api's error says `retryable`.
- **Typed from the spec.** Request and response types are generated from core-api's `openapi.json` into [`packages/contracts`](packages/contracts), so a changed route is a type error here, not a surprise in production.
- **Components V2 panels.** Every message is a panel built from one small kit in [`ui/kit`](apps/bot/src/ui/kit). Lint refuses legacy embeds.
- **Background jobs.** Leaderboard redraws, auto-approval and lobby upkeep run in [`jobs`](apps/bot/src/jobs). Each starts when the bot is ready and stops on shutdown.

## Running it

Mite is a private bot for the CPL server: it needs core-api and the league's database behind it, so it is not set up for self-hosting.

```bash
npm ci                      # Node 24.18 or later
npm run dev -w apps/bot     # watch mode, reads apps/bot/.env.development
npm run verify              # typecheck, lint, tests, version pins, build
npm run build && npm start -w apps/bot
```

Slash commands are deployed to the guild at every start.

When core-api's routes change, refresh the contracts from the core-api checkout at `/opt/development/apps/core-api-backend`:

```bash
npm run vendor:contracts    # copies openapi.json, stamps PROVENANCE, regenerates types
```

## Configuration

Copy [`apps/bot/.env.example`](apps/bot/.env.example) to `apps/bot/.env.development` (or `.env.production`) and fill it in: the bot token, Mite's core-api token, and the server's channel and role ids. The file says what each one is for.

## Project layout

```
apps/bot/src
  api/        the core-api client and its types
  commands/   one file per slash command
  config/     constants and the command-access table
  data/       the leaderboard threads
  events/     Discord gateway events
  handlers/   buttons, menus and forms
  jobs/       background work
  services/   the work behind commands and handlers
  ui/         the panel kit, panels and text layouts
  utils/      small shared helpers
packages/contracts   types generated from core-api's spec
scripts/             contract generation and the version-pin check
```

## License

[Apache-2.0](LICENSE).

Thanks to **Calcifer**, **Ms. Busysnail** and the wider Civilization community for their support and feedback.
