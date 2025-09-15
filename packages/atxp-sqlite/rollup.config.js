import { createConfig } from '../../rollup.config.js';

export default createConfig('atxp-sqlite', {
  platform: 'node', // Node.js only
  external: [
    // Keep SQLite external (native binary)
    'better-sqlite3'
  ]
});