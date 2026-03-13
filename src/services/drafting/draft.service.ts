import type {
  Civ6DraftRequest,
  Civ6DraftResult,
  Civ7DraftRequest,
  Civ7DraftResult,
} from '../../types/drafting.types.js';
import {
  generateCiv6DraftCore,
  generateCiv7DraftCore,
  generateDirectCiv6DraftCore,
  generateDirectCiv7DraftCore,
} from './domain/allocation.service.js';

export { DraftError } from './domain/rules.service.js';

export function generateCiv6Draft(req: Civ6DraftRequest): Civ6DraftResult {
  return generateCiv6DraftCore(req);
}

export function generateDirectCiv6Draft(req: Civ6DraftRequest): Civ6DraftResult {
  return generateDirectCiv6DraftCore(req);
}

export function generateCiv7Draft(req: Civ7DraftRequest): Civ7DraftResult {
  return generateCiv7DraftCore(req);
}

export function generateDirectCiv7Draft(req: Civ7DraftRequest): Civ7DraftResult {
  return generateDirectCiv7DraftCore(req);
}
