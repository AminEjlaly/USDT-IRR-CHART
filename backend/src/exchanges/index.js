import { config } from '../config.js';
import { WallexAdapter } from './wallex.js';
import { NobitexAdapter } from './nobitex.js';

const adapters = [];
if (config.wallex.enabled) adapters.push(new WallexAdapter(config.wallex));
if (config.nobitex.enabled) adapters.push(new NobitexAdapter(config.nobitex));
export { adapters };
