// Xの画像ビューア（旧UI: #layers / 新UI: [role="dialog"]）
// ※ main.css のカーソル指定も同じ条件を使用
const viewerSelector = '#layers, [role="dialog"]';
const photoSwipeOptions = {
    wheelToZoom: true,
    initialZoomLevel: 1,
    maxZoomLevel: 10,
    imageClickAction: 'close',
    loop: false,
};
// ダウンロードに失敗したことをボタンで知らせる時間
const downloadErrorMs = 3000;
// 保存に使った一時URLを解放するまでの時間（すぐに解放すると、ブラウザによっては保存が始まる前に消えてしまう）
const revokeDelayMs = 60 * 1000;

// 開いている拡大画面
let pswp = null;

// ビューアの画像をクリックしたら拡大画面を開く
document.addEventListener('click', function (event) {
    if (isTargetImage(event.target)) {
        openPhotoSwipe(event.target);
    }
}, true);

function isTargetImage(node) {
    // 投稿の画像（pbs.twimg.com/media/）のimg要素
    if (node.localName !== 'img' || !isPostImageUrl(node.src)) return false;

    // 画像ビューア内にあり、リンクの中ではない（ビューア内の返信の画像などを除く）
    return node.closest(viewerSelector) !== null && node.closest('a') === null;
}

function isPostImageUrl(src) {
    try {
        const url = new URL(src);
        return url.hostname === 'pbs.twimg.com' && url.pathname.startsWith('/media/');
    } catch {
        return false;
    }
}

function openPhotoSwipe(image) {
    // すでに開いているとき、読み込み中の画像（サイズが取れない）のときは開かない
    if (pswp || !image.naturalWidth) return;

    pswp = new PhotoSwipe({
        ...photoSwipeOptions,
        // 新UIではsrcsetがあるため、実際に表示中の画像（currentSrc）を使う
        dataSource: [{
            src: image.currentSrc || image.src,
            width: image.naturalWidth,
            height: image.naturalHeight,
        }],
    });
    pswp.on('uiRegister', function () {
        pswp.ui.registerElement({
            name: 'download-button',
            order: 8,
            isButton: true,
            title: 'Download',
            html: {
                isCustomSVG: true,
                inner: '<path d="M20.5 14.3 17.1 18V10h-2.2v7.9l-3.4-3.6L10 16l6 6.1 6-6.1ZM23 23H9v2h14Z" id="pswp__icn-download"/>',
                outlineID: 'pswp__icn-download',
            },
            onClick: (event, button) => downloadOriginal(pswp.currSlide.data.src, button),
        });
    });
    pswp.on('destroy', function () {
        pswp = null;
    });
    pswp.init();
}

// オリジナル画像を保存する
// 取得中はボタンを押せないようにし（連打で何度も保存しないため）、失敗したらボタンで知らせる
async function downloadOriginal(src, button) {
    button.disabled = true;
    try {
        const url = new URL(src);
        const { blob, format } = await fetchOriginal(url);
        saveBlob(blob, `${fileBaseName(url)}.${format}`);
    } catch (error) {
        console.error('ZOOM IMAGE: ダウンロードに失敗しました', error);
        showDownloadError(button);
    } finally {
        button.disabled = false;
    }
}

// 表示用の形式（webp等）でオリジナルが取得できない場合に備え、jpg・pngも試す
async function fetchOriginal(url) {
    const formats = [...new Set([url.searchParams.get('format') || 'jpg', 'jpg', 'png'])];
    for (const format of formats) {
        const response = await fetch(`${url.origin}${url.pathname}?format=${format}&name=orig`);
        if (response.ok) {
            return { blob: await response.blob(), format };
        }
    }
    throw new Error(`オリジナル画像を取得できませんでした（${formats.join(', ')}）: ${url.pathname}`);
}

// 保存するファイル名（拡張子なし）
// 投稿の画像のページ（/ユーザー/status/投稿ID/photo/番号）なら「ユーザー_投稿ID_番号」
// 番号が取れなければ番号の代わりに画像のID、投稿のページでなければ画像のIDだけにする
function fileBaseName(imageUrl) {
    const mediaId = imageUrl.pathname.split('/').pop();
    const match = location.pathname.match(/^\/([^/]+)\/status\/(\d+)(?:\/photo\/(\d+))?/);
    if (!match) return mediaId;

    const [, user, post, order] = match;
    return [user, post, order || mediaId].join('_');
}

function saveBlob(blob, filename) {
    const link = document.createElement('a');
    link.download = filename;
    link.href = URL.createObjectURL(blob);

    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), revokeDelayMs);
}

function showDownloadError(button) {
    button.classList.add('zoomimage-download-failed');
    button.title = 'Download failed';
    setTimeout(() => {
        button.classList.remove('zoomimage-download-failed');
        button.title = 'Download';
    }, downloadErrorMs);
}
