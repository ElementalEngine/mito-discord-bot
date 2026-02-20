import type { BaseReport, Civ6Report, Civ7Report } from "../types/reports.js";
import type { ParsedPlayer } from "../api/types.js";

export function allPlayersHaveDiscordId(players: ParsedPlayer[]): boolean {
  for (const p of players) {
    if (!p.discord_id || p.discord_id === "" || p.discord_id === "0") {
      return false;
    }
  }
  return true;
}

export function isValidPlayerList(player_list: string, players: ParsedPlayer[]): boolean {
  player_list = player_list.replace('TIE', '').replace('tie', '').replace('Tie', '');
  let player_list_order = player_list.split(" ");

  let match_players = players.map(p => p.discord_id);

  // make sure all players are mentioned in the player list. either as <@123> or 123
  for (const p of match_players) {
    if (!player_list_order.includes(`<@${p}>`) && !player_list_order.includes(`${p}`)) {
      return false;
    }
  }

  // make sure one player is not mentioned multiple times in the player list
  let unique_players = new Set(player_list_order);
  if (unique_players.size !== match_players.length) {
    return false;
  }
  return true;
}

export function normalizePlayerList(playerOrder: string): string {
  playerOrder = playerOrder.replace(/<@/g, '').replace(/>/g, '').replace(/tie/g, 'TIE').replace(/Tie/g, 'TIE');
  return playerOrder;
}

export function isValidOrder(new_order: string, players: ParsedPlayer[]): boolean {
  let order = new_order.split(" ").map(id => parseInt(id));
  let num_players = players.map(p => p.team);
  let unique_teams = new Set(num_players);
  let num_teams = unique_teams.size;
  if (order.length !== num_teams) {
    return false;
  }
  return true;
}

export function getPlayerListMessage(match: BaseReport, new_order: string = "", sep: string = "\t\t"): string {
  let playersSortedByPlacement = [];
  if (new_order != "") {
    if (isValidOrder(new_order, match.players)) {
      let new_order_players = new_order.split(" ").map(id => parseInt(id));
      playersSortedByPlacement = [];
      for (const id of new_order_players) {
        const player = match.players.find(p => p.placement === id - 1);
        for (const player in match.players) {
          const placement = match.players[player].placement;
          if (placement === id - 1) {
            playersSortedByPlacement.push(match.players[player]);
          }
        }
      }
    }
  } else {
    playersSortedByPlacement = match.players.sort((a, b) => a.placement - b.placement);
  }
  return playersSortedByPlacement
        .map(p => `<@${p.discord_id}> ${p.user_name ? `(${p.user_name})` : ``}`)
        .join(sep);
}

export function convertMatchToStr(match: BaseReport, includePlayerDiscordIds: boolean): string {
  let edition = match.game;
  let meta = "";
  let body = "";
  if (edition === "civ6") {
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