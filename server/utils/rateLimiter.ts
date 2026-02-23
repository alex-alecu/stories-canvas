import pLimit from 'p-limit';
import { config } from '../config.js';

export const imageGenerationLimiter = pLimit(config.imageConcurrency);
