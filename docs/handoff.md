# ZOOM IMAGE for X(Twitter) 開発メモ

X（Twitter）の投稿画像を最大 10 倍まで拡大し、オリジナル画像をダウンロードできるようにするブラウザ拡張。Chrome（Manifest V3）と Firefox（Manifest V2）に対応する。拡大の表示には PhotoSwipe 5.4.3 を使う。

利用者の操作：タイムラインの画像をクリックして X のビューアを開き、その画像をもう一度クリックすると拡大画面（PhotoSwipe）が開く。

## 構成

```
zoomimage/
├─ extension/            拡張本体（Chrome・Firefox 共通）
│  ├─ manifest.json      共通の manifest（Chrome 用の MV3 そのもの）
│  ├─ main.js            クリックの検知、拡大画面、ダウンロード
│  ├─ main.css           ズームカーソル
│  ├─ icons/
│  └─ photoswipe/        PhotoSwipe 5.4.3（改変しない）
├─ tools/
│  ├─ chrome.js          Chrome ウェブストア用の ZIP を作る
│  └─ firefox.js         manifest を Firefox 用に変換して、ZIP を作る・ストアに提出する・開発用に起動する
├─ test/
│  ├─ fixture.html       X の画面の構造（旧UI・新UI・タイムライン）を再現したページ
│  └─ run.js             fixture.html で拡張の動きを確かめる（Chrome と Firefox）
├─ docs/handoff.md       このメモ
└─ images/               ストア用の画像の元データ（git に入れない。公開リポジトリで、他人の投稿が写ったキャプチャや PSD を含むため）
```

- Firefox だけの項目（MV2 への変換、pbs.twimg.com への権限、拡張の ID、データ収集の申告）は、共通の manifest には書かず、`tools/firefox.js` がコピーにだけ足す（Chrome で「認識できないキー」の警告が出ないようにするため）
- Firefox 版を MV3 にしないのは、既存の利用者でサイトへのアクセス権限が外れるおそれがあるため。Firefox は MV2 を廃止する予定もない
- 改行は LF にそろえる（`.gitattributes`）。CRLF が混ざると、チェックアウトのたびに ZIP の中身が変わるため

## コマンド

| コマンド | 内容 |
|---|---|
| `npm test` | Chrome と Firefox で、再現したページを使って動きを確かめる（`npm test -- chrome` で Chrome だけ） |
| `npm run dev:firefox` | Firefox で拡張を読み込んで起動する。`extension/` を保存すると自動で読み込み直す。プロフィールは `.dev/firefox-profile` に残るので、X へのログインは次回も保たれる |
| `npm run pack:chrome` | `dist/` に Chrome ウェブストア用の ZIP を作る |
| `npm run pack:firefox` | Mozilla の検査ツールにかけてから、`dist/` に Firefox 用の ZIP を作る |
| `npm run release:firefox` | Firefox 用の ZIP を作って、新しい版として AMO に提出する |

- Chrome で試すときは、`chrome://extensions` でデベロッパーモードをオンにし、「パッケージ化されていない拡張機能を読み込む」で `extension/` を選ぶ。変えたら拡張を再読み込みしてから、X のページも再読み込みする
- `npm test` は、インストール済みの Chrome と Firefox をヘッドレスで使う。場所が違うときは環境変数 `CHROME_PATH` / `FIREFOX_PATH` で指定する

## 動きの仕組み（`extension/main.js`）

- `document` の `click` をキャプチャで受け、クリックされた要素が次をすべて満たせば、PhotoSwipe を開く（`isTargetImage`）
  - `img` 要素
  - `src` に `pbs.twimg.com/media/` を含む（投稿の画像。絵文字やアイコンを除く）
  - X の画像ビューアの中（`#layers, [role="dialog"]`。旧UIは `#layers`、新UIは `[role="dialog"]`）
  - `a` 要素の中ではない（ビューア内の返信の画像などを除く）
