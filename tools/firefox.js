// Firefox 用のファイルを作り、Mozilla のストア（AMO）に提出する。
//
// chrome/ をコピーし、manifest.json だけ firefox/manifest.json に差し替える（Firefox 版は Manifest V2）。
// firefox/manifest.json には、ストアの拡張の ID（変えると別の拡張として扱われ、更新できなくなる）と
// データ収集の申告（この拡張はデータを集めないので none）を書いてある。
//
// 使い方:
//   npm run pack:firefox      ファイルを作る（Mozilla の検査ツールにかけてから、dist/ に ZIP を作る）
//   npm run release:firefox   ファイルを作って、新しい版としてストアに提出する
//     README の更新履歴にある、この版の行の説明を、ストアの「この版の変更点」に載せる（行がなければ提出しない）
//     提出には AMO の API キーが要る。環境変数 WEB_EXT_API_KEY（JWT issuer）と WEB_EXT_API_SECRET（JWT secret）に入れておく
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXTENSION = path.join(ROOT, 'chrome');
const MANIFEST = path.join(ROOT, 'firefox/manifest.json');
const DIST = path.join(ROOT, 'dist');
const WEB_EXT = path.join(ROOT, 'node_modules/web-ext/bin/web-ext.js');

// web-ext を実行する。失敗したら止める
function webExt(args) {
  const r = spawnSync(process.execPath, [WEB_EXT, ...args], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`web-ext ${args[0]} が失敗しました`);
}

// chrome/ をコピーし、manifest を Firefox 用に差し替える。コピーしたフォルダを返す
function prepare() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const chromeVersion = JSON.parse(fs.readFileSync(path.join(EXTENSION, 'manifest.json'), 'utf8')).version;
  if (manifest.version !== chromeVersion) {
    throw new Error(`版がそろっていません（chrome: ${chromeVersion}、firefox: ${manifest.version}）`);
  }
  if (!manifest.browser_specific_settings?.gecko?.id) {
    throw new Error('firefox/manifest.json に拡張の ID（browser_specific_settings.gecko.id）がありません');
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoomimage-firefox-'));
  fs.cpSync(EXTENSION, dir, { recursive: true });
  fs.copyFileSync(MANIFEST, path.join(dir, 'manifest.json'));
  return { dir, version: manifest.version, id: manifest.browser_specific_settings.gecko.id };
}

function pack(dir, version) {
  console.log('■ Mozilla の検査ツール（web-ext lint）にかける');
  webExt(['lint', '--source-dir', dir]);
  console.log('\n■ ZIP を作る');
  fs.mkdirSync(DIST, { recursive: true });
  const filename = `zoomimage-${version}-firefox.zip`;
  webExt(['build', '--source-dir', dir, '--artifacts-dir', DIST, '--filename', filename, '--overwrite-dest']);
  return path.join(DIST, filename);
}

// README の更新履歴から、この版の行（「1.1.4　〜」）の説明を取り出す
function releaseNotes(version) {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const line = readme.split(/\r?\n/).find((l) => l.startsWith(`${version}　`) || l.startsWith(`${version} `));
  return line?.slice(version.length).trim() || null;
}

// AMO の API を呼ぶ（API キーで作った JWT で認証する）
async function amo(method, pathname, body) {
  const encode = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ iss: process.env.WEB_EXT_API_KEY, jti: crypto.randomUUID(), iat: now, exp: now + 60 })}`;
  const signature = crypto.createHmac('sha256', process.env.WEB_EXT_API_SECRET).update(unsigned).digest('base64url');
  const res = await fetch(`https://addons.mozilla.org/api/v5${pathname}`, {
    method,
    headers: { Authorization: `JWT ${unsigned}.${signature}`, 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`AMO の API（${method} ${pathname}）が ${res.status} を返しました`);
  return res.json();
}

async function release(dir, version, id) {
  if (!process.env.WEB_EXT_API_KEY || !process.env.WEB_EXT_API_SECRET) {
    throw new Error('AMO の API キーがありません。環境変数 WEB_EXT_API_KEY と WEB_EXT_API_SECRET を設定してください');
  }
  const notes = releaseNotes(version);
  if (!notes) throw new Error(`README の更新履歴に v${version} の行がありません`);
  console.log('\n■ 新しい版としてストアに提出する（公開されるまで最大 24 時間。人の審査に回るともっとかかる）');
  // 審査の結果は待たない（承認はストアから知らせが来る）
  webExt(['sign', '--source-dir', dir, '--artifacts-dir', DIST, '--channel', 'listed', '--approval-timeout', '0']);

  // ストアの「この版の変更点」を載せる（ストアの既定の言語は日本語）
  // 提出した版を API で書き換える（v1.1.4 で確かめた方法。API で読むときは ?lang=ja を付けないと null に見える）
  const addon = encodeURIComponent(id);
  const { results } = await amo('GET', `/addons/addon/${addon}/versions/?filter=all_with_unlisted`);
  const submitted = results.find((v) => v.version === version);
  if (!submitted) throw new Error(`提出した v${version} がストアに見つかりません。変更点は Developer Hub で入れてください`);
  await amo('PATCH', `/addons/addon/${addon}/versions/${submitted.id}/`, { release_notes: { ja: notes } });
  console.log(`\n「この版の変更点」を載せました: ${notes}`);
}

const command = process.argv[2];
if (!['pack', 'release'].includes(command)) {
  console.error('使い方: node tools/firefox.js pack | release');
  process.exit(1);
}
let dir;
try {
  const prepared = prepare();
  dir = prepared.dir;
  const zip = pack(dir, prepared.version);
  console.log(`\nできたファイル: ${path.relative(ROOT, zip)}（v${prepared.version}、ID ${prepared.id}）`);
  if (command === 'release') await release(dir, prepared.version, prepared.id);
} catch (e) {
  console.error(`\n${e.message}`);
  process.exitCode = 1;
} finally {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
}
