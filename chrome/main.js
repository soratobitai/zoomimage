const xRootID = 'react-root';
const layersID = 'layers';
const photoSwipeOptions = {
    pswpModule: PhotoSwipe,
    wheelToZoom: true,
    initialZoomLevel: 1,
    maxZoomLevel: 10,
    imageClickAction: 'close',
    loop: false,
};
let lightbox = null;

initPhotoswipe();
startMutationObserver();

function initPhotoswipe() {
    lightbox = new PhotoSwipeLightbox(photoSwipeOptions);

    lightbox.on('uiRegister', function () {
        lightbox.pswp.ui.registerElement({
            name: 'download-button',
            order: 8,
            isButton: true,
            tagName: 'button',

            // ダウンロードボタンのカスタマイズ
            html: {
                isCustomSVG: true,
                inner: '<path d="M20.5 14.3 17.1 18V10h-2.2v7.9l-3.4-3.6L10 16l6 6.1 6-6.1ZM23 23H9v2h14Z" id="pswp__icn-download"/>',
                outlineID: 'pswp__icn-download',
            },
            onInit: (el, pswp) => {
                el.setAttribute('title', 'Download');
                el.setAttribute('aria-label', 'Download');
                el.addEventListener('click', photoSwipeDownloadHandleClick.bind(null, pswp));
            }
        });
    });
    lightbox.init();
}

function startMutationObserver() {

    // Xのルート要素
    const reactRoot = document.getElementById(xRootID);
    if (!reactRoot) return;

    const observer = new MutationObserver(function (mutations) {
        mutations.forEach(function (mutation) {
            mutation.addedNodes.forEach(function (node) {
                if (isTargetImage(node)) {
                    changeCursor(node);
                }
            });
        });
    });

    // MutationObserverを設定
    const config = { childList: true, subtree: true };
    observer.observe(reactRoot, config);
}

function changeCursor(node) {
    function onMouseEnter() {
        node.style.cursor = 'zoom-in';
    }
    function onMouseLeave() {
        node.style.cursor = 'auto';
    }
    node.addEventListener('mouseenter', onMouseEnter);
    node.addEventListener('mouseleave', onMouseLeave);
}

// プレビュー画像をクリックしたらPhotoSwipeを開く
document.addEventListener('click', function (event) {

    const clickedElement = event.target;

    if (isTargetImage(clickedElement)) {
        openPhotoSwipe(clickedElement);
    }
}, true);

function openPhotoSwipe(clickedElement) {

    let dataSources = [];

    dataSources.push({
        src: clickedElement.src,
        width: clickedElement.naturalWidth,
        height: clickedElement.naturalHeight
    });

    lightbox.loadAndOpen(0, dataSources);
}

async function photoSwipeDownloadHandleClick(pswp, event) {
    event.preventDefault();

    try {
        const url = new URL(pswp.currSlide.data.src);

        // 画像形式を取得
        const searchParams = new URLSearchParams(url.search);
        const format = searchParams.get('format');

        const imageUrl = generateOriginalImageUrl(url, format);
        const imageBlob = await fetchImageBlob(imageUrl);

        if (imageBlob) {
            downloadImage(imageBlob, format);
        } else {
            throw new Error('Failed to fetch image. Check the URL or try again later.');
        }
    } catch (error) {
        console.error('Error handling click event:', error.message);
    }
}

function generateOriginalImageUrl(url, format) {
    url.search = '';
    url.href += `?format=${format}&name=orig`;
    return url.toString();
}

async function fetchImageBlob(imageUrl) {
    try {
        const imageResponse = await fetch(imageUrl);
        if (!imageResponse.ok) {
            throw new Error(`Failed to fetch image. HTTP status: ${imageResponse.status}`);
        }

        return await imageResponse.blob();
    } catch (error) {
        console.error(`Error fetching image: ${error.message}`);
    }
}

function downloadImage(imageBlob, format) {

    const url = window.location.href;

    const regex_user = /\/([^\/]+)\/status\//; // ユーザーID
    const match_user = url.match(regex_user);
    const user_id = match_user ? match_user[1] : '';

    const regex_post = /\/(\d{5,})\//; // 投稿ID
    const match_post = url.match(regex_post);
    const post_id = match_post ? match_post[1] : '';

    const regex_order = /photo\/(\d+)/; // 画像番号
    const match_order = url.match(regex_order);
    const order = match_order ? match_order[1] : '';

    const link = document.createElement('a');
    link.download = `${user_id}_${post_id}_${order}.${format}`;
    link.href = window.URL.createObjectURL(imageBlob);

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(link.href);
}

function isTargetImage(node) {

    // imgタグ
    if (!(node.nodeType === 1 && node.tagName.toLowerCase() === 'img')) return false;
    
    // 投稿画像
    if (!(node.src.includes("pbs.twimg.com/media/"))) return false;

    // 親要素にlayersIDを含む
    if (!(hasParentWithId(node))) return false;

    // 親要素にa要素を含まない
    if (hasParentAnchorElement(node)) return false;

    return true;
}

function hasParentWithId(element) {

    while (element) {
        if (element.id === layersID) {
            return true;
        }
        element = element.parentElement;
    }

    return false;
}

function hasParentAnchorElement(element) {

    while (element) {
        if (element.tagName.toLowerCase() === 'a') {
            return true;
        }
        element = element.parentElement;
    }

    return false;
}