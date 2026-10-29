/**
 * CPU の戦略
 * runCpuStep(game) で、操作が必要な CPU（部屋を出た人の代わりも含む）を1手だけ進める
 *
 * - 初期配置: 周りのタイルの出やすさ（点の数）と資源の種類が多い頂点に置き、道はその先の良い頂点へ向ける
 * - 手番: 騎士で自分のタイルの盗賊を追い払う → サイコロ → 都市 → 開拓地 → 道 → 発展カード の順に建てる
 *   足りない資源が少しなら、余っている資源を銀行と交換して建てる
 * - 盗賊: 一番点の高い相手の、よく出るタイルに置く
 * - 交渉: 欲しい資源がもらえ、相手が勝ちに近くなければ受ける
 */

import {
    RESOURCES, COSTS, countCards, hasCards, emptyCards, WIN_POINTS
} from './game.js';
import { GEOMETRY, pips, otherEnd } from './board.js';

const isControlledByCpu = (player) => player.isCPU || player.proxy;

// 操作が必要な CPU の席（いなければ null）
export function cpuActor(game) {
    // リアルタイムモードでは、CPU が交互に動くよう、記録の長さで順番をずらす
    const actors = game.actors();
    const shift = game.isRealtimePlay() && actors.length ? game.commands.length % actors.length : 0;
    const actor = [...actors.slice(shift), ...actors.slice(0, shift)].find(id => {
        const player = game.players[id];
        // 交渉中の手番の人は、相手の返事を待つ（自分から交渉する CPU はいない）
        if (game.trade && id === game.trade.from) return false;
        return isControlledByCpu(player);
    });
    return actor ?? null;
}

export const isCpuTurn = (game) => game.phase !== 'end' && cpuActor(game) !== null;

// CPU を1手進める。進めたら true
export function runCpuStep(game) {
    const seat = cpuActor(game);
    if (seat === null) return false;
    const command = chooseCommand(game, seat);
    if (game.applyCommand(seat, command)) return true;
    // 考えた手が通らなかったら、手番を進めて止まらないようにする
    if ((game.isRealtimePlay() || seat === game.currentPlayerIndex) && game.applyCommand(seat, { type: 'endTurn' })) return true;
    throw new Error(`CPU の手を決められませんでした: ${JSON.stringify(command)} ${game.lastError}`);
}

export function chooseCommand(game, seat) {
    const pending = game.pendingOf(seat);
    if (pending?.type === 'discard') {
        return { type: 'discard', cards: chooseDiscard(game, seat, pending.remaining[seat]) };
    }
    if (game.trade && seat !== game.trade.from && !game.trade.responses[seat]) {
        return { type: 'respondTrade', id: game.trade.id, accept: wantsTrade(game, seat) };
    }
    if (game.phase === 'setup') return chooseSetup(game, seat);
    if (pending?.type === 'robber') return chooseRobber(game, seat);
    if (pending?.type === 'roadBuilding') return { type: 'build', piece: 'road', at: chooseRoad(game, seat) };
    return chooseTurn(game, seat);
}

// 人間へのアシスト：seat の人が今操作するなら、CPU ならどうするか（command）と、次に建てたいもの（goal）
// CPU の判断はみんなに見えている情報だけを使うので、ビューに入れても他人の手札はわからない
export function suggest(game, seat) {
    if (game.phase === 'end' || !game.actors().includes(seat)) return null;
    // 交渉を持ちかけている間は、返事を見て相手を選ぶ（おすすめはしない）
    if (game.trade && seat === game.trade.from) return null;
    const command = chooseCommand(game, seat);
    const acting = game.isRealtimePlay() ? !game.done[seat] && !game.pendingOf(seat) : !game.pending && !game.trade && seat === game.currentPlayerIndex;
    const goal = game.phase === 'play' && acting ? buildGoal(game, seat) : null;
    return { command, goal };
}

