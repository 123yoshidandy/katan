/**
 * プレイヤーごとに見える状態（ビュー）
 * サーバーとブラウザのどちらでも使う。JSONにできる値だけで作る
 * 他人の手札と発展カードは枚数だけ、発展カードの山は枚数だけを伝える（勝利点カードも本人にしか見えない）
 */

import { countCards, WIN_POINTS } from './game.js';
import { suggest } from './cpu-player.js';

const VIEW_LOGS = 60; // ビューに入れる最近のログの数

// viewerId のプレイヤーから見たゲームの状態（観戦や全員CPUのときは viewerId = null）
export function createGameView(game, viewerId) {
    const isViewer = (id) => id === viewerId;
    const view = {
        viewerId,
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
        logs: game.logs.slice(-VIEW_LOGS).map(entry => (entry.secret?.seats.includes(viewerId) ? entry.secret.text : entry.text)),
        result: game.result ? { ...game.result, points: [...game.result.points] } : null
    };
    if (viewerId !== null && viewerId !== undefined && game.phase !== 'end') {
        // 自分が今できること（画面のボタンと候補の表示に使う）
        view.options = {
            roadSpots: game.roadSpots(viewerId),
            settlementSpots: game.settlementSpots(viewerId),
            citySpots: game.citySpots(viewerId),
            playableDevCards: game.playableDevCards(viewerId),
            tradeRatios: Object.fromEntries(Object.keys(game.bank).map(r => [r, game.tradeRatio(viewerId, r)])),
            // アシスト：おすすめの手と次の目標（操作する番でなければ null）
            suggestion: suggest(game, viewerId)
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
    return {
        ...view,
        me,
        current,
        isMyTurn: Boolean(me) && me === current && playing,
        discardCount,
        tradeWaiting
    };
}
