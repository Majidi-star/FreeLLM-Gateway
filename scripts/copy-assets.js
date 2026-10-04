import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

function copyDir(src, dest, filter) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath, filter);
    } else if (!filter || filter(entry.name)) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// Copy SQL migrations
copyDir(
  path.join(root, 'src', 'infra', 'db', 'migrations'),
  path.join(root, 'dist', 'infra', 'db', 'migrations'),
  (name) => name.endsWith('.sql')
);

// Copy Seed JSON files
copyDir(
  path.join(root, 'src', 'catalog'),
  path.join(root, 'dist', 'catalog'),
  (name) => name.endsWith('.seed.json')
);

// Ensure icon.png exists
const iconPath = path.join(root, 'build', 'icon.png');
if (!fs.existsSync(iconPath)) {
  const { execSync } = await import('child_process');
  execSync('node scripts/generate-icon.js', { cwd: root, stdio: 'inherit' });
}

console.log('[✓] Successfully copied database migrations and catalog seed files to dist/');
