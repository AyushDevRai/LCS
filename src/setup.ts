import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { loadConfig } from './config.js';
loadConfig();
mkdirSync('data',{recursive:true});
if (!existsSync('.env')) {
  writeFileSync('.env',readFileSync('.env.example','utf8').replace(/^API_TOKEN=$/m,`API_TOKEN=${randomBytes(32).toString('hex')}`),{flag:'wx'});
  console.log('Created .env with a random API token. Configure website origins and optional CRM credentials.');
} else console.log('Existing .env preserved.');
console.log('Configuration validated. Run npm test, then npm start.');
