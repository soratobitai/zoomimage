// X の画面の構造を再現したページ（test/fixture.html）で、拡張の動きを確かめる。
//
// extension/ の manifest に書いた content script と CSS を、ページにそのまま読み込んで動かす（拡張としては読み込まない）。
// pbs.twimg.com の画像はダミーを返し、X にはアクセスしない。
// インストール済みの Chrome と Firefox をヘッドレスで使う（場所が違うときは環境変数 CHROME_PATH / FIREFOX_PATH で指定する）。
//
// 使い方:
//   npm test               Chrome と Firefox で確かめる
//   npm test -- chrome     Chrome だけ（firefox なら Firefox だけ）
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXTENSION = path.join(ROOT, 'extension');
const BROWSERS = {
  chrome: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  firefox: process.env.FIREFOX_PATH || 'C:/Program Files/Mozilla Firefox/firefox.exe',
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// fixture.html に、manifest の content script と CSS を差し込む
function fixture() {
  const manifest = JSON.parse(fs.readFileSync(path.join(EXTENSION, 'manifest.json'), 'utf8'));
  const [script] = manifest.content_scripts;
  return fs.readFileSync(path.join(ROOT, 'test/fixture.html'), 'utf8')
    .replace('<!-- EXTENSION_CSS -->', script.css.map((f) => `<link rel="stylesheet" href="/extension/${f}">`).join('\n'))
    .replace('<!-- EXTENSION_JS -->', script.js.map((f) => `<script src="/extension/${f}"></script>`).join('\n'));
}

function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/extension/')) {
      const file = path.join(EXTENSION, decodeURIComponent(url.pathname.slice('/extension/'.length)));
      if (!file.startsWith(EXTENSION) || !fs.existsSync(file)) {
        res.writeHead(404);
        return res.end();
      }
      res.writeHead(200, { 'content-type': file.endsWith('.css') ? 'text/css' : 'text/javascript' });
      return res.end(fs.readFileSync(file));
    }
    // 投稿のページの URL（ダウンロードのファイル名に使われる）で開く
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(fixture());
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// pbs.twimg.com への要求に、ダミーの画像を返す
// 表示用の形式（webp）のオリジナルは無いものとして 404 を返し、ダウンロードが jpg を取り直すかを確かめる
function answerImage(request, requests) {
  const url = new URL(request.url());
  requests.push(request.url());
  const format = url.searchParams.get('format');
  const name = url.searchParams.get('name');
  const headers = { 'Access-Control-Allow-Origin': '*' };
  if (name === 'orig' && format === 'webp') return request.respond({ status: 404, headers, body: '' });
  const [w, h] = name === 'small' ? [680, 453] : [2048, 1365];
  return request.respond({
    status: 200,
    contentType: 'image/svg+xml',
    headers,
    body: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#468"/></svg>`,
  });
}

