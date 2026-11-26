// Chrome ウェブストアに提出する ZIP を作る。
//
// extension/ をそのまま ZIP にまとめる（共通の manifest がそのまま Chrome 用になっている）。
//
// 使い方:
//   npm run pack:chrome   dist/zoomimage-<版>-chrome.zip を作る。ストアのデベロッパー ダッシュボードからアップロードする
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXTENSION = path.join(ROOT, 'extension');
const DIST = path.join(ROOT, 'dist');
const WEB_EXT = path.join(ROOT, 'node_modules/web-ext/bin/web-ext.js');

const manifest = JSON.parse(fs.readFileSync(path.join(EXTENSION, 'manifest.json'), 'utf8'));
fs.mkdirSync(DIST, { recursive: true });
const filename = `zoomimage-${manifest.version}-chrome.zip`;
// ZIP にまとめるだけなので、Firefox 用と同じ web-ext build を使う（manifest は書き換えない）
const r = spawnSync(process.execPath, [WEB_EXT, 'build', '--source-dir', EXTENSION, '--artifacts-dir', DIST, '--filename', filename, '--overwrite-dest'], { stdio: 'inherit' });
if (r.status !== 0) {
  console.error('\nZIP を作れませんでした');
  process.exitCode = 1;
} else {
  console.log(`\nできたファイル: ${path.relative(ROOT, path.join(DIST, filename))}（v${manifest.version}）`);
}