- 拡大するのは、表示中の画像（`currentSrc`。新UIは `srcset` があるため）。読み込み中（`naturalWidth` が 0）なら開かない
- ズームカーソルは `main.css` で付ける。条件は `isTargetImage` と同じ（変えるときは両方変える）
- ダウンロード：画像の URL を `?format=<形式>&name=orig` にしてオリジナルを取得する。形式は URL の `format` を先に試し、取れなければ jpg、png の順に試す。ファイル名は、ページの URL（`/<ユーザー>/status/<投稿ID>/photo/<番号>`）から `<ユーザー>_<投稿ID>_<番号>.<取れた形式>` にする

## X の画面の構造（2026-11 時点）

X は 2026-11-05 から、作り直した新しい Web 版（新UI）を出している。ログインしている人には国ごとに順次切り替えていて、ログアウト状態では全員が新UIになる。旧UIと新UIが混在するので、拡張は両方に対応している。

### 見分け方

- 新UIでは `document.documentElement.dataset.appVersion` に値がある（旧UIは `undefined`）
- 新UIの JS は `https://abs.twimg.com/x-web/x-web/entry-client*.js`、旧UIは `https://abs.twimg.com/responsive-web/client-web*/main.*.js`

### 旧UI

- ルートは `#react-root`。ビューアなどのモーダルは `#layers` の中に出る
- ビューアの画像は `img` で、クリックするとその `img` に当たる

### 新UI

- `#react-root` も `#layers` もない
- ビューアは `[data-base-ui-portal]` の中の `[role="dialog"][data-slot="xds-modal-surface"]`。`aria-label` は言語ごとに違う（英語は "Media viewer"）。Base UI のダイアログで、フォーカスの閉じ込めや、外側のクリックで閉じる仕組みがある
- ビューアの画像は `img`（クラス `absolute inset-0 size-full object-contain …`）。領域いっぱいに広がり、`object-fit: contain` で表示されるので、余白をクリックしても `img` に当たる。`src` は `name=large`、`srcset` には元の画像が 2048px より大きいとき `name=4096x4096` も入る
- 読み込み中は、小さいプレビューの `img`（`aria-hidden`）が下に出て、本体の `img` は透明になる
- タイムラインの画像は `img` の上に `a[aria-label="View media"]`（`absolute inset-0`）が重なっている。`img` は `a` の中ではない。クリックはリンクに当たる
- 画像の URL：`https://pbs.twimg.com/media/<ID>?format=<jpg|png|webp>&name=<240x240|360x360|small|900x900|medium|large|4096x4096|orig>`。`format` は元の画像の形式（API の `media_url_https` の拡張子）から決まる
- 画像を左右に切り替える部品（ページャー）は、矢印キーを `window` のキャプチャで受けられる作りになっている（ビューアでその設定が使われているかは未確認）
- 重なり順：X の CSS の `z-index` は最大 9999（アプリ内ブラウザ用の要素を除く）。PhotoSwipe は 100000 なので、ビューアより前に出る

### 調べ方

- 新UIの JS は公開されている。ログアウト状態の `x.com` の HTML から `entry-client-logged-out-*.js` を取得し、中に書かれた `assets/*.js` を辿って取得できる（2026-11-26 には約 1400 個あった）。ビューアは `tweetMediaViewer` などの文字列で探せる
- 新UIに対応済みの拡張 Control Panel for Twitter（https://github.com/insin/control-panel-for-twitter ）の `script.js` の `xweb` の部分に、新UIのセレクタがまとまっている
- ヘッドレスの Chrome で `x.com` を開くと 403（ボット判定）になる。回避はしない
- ログアウト状態では、画像をクリックするとログインを求められ、ビューアは開けない

### ログインしたまま新UIを試す方法（未確認）

Control Panel for Twitter と同じ方法。2026-11-26 時点で、開発者の環境ではまだ成功を確かめていない。

1. ログインした状態で `https://x.com/i/oauth2/authorize`（`?` 以降は付けない）を開く。「問題が発生しました」と表示される
2. コンソールで `document.documentElement.dataset.appVersion` を実行する。値が返れば、このページは新UIで描画されている（`undefined` なら、この方法は使えない）
3. コンソールで次を実行すると、新UIのままホームに移動する。再読み込みすると旧UIに戻る

