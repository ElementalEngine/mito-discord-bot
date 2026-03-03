import type { BaseReport, Civ6Report, Civ7Report } from "../types/reports.js";
import type { ParsedPlayer } from "../api/types.js";

const TIE_RE = /^tie$/i;
const MENTION_RE = /^<@!?(\d{17,20})>$/;

function tokenToDiscordId(token: string): string {
  const m = token.match(MENTION_RE);
  return m ? m[1] : token;
}

export function allPlayersHaveDiscordId(players: ParsedPlayer[]): boolean {
  for (const p of players) {
    console.log(p.discord_id)
    if (!p.discord_id || p.discord_id === "-1" || p.discord_id === "0") {
      return false;
    }
  }
  return true;
}

export function isValidPlayerList(player_list: string, players: ParsedPlayer[]): boolean {
  const tokens = player_list.trim().split(/\s+/).filter(Boolean);
  const ids = tokens
    .filter((t) => !TIE_RE.test(t))
    .map(tokenToDiscordId);

  const matchIds = players.filter(p => !p.subbed_out).map((p) => p.discord_id).filter((id): id is string => !!id);
  if (ids.length !== matchIds.length) return false;

  const unique = new Set(ids);
  if (unique.size !== ids.length) return false;
  for (const id of matchIds) {
    if (!unique.has(String(id))) return false;
  }
  return true;
}

export function normalizePlayerList(playerOrder: string): string {
  return playerOrder
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      if (TIE_RE.test(token)) return 'TIE';
      return tokenToDiscordId(token);
    })
    .join(' ');
}

export function isValidOrder(new_order: string, players: ParsedPlayer[]): boolean {
  const tokens = new_order.trim().split(/\s+/).filter(Boolean);
  const numTeams = new Set(players.map((p) => p.team)).size;
  if (tokens.length !== numTeams) return false;
  for (const t of tokens) {
    const n = Number.parseInt(t, 10);
    if (!Number.isFinite(n) || n < 1 || n > numTeams) return false;
  }
  return true;
}

export function getPlayerListMessage(match: BaseReport, new_order: string = "", sep: string = "\t\t"): string {
  const players: ParsedPlayer[] = [...match.players];
  if (new_order.trim() && isValidOrder(new_order, match.players)) {
    const tokens = new_order.trim().split(/\s+/).filter(Boolean);
    players.sort((a, b) => {
      const pa = Number.parseInt(tokens[a.team] ?? '', 10);
      const pb = Number.parseInt(tokens[b.team] ?? '', 10);
      const da = Number.isFinite(pa) ? pa : a.placement + 1;
      const db = Number.isFinite(pb) ? pb : b.placement + 1;
      return da - db || a.team - b.team;
    });
  } else {
    players.sort((a, b) => a.placement - b.placement || a.team - b.team);
  }

  return players
    .map((p) => `<@${p.discord_id}> ${p.user_name ? `(${p.user_name})` : ``}`)
    .join(sep);
}

export function convertMatchToStr(match: BaseReport, includePlayerDiscordIds: boolean): string {
  let meta = "";
  let body = "";
  if (match.game === "civ6") {
    const r = match as Civ6Report;
    meta = `Game: ${r.game} | Turn: ${r.turn} | Map: ${r.map_type} | Mode: ${r.game_mode}\n`;
    if (includePlayerDiscordIds) {
      body = `Players:` + getPlayerListMessage(r);
    }
  } else {
    const r = match as Civ7Report;
    meta = `Game: ${r.game} | Turn: ${r.turn} | Age: ${r.age} | Map: ${r.map_type} | Mode: ${r.game_mode}\n`;
    if (includePlayerDiscordIds) {
      body = `Players:` + getPlayerListMessage(r);
    }
  }
  return meta + body;
}