async function check(browserName, port) {
  const results = [];
  const expect = (name, ok, detail) => results.push({ name, ok, detail });
  const browser = await puppeteer.launch({
    browser: browserName,
    executablePath: BROWSERS[browserName],
    headless: true,
    defaultViewport: { width: 1280, height: 800 },
  });
  try {
    const page = await browser.newPage();
    const requests = [];
    await page.setRequestInterception(true);
    page.on('request', (request) => (request.url().startsWith('https://pbs.twimg.com/') ? answerImage(request, requests) : request.continue()));
    await page.goto(`http://127.0.0.1:${port}/someuser/status/1234567890/photo/1`);
    await page.waitForFunction(() => [...document.images].every((img) => img.complete && img.naturalWidth > 0));

    const cursor = (id) => page.$eval(`#${id}`, (el) => getComputedStyle(el).cursor);
    const isOpen = () => page.evaluate(() => !!document.querySelector('.pswp.pswp--open'));
    const clickCenter = async (id) => {
      const box = await page.$eval(`#${id}`, (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
      await page.mouse.click(box.x, box.y);
      await sleep(1000);
    };
    const download = async () => {
      requests.length = 0;
      await page.$eval('.pswp__button--download-button', (el) => el.click());
      await sleep(1000);
      return {
        originals: requests.filter((u) => u.includes('name=orig')),
        file: await page.evaluate(() => window.__downloads.at(-1)),
      };
    };
    const close = async () => {
      await page.$eval('.pswp__button--close', (el) => el.click());
      await sleep(800);
    };

    expect('新UIのビューアの画像はズームカーソル', (await cursor('new-viewer')) === 'zoom-in', await cursor('new-viewer'));
    expect('旧UIのビューアの画像はズームカーソル', (await cursor('old-viewer')) === 'zoom-in', await cursor('old-viewer'));
    expect('タイムラインの画像はカーソルを変えない', (await cursor('timeline')) !== 'zoom-in', await cursor('timeline'));
    expect('リンクの中の画像はカーソルを変えない', (await cursor('reply')) !== 'zoom-in', await cursor('reply'));

    const currentSrc = await page.$eval('#new-viewer', (img) => img.currentSrc);
    // 拡大画面が開かなかったときは、その中での確認（ダウンロードなど）を飛ばす
    await clickCenter('new-viewer');
    const newOpened = await isOpen();
    expect('新UI：クリックで拡大画面が開く', newOpened);
    if (newOpened) {
      const shown = await page.evaluate(() => document.querySelector('.pswp__img:not(.pswp__img--placeholder)')?.getAttribute('src'));
      expect('新UI：表示中の画像（currentSrc）を拡大する', shown === currentSrc, shown);
      const newUi = await download();
      expect('新UI：webp のオリジナルが無ければ jpg を取り直す', JSON.stringify(newUi.originals) === JSON.stringify([
        'https://pbs.twimg.com/media/NEWUI?format=webp&name=orig',
        'https://pbs.twimg.com/media/NEWUI?format=jpg&name=orig',
      ]), newUi.originals.join(' , '));
      expect('新UI：ファイル名は「ユーザー_投稿ID_番号.取れた形式」', newUi.file === 'someuser_1234567890_1.jpg', newUi.file);
      await close();
      expect('新UI：閉じるボタンで閉じる', !(await isOpen()));
    }

    await clickCenter('old-viewer');
    const oldOpened = await isOpen();
    expect('旧UI：クリックで拡大画面が開く', oldOpened);
    if (oldOpened) {
      const oldUi = await download();
      expect('旧UI：オリジナルを 1 回で取得する', JSON.stringify(oldUi.originals) === JSON.stringify([
        'https://pbs.twimg.com/media/OLDUI?format=jpg&name=orig',
      ]), oldUi.originals.join(' , '));
      await close();
    }

    await clickCenter('timeline');
    expect('タイムラインの画像（リンクが重なっている）では開かない', !(await isOpen()));
    await clickCenter('reply');
    expect('リンクの中の画像では開かない', !(await isOpen()));
  } finally {
    await browser.close();
  }
  return results;
}

const targets = process.argv[2] ? [process.argv[2]] : Object.keys(BROWSERS);
if (targets.some((name) => !BROWSERS[name])) {
  console.error('使い方: node test/run.js [chrome | firefox]');
  process.exit(1);
}
const server = await startServer();
let failed = 0;
try {
  for (const name of targets) {
    console.log(`■ ${name}`);
    for (const { name: label, ok, detail } of await check(name, server.address().port)) {
      if (!ok) failed++;
      console.log(`  ${ok ? 'OK  ' : 'NG  '}${label}${!ok && detail ? `（${detail}）` : ''}`);
    }
  }
} catch (e) {
  failed++;
  console.error(e);
} finally {
  server.close();
}
console.log(failed ? `\n${failed} 件失敗しました` : '\nすべて OK');
process.exitCode = failed ? 1 : 0;