```js
(async () => {
  const visited = new Set();
  let router = null;
  for (const el of [document.querySelector('main'), document.querySelector('article'), document]) {
    if (!el || router) continue;
    for (const key of Object.keys(el).filter((k) => /^__react(?:Fiber|Container)\$/.test(k))) {
      let fiber = el[key];
      while (fiber?.return) fiber = fiber.return;
      const stack = [fiber?.stateNode?.current];
      while (stack.length && !router) {
        const node = stack.pop();
        if (!node || visited.has(node)) continue;
        visited.add(node);
        for (const c of [node.memoizedProps?.router, node.memoizedProps?.value]) {
          if (typeof c?.navigate === 'function' && typeof c?.subscribe === 'function' &&
              typeof c?.options?.context?.relayEnvironment?.getStore === 'function') router = c;
        }
        if (node.sibling) stack.push(node.sibling);
        if (node.child) stack.push(node.child);
      }
    }
  }
  if (!router) return console.log('ルーターが見つかりません（このページは新UIではない可能性があります）');
  await router.navigate({ to: '/home', replace: true });
})();
```

## テスト（`test/`）

- `test/fixture.html` は、X の画面のうち拡張が関わる部分（旧UIのビューア、新UIのビューア、新UIのタイムライン、ビューア内の返信）を再現したページ。X が UI を変えたら、ここも合わせる
- `test/run.js` は、manifest に書いた content script と CSS をページにそのまま読み込み、ヘッドレスの Chrome と Firefox でクリックやダウンロードを確かめる。pbs.twimg.com への要求はダミーで返し、X にはアクセスしない
- 拡張としては読み込んでいない。content script の分離された環境での違いは確かめていない
- 1.1.3 の `main.js` で実行すると、新UIの「クリックで拡大画面が開く」が NG になる（新UIで動かなかった不具合を検出できる）

## ストアでの公開

### 決めてあること

| 項目 | 内容 |
|---|---|
| 拡張の ID（Firefox） | `{03b385b9-8afe-469a-8657-1146a2f5de1f}`。AMO が付けたもの（以前は manifest に書いていなかったが、配布されたファイルには入っていた）。変えると別の拡張として扱われ、更新できなくなる |
| データ収集の申告（Firefox） | 集めない（`none`）。v1.1.4 から |
| 対応する Firefox | AMO が 58 以上にした（v1.1.3 までは 48 以上） |
| AMO のページ | https://addons.mozilla.org/ja/firefox/addon/zoom-image-for-x-twitter/ （作者 MynicoTools） |

### 新しい版を出す手順

1. `extension/manifest.json` の `version` を上げる
2. README の更新履歴に「`<版>　<説明>`」の行を足す（Firefox のストアの「この版の変更点」にも使う）
3. `npm test` がすべて OK になることを確かめる
4. `npm run release:firefox` で AMO に提出する
   - AMO の API キーは、Windows のユーザーの環境変数 `WEB_EXT_API_KEY`（JWT issuer）と `WEB_EXT_API_SECRET`（JWT secret）に入れてある。リポジトリには書かない。なくしたら https://addons.mozilla.org/developers/addon/api/key/ で作り直す
   - 提出のあと、README の行を「この版の変更点」として API で書き込む。API で読むときは `?lang=ja` を付けないと `null` に見える
5. `npm run pack:chrome` で ZIP を作り、Chrome ウェブストアのデベロッパー ダッシュボードからアップロードする（API は使っていない）
6. 「`<版>　<説明>`」の形でコミットする

### 経過

- v1.1.4（新UIに対応）：2026-11-26 10:40 ごろ AMO に提出し、約 6 分後に自動で公開された。Chrome ウェブストアには同じ日に申請した

## 残課題

- 新UIでの実機確認。とくに、拡大画面を閉じたときに X のビューアに戻るか（Base UI のダイアログが、フォーカスの移動や外側のクリックで閉じてしまうおそれ）、拡大画面を開いている間に矢印キーで裏の画像が切り替わらないか
- ダウンロードのファイル名はページの URL から作るので、`/photo/<番号>` が付かない URL（新UIの `/mediaviewer` など）では番号が空になる
