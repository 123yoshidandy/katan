/**
 * プレイヤーごとに見える状態（ビュー）
 * サーバーとブラウザのどちらでも使う。JSONにできる値だけで作る
 * 他人の手札と発展カードは枚数だけ、発展カードの山は枚数だけを伝える（勝利点カードも本人にしか見えない）
 */

import { countCards, WIN_POINTS } from './game.js';
import { suggest, buildGoal } from './cpu-player.js';

const VIEW_LOGS = 60; // ビューに入れる最近のログの数
const VIEW_EVENTS = 20; // ビューに入れる最近のイベントの数（演出に使う）

// viewerId から見てよい形のイベント（ログの secret と同じ考え方で、中身を伏せる）
// 奪ったカードは奪った人と奪われた人だけ、捨てたカードは本人だけ（ほかの人には枚数だけ）、買った発展カードは本人だけが見える
export function publicEvent(event, viewerId) {
    const copy = JSON.parse(JSON.stringify(event));
    if (event.type === 'steal' && viewerId !== event.from && viewerId !== event.to) copy.resource = null;
    if (event.type === 'discard') {
        copy.count = countCards(event.cards);
        if (viewerId !== event.player) copy.cards = null;
    }
    if (event.type === 'buyDev' && viewerId !== event.player) copy.card = null;
    return copy;
}

// viewerId のプレイヤーから見たゲームの状態（観戦や全員CPUのときは viewerId = null）
export function createGameView(game, viewerId) {
    const isViewer = (id) => id === viewerId;
    const view = {
        viewerId,
        mode: game.mode,
        phase: game.phase,
        currentPlayerId: game.currentPlayerIndex,
        turnNumber: game.turnNumber,
        board: game.board,
        robber: game.robber,
        buildings: game.buildings.map(b => (b ? { ...b } : null)),
        roads: [...game.roads],
        bank: { ...game.bank },
        devDeckCount: game.devDeck.length,
        setup: game.phase === 'setup' ? { step: game.setupStep, lastSettlement: game.lastSettlement, round: game.setupIndex < game.players.length ? 1 : 2 } : null,
        rolled: game.rolled,
        dice: game.dice ? [...game.dice] : null,
        devPlayed: game.devPlayed,
        pending: game.pending ? JSON.parse(JSON.stringify(game.pending)) : null,
        // リアルタイムモード：全員の出た目と、完了したか
        rolls: game.rolls.map(r => (r ? [...r] : null)),
        done: [...game.done],
        trade: game.trade ? JSON.parse(JSON.stringify(game.trade)) : null,
        longestRoad: game.longestRoad,
        largestArmy: game.largestArmy,
        winPoints: WIN_POINTS,
        players: game.players.map(player => {
            const mine = isViewer(player.id) || game.phase === 'end';
            return {
                id: player.id,
                name: player.name,
                isCPU: player.isCPU,
                proxy: player.proxy,
                cardCount: countCards(player.hand),
                hand: mine ? { ...player.hand } : null,
                devCardCount: player.devCards.length,
                devCards: mine ? player.devCards.map(c => ({ ...c })) : null,
                knights: player.knights,
                pieces: { ...player.pieces },
                roadLength: game.roadLengths[player.id],
                points: game.points(player.id, { hidden: mine }),
                publicPoints: game.points(player.id, { hidden: false })
            };
        }),
        // 最後のイベントの番号（演出は、前のビューより新しいイベントだけを見せる）
        eventId: game.eventSerial,
        events: game.events.slice(-VIEW_EVENTS).map(event => publicEvent(event, viewerId)),
        logs: game.logs.slice(-VIEW_LOGS).map(entry => (entry.secret?.seats.includes(viewerId) ? entry.secret.text : entry.text)),
        result: game.result ? { ...game.result, points: [...game.result.points] } : null
    };
    if (game.isRealtimePlay()) {
        // 先に片付ける処理は、見ている人のもの。サイコロは見ている人の目
        const mine = viewerId !== null && viewerId !== undefined;
        view.pending = mine ? JSON.parse(JSON.stringify(game.pendingOf(viewerId))) : null;
        view.dice = mine && game.rolls[viewerId] ? [...game.rolls[viewerId]] : null;
    }
    if (viewerId !== null && viewerId !== undefined && game.phase !== 'end') {
        // 自分が今できること（画面のボタンと候補の表示に使う）
        view.options = {
            roadSpots: game.roadSpots(viewerId),
            settlementSpots: game.settlementSpots(viewerId),
            citySpots: game.citySpots(viewerId),
            playableDevCards: game.playableDevCards(viewerId),
            tradeRatios: Object.fromEntries(Object.keys(game.bank).map(r => [r, game.tradeRatio(viewerId, r)])),
            // アシスト：おすすめの手と次の目標（操作する番でなければ null）
            suggestion: suggest(game, viewerId),
            // 作戦：次に建てたいもの（自分の番でなくても出す）
            goal: buildGoal(game, viewerId)
        };
    }
    return view;
}

// 画面で使いやすいよう、自分・手番の人・自分の番かどうか・自分が操作すべきことを足す
export function hydrateGameView(view) {
    const me = view.players.find(player => player.id === view.viewerId) ?? null;
    const current = view.players.find(player => player.id === view.currentPlayerId);
    const playing = view.phase !== 'end';
    const discardCount = me && view.pending?.type === 'discard' ? (view.pending.remaining[me.id] ?? 0) : 0;
    const tradeWaiting = Boolean(me && view.trade && view.trade.from !== me.id && !view.trade.responses[me.id]);
    // リアルタイムモードの初期配置のあとは、完了するまでが自分の番
    const realtime = view.mode === 'realtime' && view.phase === 'play';
    return {
        ...view,
        me,
        current,
        realtime,
        isMyTurn: realtime ? Boolean(me) && !view.done[me.id] : Boolean(me) && me === current && playing,
        discardCount,
        tradeWaiting
    };
}
