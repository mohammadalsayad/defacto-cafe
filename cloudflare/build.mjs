// بيجمّع الملفات الثابتة للموقع من المجلد الرئيسي لمجلد public/ اللي بيرفعو Cloudflare.
// (server.js والملفات الخاصة بـ Render ما بتنسخ)
import { rmSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const out = join(here, 'public');

const files = [
  'index.html', 'admin.html',
  'logo.png', 'paradox-logo.png', 'iloveme-logo.png', 'map-marker.png',
  'cold-coffee.jpg', 'frappe.jpg', 'hot-coffee.jpg', 'juice.jpg', 'tea.jpg',
  // نسخة أولية للبيانات — بتنقرا إذا KV لسا فاضي
  'menu-data.json', 'promo-data.json'
];

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const f of files) {
  if (!existsSync(join(root, f))) { console.error('MISSING:', f); process.exit(1); }
  copyFileSync(join(root, f), join(out, f));
}
console.log('public/ ready:', files.length, 'files');