// 次に建てたいもの { piece, at, missing }（missing は足りない資源）。自分の番でなくても決める（作戦の表示に使う）
export function buildGoal(game, seat) {
    if (game.phase !== 'play') return null;
    const target = buildTarget(game, seat);
    if (!target) return null;
    const hand = game.players[seat].hand;
    const missing = Object.fromEntries(RESOURCES.map(r => [r, Math.max(0, (COSTS[target.piece][r] ?? 0) - hand[r])]));
    return { piece: target.piece, at: target.at, missing };
}

// ===== 評価 =====

// 頂点の価値（周りのタイルの点の数と、資源の種類・港）
function vertexValue(game, vertex, player) {
    const hexes = GEOMETRY.vertices[vertex].hexes.map(id => ({ ...game.board.hexes[id], id }));
    const kinds = new Set();
    let value = 0;
    hexes.forEach(hex => {
        if (!RESOURCES.includes(hex.terrain)) return;
        let p = pips(hex.number);
        if (hex.id === game.robber) p *= 0.5;
        // 持っていない資源は少し高く見る
        if (player && !ownsResource(game, player.id, hex.terrain)) p *= 1.2;
        value += p;
        kinds.add(hex.terrain);
    });
    value += kinds.size * 0.8;
    if (game.harbors[vertex]) value += 1;
    return value;
}

function ownsResource(game, playerId, resource) {
    return game.buildings.some((b, v) => b?.owner === playerId
        && GEOMETRY.vertices[v].hexes.some(id => game.board.hexes[id].terrain === resource));
}

const best = (items, score) => items.reduce((top, item) => {
    const s = score(item);
    return top === null || s > top.score ? { item, score: s } : top;
}, null)?.item;

// ===== 初期配置 =====

function chooseSetup(game, seat) {
    const player = game.players[seat];
    if (game.setupStep === 'settlement') {
        return { type: 'build', piece: 'settlement', at: best(game.settlementSpots(seat), v => vertexValue(game, v, player)) };
    }
    // 道は、その先に開拓地を置ける良い頂点がある向きへ
    const edges = game.roadSpots(seat);
    const at = best(edges, e => {
        const end = otherEnd(e, game.lastSettlement);
        const nexts = GEOMETRY.vertices[end].neighbors.filter(v => v !== game.lastSettlement && game.canPlaceSettlementAt(v));
        return Math.max(0, ...nexts.map(v => vertexValue(game, v, player)));
    });
    return { type: 'build', piece: 'road', at };
}

// ===== 盗賊 =====

function chooseRobber(game, seat) {
    const leaderPoints = (owner) => game.points(owner, { hidden: false }) + 1;
    const hexes = GEOMETRY.hexes.map(h => h.id).filter(id => id !== game.robber);
    const hex = best(hexes, id => {
        let score = 0;
        GEOMETRY.hexes[id].vertices.forEach(v => {
            const b = game.buildings[v];
            if (!b) return;
            const weight = b.type === 'city' ? 2 : 1;
            score += b.owner === seat ? -10 * weight : weight * leaderPoints(b.owner);
        });
        return score * (1 + pips(game.board.hexes[id].number)) + (game.robberVictims(seat, id).length > 0 ? 1 : 0);
    });
    const victims = game.robberVictims(seat, hex);
    const victim = victims.length ? best(victims, o => game.points(o, { hidden: false }) * 10 + countCards(game.players[o].hand)) : null;
    return { type: 'moveRobber', hex, victim };
}

// ===== 手番 =====

