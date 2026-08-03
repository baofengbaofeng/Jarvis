import { readFileSync } from 'node:fs';
const base = new URL('../packages/i18n/locales/', import.meta.url);
const flat = (o, p = '') => Object.entries(o).flatMap(([k, v]) =>
  typeof v === 'object' ? flat(v, `${p}${k}.`) : [`${p}${k}`]);
const zh = flat(JSON.parse(readFileSync(new URL('zh-CN/common.json', base), 'utf8')));
const en = flat(JSON.parse(readFileSync(new URL('en/common.json', base), 'utf8')));
const missing = zh.filter(k => !en.includes(k)).concat(en.filter(k => !zh.includes(k)));
if (missing.length) { console.error('i18n mismatch:', missing); process.exit(1); }
console.log('i18n keys symmetric ✓');
