/**
 * KATAN の起動
 */

import UI from './ui.js';

// 画面を拡大させない（ふつうは style.css の touch-action で止まる。古い iOS は2本指の操作を止める）
// touchmove は止めない（passive でない touchmove があると、スクロールの始まりが遅れるため）
document.addEventListener('gesturestart', event => event.preventDefault());

document.addEventListener('DOMContentLoaded', async () => {
    const ui = new UI();

    // 招待のURL（?room=部屋番号）で開いたら、オンライン対戦の参加画面を出す
    const roomCode = new URLSearchParams(location.search).get('room');
    if (roomCode) {
        ui.showOnlineMenu({ roomCode });
        return;
    }
    // 前回入っていた部屋があれば戻る。なければ開始画面
    ui.showSetup();
    await ui.resumeOnline();
});

// ホーム画面に置いて、オフラインでも開けるようにする（PWA）
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then(() => navigator.serviceWorker.ready).then(registration => {
        const urls = [location.href, ...performance.getEntriesByType('resource').map(entry => entry.name)];
        registration.active?.postMessage({ type: 'cache-urls', urls });
    }).catch(() => {});
}
