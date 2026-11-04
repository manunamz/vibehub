'use strict';
/* Run-mode resolver. Must be applied BEFORE requiring lib/store, which reads
 * VIBEHUB_DATA (and mkdirs it) at load time.
 *
 *   node server.js            # use mode  → <root>/data      (empty by default)
 *   node server.js --demo     # demo mode → <root>/data-demo (seeded from ./demo)
 *
 * An explicit VIBEHUB_DATA always wins over the flag's default dir.
 */
const fs = require('fs');
const path = require('path');

function apply(argv, root) {
  const demo = argv.includes('--demo');
  if (!process.env.VIBEHUB_DATA) {
    process.env.VIBEHUB_DATA = path.join(root, demo ? 'data-demo' : 'data');
  }
  const dataDir = process.env.VIBEHUB_DATA;

  if (demo) {
    const reposDir = path.join(dataDir, 'repos');
    const empty = !fs.existsSync(reposDir) || fs.readdirSync(reposDir).length === 0;
    if (empty) {
      const { seed } = require('../seed');
      const repos = seed({ dataDir, demoDir: path.join(root, 'demo') });
      console.log(`  🌱 seeded ${repos.length} demo repo(s) → ${path.relative(root, dataDir)}/`);
    }
  }
  return { demo, dataDir };
}

module.exports = { apply };