function chooseTurn(game, seat) {
    const player = game.players[seat];
    const playable = game.playableDevCards(seat);

    // 自分のタイルに盗賊がいれば、サイコロの前でも騎士で追い払う
    if (playable.includes('knight') && robberHurts(game, seat)) return { type: 'playDev', card: 'knight' };
    if (!game.rolled) return { type: 'roll' };

    const target = buildTarget(game, seat);
    if (target) {
        if (hasCards(player.hand, COSTS[target.piece])) return { type: 'build', piece: target.piece, at: target.at };
        const trade = planBankTrade(game, seat, COSTS[target.piece]);
        if (trade) return { type: 'bankTrade', ...trade };
    }
    if (playable.includes('yearOfPlenty')) {
        const cost = target ? COSTS[target.piece] : COSTS.city;
        return { type: 'playDev', card: 'yearOfPlenty', resources: yearOfPlentyPick(game, player, cost) };
    }
    if (playable.includes('monopoly')) return { type: 'playDev', card: 'monopoly', resource: neededMost(player, target ? COSTS[target.piece] : COSTS.city) };
    if (playable.includes('roadBuilding') && player.pieces.road > 0 && game.settlementSpots(seat).length === 0 && game.roadSpots(seat).length > 0) {
        return { type: 'playDev', card: 'roadBuilding' };
    }
    if (playable.includes('knight') && (game.points(seat) >= WIN_POINTS - 2 || player.knights + 1 >= 3)) {
        return { type: 'playDev', card: 'knight' };
    }
    if (game.devDeck.length > 0 && hasCards(player.hand, COSTS.devCard)) {
        // 開拓地や都市のための資源は残しておく
        const keepFor = target && target.piece !== 'road' ? COSTS[target.piece] : null;
        if (!keepFor || !RESOURCES.some(r => (COSTS.devCard[r] ?? 0) > 0 && player.hand[r] - (COSTS.devCard[r] ?? 0) < (keepFor[r] ?? 0))) {
            return { type: 'buyDevCard' };
        }
    }
    return { type: 'endTurn' };
}

function robberHurts(game, seat) {
    return GEOMETRY.hexes[game.robber].vertices.some(v => game.buildings[v]?.owner === seat) && game.board.hexes[game.robber].number !== null;
}

const EARLY_POINTS = 6; // これより少ないうちは、都市より開拓地・道で広げるのを優先する

// 次に建てたいもの { piece, at }
// 都市と「広げる手」（開拓地。置ける場所がなければ、開拓地を置ける場所へ向かう道）のうち、足りない資源が少ないほう
// 序盤は広げる手を優先し、足りない資源が都市より1枚多いくらいまでなら広げる
function buildTarget(game, seat) {
    const player = game.players[seat];
    let city = null;
    if (player.pieces.city > 0) {
        const cities = game.citySpots(seat);
        if (cities.length) city = { piece: 'city', at: best(cities, v => vertexValue(game, v, null)) };
    }
    let expand = null;
    if (player.pieces.settlement > 0) {
        const spots = game.settlementSpots(seat);
        if (spots.length) {
            expand = { piece: 'settlement', at: best(spots, v => vertexValue(game, v, player)) };
        } else if (player.pieces.road > 0) {
            const at = chooseRoad(game, seat, { towardSpot: true });
            if (at !== null && at !== undefined) expand = { piece: 'road', at };
        }
    }
    if (city && expand) {
        const lack = (target) => RESOURCES.reduce((n, r) => n + Math.max(0, (COSTS[target.piece][r] ?? 0) - player.hand[r]), 0);
        const allowance = game.points(seat) < EARLY_POINTS ? 1 : -1;
        return lack(expand) <= lack(city) + allowance ? expand : city;
    }
    if (city || expand) return city ?? expand;
    // 広げる先がなければ、道を長くする
    if (player.pieces.road > 0 && game.roadSpots(seat).length > 0) {
        const at = chooseRoad(game, seat);
        if (at !== null && at !== undefined) return { piece: 'road', at };
    }
    return null;
}

