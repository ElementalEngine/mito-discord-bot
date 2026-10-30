import { serial } from '../utils/serial.js';

// Changes to one lobby, vote or secret vote take turns, so its posts are never
// redrawn from an older copy than the last.
export const inSetupTurn = serial();
