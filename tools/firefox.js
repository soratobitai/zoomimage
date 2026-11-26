// Firefox 用のファイルを作り、Mozilla のストア（AMO）に提出する。
//
// 共通の manifest（extension/manifest.json、Chrome 用の MV3）には Firefox だけの項目を書かない（Chrome で「認識できないキー」の警告が出るため）。
// ここで extension/ をコピーし、そのコピーの manifest を Firefox 用に書き換える。
//   - MV2 にする（MV3 にすると、既存の利用者でサイトへのアクセス権限が外れるおそれがある。Firefox は MV2 を廃止する予定もない）
//   - ダウンロードで画像を取得する pbs.twimg.com への権限
//   - 拡張の ID（ストアが付けたもの。変えると別の拡張として扱われ、更新できなくなる）
//   - データ収集の申告（この拡張はデータを集めないので none）
//
// 使い方:
//   npm run dev:firefox       Firefox で拡張を読み込んで起動する。extension/ を保存すると自動で読み込み直す
//     プロフィールは .dev/firefox-profile に残るので、X へのログインは次回も保たれる
//   npm run pack:firefox      ファイルを作る（Mozilla の検査ツールにかけてから、dist/ に ZIP を作る）
//   npm run release:firefox   ファイルを作って、新しい版としてストアに提出する
//     README の更新履歴にある、この版の行の説明を、ストアの「この版の変更点」に載せる（行がなければ提出しない）
//     提出には AMO の API キーが要る。環境変数 WEB_EXT_API_KEY（JWT issuer）と WEB_EXT_API_SECRET（JWT secret）に入れておく
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXTENSION = path.join(ROOT, 'extension');
const DIST = path.join(ROOT, 'dist');
const DEV = path.join(ROOT, '.dev');
const WEB_EXT = path.join(ROOT, 'node_modules/web-ext/bin/web-ext.js');

const GECKO = {
  id: '{03b385b9-8afe-469a-8657-1146a2f5de1f}',
  data_collection_permissions: { required: ['none'] },
};
const PERMISSIONS = ['https://pbs.twimg.com/media/*'];
// MV2 にそのまま持っていけない項目（使い始めたら、firefoxManifest に変換を足す）
const MV3_ONLY = ['action', 'background', 'host_permissions', 'permissions', 'web_accessible_resources'];

// web-ext を実行する。失敗したら止める
function webExt(args) {
  const r = spawnSync(process.execPath, [WEB_EXT, ...args], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`web-ext ${args[0]} が失敗しました`);
}

// 共通の manifest から、Firefox 用の manifest を作る
function firefoxManifest() {
  const manifest = JSON.parse(fs.readFileSync(path.join(EXTENSION, 'manifest.json'), 'utf8'));
  const unsupported = MV3_ONLY.filter((key) => key in manifest);
  if (unsupported.length) throw new Error(`Firefox 用（MV2）への変換に未対応の項目があります: ${unsupported.join(', ')}`);
  return { ...manifest, manifest_version: 2, permissions: PERMISSIONS, browser_specific_settings: { gecko: GECKO } };
}

// extension/ を dir にコピーし、manifest を Firefox 用に書き換える
function writeExtension(dir) {
  const manifest = firefoxManifest();
  fs.cpSync(EXTENSION, dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 4)}\n`);
  return manifest.version;
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

async function release(dir, version) {
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
  const addon = encodeURIComponent(GECKO.id);
  const { results } = await amo('GET', `/addons/addon/${addon}/versions/?filter=all_with_unlisted`);
  const submitted = results.find((v) => v.version === version);
  if (!submitted) throw new Error(`提出した v${version} がストアに見つかりません。変更点は Developer Hub で入れてください`);
  await amo('PATCH', `/addons/addon/${addon}/versions/${submitted.id}/`, { release_notes: { ja: notes } });
  console.log(`\n「この版の変更点」を載せました: ${notes}`);
}

// Firefox で拡張を読み込んで起動する。extension/ の変更をコピーに反映すると、web-ext が読み込み直す
// 後ろに付けた引数は web-ext run にそのまま渡す（例: npm run dev:firefox -- --arg=-headless）
function dev(extraArgs) {
  const dir = path.join(DEV, 'firefox-extension');
  fs.rmSync(dir, { recursive: true, force: true });
  writeExtension(dir);
  let timer;
  fs.watch(EXTENSION, { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        writeExtension(dir);
        console.log('extension/ の変更をコピーに反映しました');
      } catch (e) {
        console.error(e.message);
      }
    }, 200);
  });
  const child = spawn(process.execPath, [
    WEB_EXT, 'run', '--source-dir', dir,
    '--firefox-profile', path.join(DEV, 'firefox-profile'), '--profile-create-if-missing', '--keep-profile-changes',
    ...extraArgs,
  ], { stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code ?? 0));
}

const command = process.argv[2];
if (command === 'dev') {
  dev(process.argv.slice(3));
} else if (['pack', 'release'].includes(command)) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoomimage-firefox-'));
  try {
    const version = writeExtension(dir);
    const zip = pack(dir, version);
    console.log(`\nできたファイル: ${path.relative(ROOT, zip)}（v${version}、ID ${GECKO.id}）`);
    if (command === 'release') await release(dir, version);
  } catch (e) {
    console.error(`\n${e.message}`);
    process.exitCode = 1;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
} else {
  console.error('使い方: node tools/firefox.js dev | pack | release');
  process.exit(1);
}