// 道を置く辺。開拓地を置ける良い頂点へ近づく辺を選ぶ（なければ、道を長くする辺）
// towardSpot：開拓地を置ける頂点へ近づく辺がなければ null
function chooseRoad(game, seat, { towardSpot = false } = {}) {
    const player = game.players[seat];
    const edges = game.roadSpots(seat);
    if (edges.length === 0) return null;
    const scoreEdge = (e) => {
        const { a, b } = GEOMETRY.edges[e];
        let score = 0;
        [a, b].forEach(start => {
            // start から2辺先までの、開拓地を置ける頂点
            const seen = new Map([[start, 0]]);
            let frontier = [start];
            for (let depth = 1; depth <= 2; depth++) {
                const next = [];
                frontier.forEach(v => GEOMETRY.vertices[v].neighbors.forEach(n => {
                    if (seen.has(n) || (game.buildings[n] && game.buildings[n].owner !== seat)) return;
                    seen.set(n, depth);
                    next.push(n);
                }));
                frontier = next;
            }
            seen.forEach((depth, v) => {
                if (game.canPlaceSettlementAt(v)) score = Math.max(score, vertexValue(game, v, player) - depth * 1.5);
            });
        });
        return score;
    };
    const edge = best(edges, scoreEdge);
    if (towardSpot && !(scoreEdge(edge) > 0)) return null;
    return edge;
}

// cost を払うために、余っている資源を銀行と交換する手（足りない分を全部まかなえるときだけ）
function planBankTrade(game, seat, cost) {
    const hand = game.players[seat].hand;
    const missing = RESOURCES.filter(r => hand[r] < (cost[r] ?? 0));
    const missingCount = missing.reduce((sum, r) => sum + (cost[r] - hand[r]), 0);
    let tradesAvailable = 0;
    let giveResource = null;
    RESOURCES.forEach(r => {
        const spare = hand[r] - (cost[r] ?? 0);
        const ratio = game.tradeRatio(seat, r);
        const n = spare > 0 ? Math.floor(spare / ratio) : 0;
        if (n > 0 && (giveResource === null || spare - ratio > hand[giveResource] - (cost[giveResource] ?? 0) - game.tradeRatio(seat, giveResource))) {
            giveResource = r;
        }
        tradesAvailable += n;
    });
    if (missingCount === 0 || tradesAvailable < missingCount || giveResource === null) return null;
    const get = missing.find(r => game.bank[r] > 0);
    return get ? { give: giveResource, get } : null;
}

function neededMost(player, cost) {
    return best(RESOURCES, r => (cost[r] ?? 0) - player.hand[r] + (r === 'ore' || r === 'wheat' ? 0.1 : 0));
}

function yearOfPlentyPick(game, player, cost) {
    const hand = { ...player.hand };
    const picks = [];
    for (let i = 0; i < 2; i++) {
        const r = best(RESOURCES.filter(x => game.bank[x] - picks.filter(p => p === x).length > 0), x => (cost[x] ?? 0) - hand[x]);
        picks.push(r);
        hand[r]++;
    }
    return picks;
}

// ===== 捨て札・交渉 =====

function chooseDiscard(game, seat, count) {
    const hand = { ...game.players[seat].hand };
    const cards = emptyCards();
    // 一番多く持っている資源から捨てる（都市に使う小麦・鉄は少し残す）
    for (let i = 0; i < count; i++) {
        const r = best(RESOURCES.filter(x => hand[x] > 0), x => hand[x] - (x === 'ore' || x === 'wheat' ? 0.5 : 0));
        hand[r]--;
        cards[r]++;
    }
    return cards;
}

// 資源ひとつの価値（次に建てたいものに足りない資源は高く、たくさん余っている資源は低く）
function resourceValue(game, seat, resource, hand) {
    const target = buildTarget(game, seat);
    const cost = target ? COSTS[target.piece] : COSTS.city;
    if (hand[resource] < (cost[resource] ?? 0)) return 2;
    if (hand[resource] - (cost[resource] ?? 0) >= 2) return 0.6;
    return 1;
}

function wantsTrade(game, seat) {
    const { from, give, get } = game.trade;
    const hand = game.players[seat].hand;
    if (!hasCards(hand, get)) return false;
    if (game.points(from, { hidden: false }) >= WIN_POINTS - 2) return false;
    const receive = RESOURCES.reduce((sum, r) => sum + give[r] * resourceValue(game, seat, r, hand), 0);
    const pay = RESOURCES.reduce((sum, r) => sum + get[r] * resourceValue(game, seat, r, hand), 0);
    return receive > pay;
}
