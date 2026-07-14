import { randomInt } from 'node:crypto';

import type { RandomSource } from '../../engine/index.js';

const RESOLUTION = 0x1_0000_0000; // 2^32

export const systemRandom: RandomSource = () => randomInt(0, RESOLUTION) / RESOLUTION;