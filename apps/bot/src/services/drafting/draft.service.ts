import type {
  Civ6DraftRequest,
  Civ6DraftResult,
  Civ7DraftRequest,
  Civ7DraftResult,
  DraftCommandRequest,
} from '../../types/drafting.types.js';
import {
  generateDirectCiv6DraftCore,
  generateDirectCiv7DraftCore,
} from './domain/allocation.service.js';

export { DraftError } from './domain/rules.service.js';

export function buildCommandStandardDraftResult(request: DraftCommandRequest): Civ6DraftResult | Civ7DraftResult {
  if (request.edition === 'CIV6') {
    return generateDirectCiv6Draft({
      gameType: request.gameType,
      numberPlayers: request.numberPlayers,
      numberTeams: request.numberTeams,
      leaderBansRaw: request.leaderBansRaw,
    });
  }

  return generateDirectCiv7Draft({
    gameType: request.gameType,
    startingAge: request.startingAge ?? 'Antiquity_Age',
    numberPlayers: request.numberPlayers,
    numberTeams: request.numberTeams,
    leaderBansRaw: request.leaderBansRaw,
    civBansRaw: request.civBansRaw,
  });
}

export function generateDirectCiv6Draft(req: Civ6DraftRequest): Civ6DraftResult {
  return generateDirectCiv6DraftCore(req);
}

export function generateDirectCiv7Draft(req: Civ7DraftRequest): Civ7DraftResult {
  return generateDirectCiv7DraftCore(req);
}
