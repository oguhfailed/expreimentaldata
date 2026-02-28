/**
 * Copies deployments.json from the parent dex-project directory
 * into frontend/public/ so the React app can fetch it at runtime.
 *
 * Run: npm run setup
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const src  = path.resolve(__dirname, '../deployments.json');
const dest = path.resolve(__dirname, 'public/deployments.json');

if (!fs.existsSync(path.resolve(__dirname, 'public'))) {
  fs.mkdirSync(path.resolve(__dirname, 'public'), { recursive: true });
}

if (fs.existsSync(src)) {
  fs.copyFileSync(src, dest);
  console.log('✅  deployments.json copied to public/');
  console.log('    You can now run: npm run dev');
} else {
  console.log('⚠️   deployments.json not found at:', src);
  console.log('    Deploy contracts first:');
  console.log('    Terminal 1 → cd .. && npx hardhat node');
  console.log('    Terminal 2 → cd .. && npx hardhat run scripts/deploy.js --network localhost');
  console.log('    Then re-run: npm run setup');
}
