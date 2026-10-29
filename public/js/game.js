/**
 * カタン（Katan）のゲームの進行
 * DOMに依存しないので、ブラウザ（ローカル対戦）とサーバー（オンライン対戦）の両方で使う
 * 受け付けた操作を commands に記録し、Game.replay で同じゲームを再現できる（サイコロも記録のシードから決まる）
 *
 * ルール（基本セット）
 * - 初期配置: 開拓地と道を1つずつ、蛇行順（1→N→N→1）に2回置く。2つ目の開拓地の周りの資源をもらう
 * - 手番: サイコロを振る → 交換・建設・発展カード → 手番を終える
 *   - 出た目のタイルに接する開拓地は1枚、都市は2枚の資源をもらう（盗賊のいるタイルは出ない）
 *   - 7 が出たら、手札が8枚以上の人は半分（切り捨て）を捨て、手番の人が盗賊を動かして隣の人から1枚奪う
 * - 建設: 道（木材・レンガ）／開拓地（木材・レンガ・羊毛・小麦）／都市（小麦2・鉄3）／発展カード（羊毛・小麦・鉄）
 *   - 開拓地は他の建物の隣（1辺先）に置けない。自分の道につながる場所に置く
 * - 発展カード: 1手番に1枚まで。買った手番には使えない。騎士・街道建設・収穫・独占・勝利点
 * - 交換: 銀行と 4:1（港があれば 3:1 か 2:1）、手番の人は他の人と自由に交渉できる
 * - 最長交易路（5本以上つながった道）と最大騎士力（騎士3枚以上）はそれぞれ2点
 * - 自分の手番に10点に達したら勝ち
 *
 * リアルタイムモード（mode: 'realtime'）：待ち時間を減らすため、初期配置のあとは全員が同時に動く
 * - 巡のはじめに、全員が同時にサイコロを振る（自動）。どの人の目でも、全員が資源をもらう
 *   - 7 を出した人がいれば、その巡の生産の前に、手札が8枚以上の人は半分を捨てる（何人が7を出しても1回）
 *   - 7 を出した人は、それぞれ盗賊を動かして1枚奪う
 * - 各自が好きな順に、建設・交換・発展カード（1巡に1枚）を行い、「完了」する。同じ場所は早い者勝ち
 * - 交渉は誰でも持ちかけられる（同時に進む交渉は1つまで）
 * - 全員が完了したら、次の巡に進む。10点に達したら、その場で勝ち
 */

import { createRandom, createSeed, shuffle } from './random.js';
import {
    RESOURCES, RESOURCE_NAMES, GEOMETRY, VERTEX_COUNT, EDGE_COUNT, HEX_COUNT,
    generateBoard, harborAtVertices, otherEnd
} from './board.js';

export { RESOURCES, RESOURCE_NAMES };

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;
export const WIN_POINTS = 10;
export const BANK_SIZE = 19;              // 銀行の資源は各19枚
export const HAND_LIMIT = 7;              // 7 が出たとき、これより多く持っていたら半分捨てる
export const LONGEST_ROAD_MIN = 5;
export const LARGEST_ARMY_MIN = 3;
export const PIECES = { road: 15, settlement: 5, city: 4 };
export const COSTS = {
    road: { wood: 1, brick: 1 },
    settlement: { wood: 1, brick: 1, sheep: 1, wheat: 1 },
    city: { wheat: 2, ore: 3 },
    devCard: { sheep: 1, wheat: 1, ore: 1 }
};
export const DEV_CARDS = { knight: 14, victoryPoint: 5, roadBuilding: 2, yearOfPlenty: 2, monopoly: 2 };
export const DEV_NAMES = { knight: '騎士', victoryPoint: '勝利点', roadBuilding: '街道建設', yearOfPlenty: '収穫', monopoly: '独占' };
export const PIECE_NAMES = { road: '道', settlement: '開拓地', city: '都市' };
const MAX_LOGS = 200;
const MAX_EVENTS = 40; // 演出のために持つ、最近のイベントの数
export const MODES = ['classic', 'realtime']; // 通常 / リアルタイム

export const emptyCards = () => Object.fromEntries(RESOURCES.map(r => [r, 0]));
export const countCards = (cards) => RESOURCES.reduce((sum, r) => sum + (cards[r] ?? 0), 0);
export const hasCards = (hand, cards) => RESOURCES.every(r => hand[r] >= (cards[r] ?? 0));
const addCards = (hand, cards, sign = 1) => RESOURCES.forEach(r => { hand[r] += sign * (cards[r] ?? 0); });
export const formatCards = (cards) => RESOURCES.filter(r => cards[r] > 0).map(r => `${RESOURCE_NAMES[r]}${cards[r]}`).join('・');

const isInt = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;

// 端末から届いた資源の組（{ wood: 1, ... }）を検証して、5種そろった形にする。おかしければ null
export function parseCards(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    if (Object.keys(value).some(key => !RESOURCES.includes(key))) return null;
    const cards = emptyCards();
    for (const r of RESOURCES) {
        const n = value[r] ?? 0;
        if (!isInt(n, 0, BANK_SIZE * 2)) return null;
        cards[r] = n;
    }
    return cards;
}

export default class Game {
    // players: [{ name, isCPU }]
    constructor(players, { seed = createSeed(), mode = 'classic' } = {}) {
        if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
            throw new Error(`${MIN_PLAYERS}〜${MAX_PLAYERS}人で遊んでください`);
        }
        this.seed = seed;
        this.mode = MODES.includes(mode) ? mode : 'classic';
        this.random = createRandom(seed);
        // proxy: 部屋を出た人の代わりに CPU が打っている
        this.players = players.map(({ name, isCPU }, id) => ({
            id, name, isCPU: Boolean(isCPU), proxy: false,
            hand: emptyCards(),
            devCards: [],      // [{ type, turn }]（turn: 買った手番。その手番には使えない）
            knights: 0,        // 使った騎士の数
            pieces: { ...PIECES }
        }));
        this.board = generateBoard(this.random);
        this.harbors = harborAtVertices(this.board);
        this.robber = this.board.hexes.findIndex(hex => hex.terrain === 'desert');
        this.buildings = Array(VERTEX_COUNT).fill(null); // { owner, type: 'settlement' | 'city' }
        this.roads = Array(EDGE_COUNT).fill(null);       // 持ち主の id
        this.bank = Object.fromEntries(RESOURCES.map(r => [r, BANK_SIZE]));
        this.devDeck = shuffle(Object.entries(DEV_CARDS).flatMap(([type, n]) => Array(n).fill(type)), this.random);

        const first = Math.floor(this.random() * players.length);
        const order = this.players.map((_, i) => (first + i) % players.length);
        this.setupOrder = [...order, ...[...order].reverse()]; // 蛇行順
        this.setupIndex = 0;
        this.setupStep = 'settlement'; // settlement / road
        this.lastSettlement = null;    // 初期配置で、道を伸ばす開拓地

        this.phase = 'setup';          // setup / play / end
        this.currentPlayerIndex = first;
        this.turnNumber = 0;
        this.rolled = false;
        this.dice = null;              // [d1, d2]
        this.devPlayed = false;        // この手番に発展カードを使ったか
        // 手番の途中で、ほかのことより先に片付ける処理
        // { type: 'discard', remaining: { 席: 枚数 } } / { type: 'robber' } / { type: 'roadBuilding', remaining }
        this.pending = null;
        this.trade = null;             // 交渉 { id, from, give, get, responses: { 席: 'reject' } }（受けた人が出たら、その場で交換して終わる）
        this.tradeSerial = 0;          // 交渉の通し番号（取り下げたあとに届いた、古い交渉への返事を断るため）
        this.longestRoad = null;       // 最長交易路の持ち主
        this.largestArmy = null;       // 最大騎士力の持ち主
        this.roadLengths = this.players.map(() => 0);

        // リアルタイムモードの、人ごとの状態（巡ごとに作り直す）
        this.done = this.players.map(() => false);       // この巡を完了したか
        this.rolls = this.players.map(() => null);       // この巡に振った目 [d1, d2]
        this.queues = this.players.map(() => []);        // 先に片付ける処理 { type: 'discard', count } / { type: 'robber' } / { type: 'roadBuilding', remaining }
        this.devPlayedBy = this.players.map(() => false); // この巡に発展カードを使ったか

        this.commands = [];
        this.logs = [];                // { text, secret?: { seats, text } }
        // 起きたこと（画面の演出に使う）。{ id, type, ... }。受け付けた操作でだけ増える
        this.events = [];
        this.eventSerial = 0;
        this.result = null;            // { winnerId, points }
        this.lastError = null;
        this.log(`ゲーム開始。最初は${this.getCurrentPlayer().name}が開拓地を置きます`);
    }

    getCurrentPlayer() {
        return this.players[this.currentPlayerIndex];
    }

    // ===== 操作 =====

    // playerId のプレイヤーの操作を受け付ける。受け付けたら true、できなければ lastError に理由を入れて false
    applyCommand(playerId, command) {
        this.lastError = null;
        if (this.phase === 'end') return this.reject('ゲームは終わっています');
        const player = this.players[playerId];
        if (!player) return this.reject('参加していません');
        const type = command?.type;

        // 手番に関係なく受け付ける操作
        if (type === 'proxy') {
            if (player.proxy) return this.reject('代わりに打てる人ではありません');
            player.proxy = true;
            this.commands.push({ playerId, type: 'proxy' });
            this.log(`${player.name}が抜けたので、CPU が代わりに打ちます`);
            return true;
        }
        if (type === 'discard') return this.record(playerId, { type, cards: command.cards }, () => this.discard(player, command.cards));
        if (type === 'respondTrade') {
            const recorded = { type, id: command.id, accept: Boolean(command.accept) };
            return this.record(playerId, recorded, () => this.respondTrade(player, recorded.id, recorded.accept));
        }

        // リアルタイムモードの初期配置のあとは、全員が同時に動く（同じ場所は先に届いた操作が通る）
        if (this.isRealtimePlay()) {
            const accepted = this.applyTurnCommand(player, command);
            if (accepted) this.checkWinAll(player);
            return accepted;
        }

        if (playerId !== this.currentPlayerIndex) return this.reject('あなたの番ではありません');
        if (this.pending?.type === 'discard') return this.reject('手札を捨てる人を待っています');

        // 交渉中に手番の人がほかの操作をしたら、交渉は取り下げる
        const keepsTrade = ['cancelTrade', 'offerTrade'].includes(type);
        const accepted = this.applyTurnCommand(player, command);
        if (accepted && !keepsTrade && this.trade) this.trade = null;
        if (accepted) this.checkWin(player);
        return accepted;
    }

    applyTurnCommand(player, command) {
        const { type } = command ?? {};
        switch (type) {
            case 'build':
                return this.record(player.id, { type, piece: command.piece, at: command.at }, () => this.build(player, command.piece, command.at));
            case 'roll':
                return this.record(player.id, { type }, () => this.roll(player));
            case 'moveRobber':
                return this.record(player.id, { type, hex: command.hex, victim: command.victim ?? null },
                    () => this.moveRobber(player, command.hex, command.victim ?? null));
            case 'buyDevCard':
                return this.record(player.id, { type }, () => this.buyDevCard(player));
            case 'playDev': {
                const recorded = { type, card: command.card };
                if (command.card === 'yearOfPlenty') recorded.resources = command.resources;
                if (command.card === 'monopoly') recorded.resource = command.resource;
                return this.record(player.id, recorded, () => this.playDev(player, recorded));
            }
            case 'bankTrade':
                return this.record(player.id, { type, give: command.give, get: command.get }, () => this.bankTrade(player, command.give, command.get));
            case 'offerTrade':
                return this.record(player.id, { type, give: command.give, get: command.get }, () => this.offerTrade(player, command.give, command.get));
            case 'cancelTrade':
                return this.record(player.id, { type }, () => this.cancelTrade(player));
            case 'endTurn':
                return this.record(player.id, { type }, () => this.endTurn(player));
            default:
                return this.reject('不明な操作です');
        }
    }

    // 操作を行い、受け付けたら記録する（記録には操作に必要な項目だけを残す）
    record(playerId, recorded, action) {
        const accepted = action();
        if (accepted) this.commands.push({ playerId, ...recorded });
        return accepted;
    }

    // ===== 建設 =====

    build(player, piece, at) {
        if (this.phase === 'setup') return this.buildSetup(player, piece, at);
        const pending = this.pendingOf(player.id);
        const free = pending?.type === 'roadBuilding';
        if (!(free && piece === 'road')) {
            const blocked = this.blockedFor(player);
            if (blocked) return this.reject(blocked);
        }
        if (!free && !this.rolled) return this.reject('先にサイコロを振ってください');
        if (!PIECES[piece]) return this.reject('その建物はありません');
        if (player.pieces[piece] === 0) return this.reject(`${PIECE_NAMES[piece]}はもう残っていません`);
        if (!free && !hasCards(player.hand, COSTS[piece])) return this.reject('資源が足りません');

        const canBuild = { road: () => this.canBuildRoad(player.id, at), settlement: () => this.canBuildSettlement(player.id, at), city: () => this.canBuildCity(player.id, at) }[piece];
        if (!canBuild()) return this.reject(`そこには${PIECE_NAMES[piece]}を置けません`);

        if (!free) this.pay(player, COSTS[piece]);
        this.emit('build', { player: player.id, piece, at, cost: free ? null : { ...COSTS[piece] } });
        this.place(player, piece, at);
        if (free) {
            pending.remaining--;
            if (pending.remaining === 0 || player.pieces.road === 0 || this.roadSpots(player.id).length === 0) this.clearPending(player.id);
        }
        this.log(`${player.name}が${PIECE_NAMES[piece]}を${free ? '無料で' : ''}建てました`);
        return true;
    }

    buildSetup(player, piece, at) {
        if (piece !== this.setupStep) return this.reject(this.setupStep === 'settlement' ? '開拓地を置いてください' : '道を置いてください');
        if (piece === 'settlement') {
            if (!this.canPlaceSettlementAt(at)) return this.reject('そこには開拓地を置けません');
            this.emit('build', { player: player.id, piece: 'settlement', at, cost: null });
            this.place(player, 'settlement', at);
            this.lastSettlement = at;
            this.setupStep = 'road';
            // 2巡目の開拓地は、周りのタイルの資源をもらう
            if (this.setupIndex >= this.players.length) {
                const gained = emptyCards();
                const gains = [];
                GEOMETRY.vertices[at].hexes.forEach(hexId => {
                    const { terrain } = this.board.hexes[hexId];
                    if (RESOURCES.includes(terrain) && this.bank[terrain] > 0) {
                        gained[terrain]++;
                        gains.push({ player: player.id, hex: hexId, resource: terrain, count: 1 });
                    }
                });
                this.pay(player, gained, -1);
                if (gains.length > 0) this.emit('produce', { gains });
                this.log(`${player.name}が開拓地を置き、${countCards(gained) ? formatCards(gained) : '何も'}をもらいました`);
            } else {
                this.log(`${player.name}が開拓地を置きました`);
            }
            return true;
        }
        if (!isInt(at, 0, EDGE_COUNT - 1) || this.roads[at] !== null) return this.reject('そこには道を置けません');
        const { a, b } = GEOMETRY.edges[at];
        if (a !== this.lastSettlement && b !== this.lastSettlement) return this.reject('置いたばかりの開拓地につなげて道を置いてください');
        this.emit('build', { player: player.id, piece: 'road', at, cost: null });
        this.place(player, 'road', at);
        this.log(`${player.name}が道を置きました`);
        this.setupIndex++;
        this.setupStep = 'settlement';
        this.lastSettlement = null;
        if (this.setupIndex === this.setupOrder.length) {
            this.phase = 'play';
            this.currentPlayerIndex = this.setupOrder[0];
            if (this.mode === 'realtime') {
                this.log('初期配置が終わりました。全員が同時に動きます');
                this.startRound();
            } else {
                this.turnNumber = 1;
                this.log(`初期配置が終わりました。${this.getCurrentPlayer().name}の番です`);
            }
        } else {
            this.currentPlayerIndex = this.setupOrder[this.setupIndex];
        }
        return true;
    }

    place(player, piece, at) {
        if (piece === 'road') {
            this.roads[at] = player.id;
        } else if (piece === 'settlement') {
            this.buildings[at] = { owner: player.id, type: 'settlement' };
        } else {
            this.buildings[at] = { owner: player.id, type: 'city' };
            player.pieces.settlement++; // 都市にした開拓地は手元に戻る
        }
        player.pieces[piece]--;
        // 道が伸びたときだけでなく、開拓地で他人の道が分断されたときも最長交易路が変わる
        if (piece !== 'city') this.updateLongestRoad();
    }

    // 他の建物から1辺以上離れた空き頂点か（距離のルール）
    canPlaceSettlementAt(vertex) {
        if (!isInt(vertex, 0, VERTEX_COUNT - 1) || this.buildings[vertex]) return false;
        return GEOMETRY.vertices[vertex].neighbors.every(v => !this.buildings[v]);
    }

    canBuildSettlement(playerId, vertex) {
        if (!this.canPlaceSettlementAt(vertex)) return false;
        return GEOMETRY.vertices[vertex].edges.some(e => this.roads[e] === playerId);
    }

    canBuildCity(playerId, vertex) {
        const building = isInt(vertex, 0, VERTEX_COUNT - 1) ? this.buildings[vertex] : null;
        return building?.owner === playerId && building.type === 'settlement';
    }

    canBuildRoad(playerId, edge) {
        if (!isInt(edge, 0, EDGE_COUNT - 1) || this.roads[edge] !== null) return false;
        const { a, b } = GEOMETRY.edges[edge];
        return [a, b].some(v => {
            const building = this.buildings[v];
            if (building?.owner === playerId) return true;
            // 他人の建物がある頂点の先には、道をつなげられない
            if (building) return false;
            return GEOMETRY.vertices[v].edges.some(e => e !== edge && this.roads[e] === playerId);
        });
    }

    // 置ける場所の一覧（画面の候補表示と CPU で使う）
    roadSpots(playerId) {
        if (this.phase === 'setup') {
            if (this.setupStep !== 'road') return [];
            return GEOMETRY.vertices[this.lastSettlement].edges.filter(e => this.roads[e] === null);
        }
        return GEOMETRY.edges.map(e => e.id).filter(e => this.canBuildRoad(playerId, e));
    }

    settlementSpots(playerId) {
        const all = GEOMETRY.vertices.map(v => v.id);
        if (this.phase === 'setup') return this.setupStep === 'settlement' ? all.filter(v => this.canPlaceSettlementAt(v)) : [];
        return all.filter(v => this.canBuildSettlement(playerId, v));
    }

    citySpots(playerId) {
        return GEOMETRY.vertices.map(v => v.id).filter(v => this.canBuildCity(playerId, v));
    }

    // ===== サイコロ・生産・盗賊 =====

    roll(player) {
        if (this.phase !== 'play') return this.reject('初期配置の途中です');
        if (this.mode === 'realtime') return this.reject('サイコロは巡のはじめに自動で振ります');
        if (this.pending) return this.reject(this.pendingMessage());
        if (this.rolled) return this.reject('サイコロはもう振りました');
        const d1 = 1 + Math.floor(this.random() * 6);
        const d2 = 1 + Math.floor(this.random() * 6);
        this.dice = [d1, d2];
        this.rolled = true;
        const sum = d1 + d2;
        this.log(`${player.name}がサイコロを振りました: ${d1} + ${d2} = ${sum}`);
        this.emit('roll', { player: player.id, dice: [d1, d2] });
        if (sum === 7) {
            const remaining = {};
            this.players.forEach(p => {
                const count = countCards(p.hand);
                if (count > HAND_LIMIT) remaining[p.id] = Math.floor(count / 2);
            });
            if (Object.keys(remaining).length > 0) {
                this.pending = { type: 'discard', remaining };
                this.log(`7 が出ました。手札が${HAND_LIMIT + 1}枚以上の人は半分を捨てます`);
            } else {
                this.pending = { type: 'robber' };
                this.log(`7 が出ました。${player.name}が盗賊を動かします`);
            }
        } else {
            this.produce(sum);
        }
        return true;
    }

    // sum の目で資源を配り、席ごとにもらった資源を返す（log = false なら、ログは呼び出し側でまとめて出す）
    produce(sum, { log = true } = {}) {
        // 資源ごとに、誰が何枚もらうか
        const demand = Object.fromEntries(RESOURCES.map(r => [r, this.players.map(() => 0)]));
        const sources = []; // { player, hex, resource, count }（演出用。タイルごと・人ごと）
        this.board.hexes.forEach((hex, hexId) => {
            if (hex.number !== sum || hexId === this.robber) return;
            GEOMETRY.hexes[hexId].vertices.forEach(v => {
                const building = this.buildings[v];
                if (!building) return;
                const n = building.type === 'city' ? 2 : 1;
                demand[hex.terrain][building.owner] += n;
                const source = sources.find(s => s.player === building.owner && s.hex === hexId);
                if (source) source.count += n;
                else sources.push({ player: building.owner, hex: hexId, resource: hex.terrain, count: n });
            });
        });
        const gains = this.players.map(() => emptyCards());
        RESOURCES.forEach(r => {
            const total = demand[r].reduce((a, b) => a + b, 0);
            if (total === 0) return;
            const receivers = demand[r].filter(n => n > 0).length;
            // 銀行に足りないときは、もらうのが1人なら残りだけ、2人以上なら誰ももらえない
            if (total > this.bank[r] && receivers > 1) {
                this.log(`銀行の${RESOURCE_NAMES[r]}が足りないので、誰ももらえません`);
                return;
            }
            demand[r].forEach((n, id) => { gains[id][r] = Math.min(n, this.bank[r]); });
        });
        // 銀行が足りずに減らした分は、タイルの順に割り当て直す
        const left = gains.map(cards => ({ ...cards }));
        const produced = sources.map(s => {
            const count = Math.min(s.count, left[s.player][s.resource]);
            left[s.player][s.resource] -= count;
            return { ...s, count };
        }).filter(s => s.count > 0);
        if (produced.length > 0) this.emit('produce', { gains: produced });
        gains.forEach((cards, id) => {
            if (countCards(cards) > 0) this.pay(this.players[id], cards, -1);
        });
        if (log) this.logProduction(gains);
        return gains;
    }

    // 生産のログ（席ごとにもらった資源）
    logProduction(gains) {
        const messages = gains.map((cards, id) => (countCards(cards) > 0 ? `${this.players[id].name}: ${formatCards(cards)}` : null)).filter(Boolean);
        this.log(messages.length ? `生産 ${messages.join(' / ')}` : '誰も資源をもらえませんでした');
    }

    discard(player, value) {
        const pending = this.pendingOf(player.id);
        const required = pending?.type === 'discard' ? pending.remaining[player.id] : undefined;
        if (!required) return this.reject('今は手札を捨てる必要はありません');
        const cards = parseCards(value);
        if (!cards || countCards(cards) !== required) return this.reject(`${required}枚を選んで捨ててください`);
        if (!hasCards(player.hand, cards)) return this.reject('持っていない資源は捨てられません');
        this.pay(player, cards);
        this.emit('discard', { player: player.id, cards });
        if (this.mode === 'realtime' && this.phase === 'play') {
            this.clearPending(player.id);
            this.log(`${player.name}が${required}枚捨てました（${formatCards(cards)}）`);
            return true;
        }
        delete this.pending.remaining[player.id];
        this.log(`${player.name}が${required}枚捨てました（${formatCards(cards)}）`);
        if (Object.keys(this.pending.remaining).length === 0) {
            this.pending = { type: 'robber' };
            this.log(`${this.getCurrentPlayer().name}が盗賊を動かします`);
        }
        return true;
    }

    // 盗賊を hex に動かしたときに奪える相手（手札のある、隣に建物を持つ他人）
    robberVictims(playerId, hex) {
        if (!isInt(hex, 0, HEX_COUNT - 1)) return [];
        const owners = new Set(GEOMETRY.hexes[hex].vertices.map(v => this.buildings[v]?.owner).filter(o => o !== undefined));
        return [...owners].filter(o => o !== playerId && countCards(this.players[o].hand) > 0).sort((a, b) => a - b);
    }

    moveRobber(player, hex, victim) {
        if (this.pendingOf(player.id)?.type !== 'robber') return this.reject('今は盗賊を動かせません');
        if (!isInt(hex, 0, HEX_COUNT - 1)) return this.reject('そのタイルはありません');
        if (hex === this.robber) return this.reject('盗賊は別のタイルに動かしてください');
        const victims = this.robberVictims(player.id, hex);
        if (victims.length > 0 && !victims.includes(victim)) return this.reject('奪う相手を選んでください');
        if (victims.length === 0 && victim !== null) return this.reject('そのタイルからは奪えません');

        this.emit('robber', { player: player.id, from: this.robber, to: hex });
        this.robber = hex;
        this.clearPending(player.id);
        if (victim === null) {
            this.log(`${player.name}が盗賊を動かしました`);
            return true;
        }
        const target = this.players[victim];
        const cards = RESOURCES.flatMap(r => Array(target.hand[r]).fill(r));
        const stolen = cards[Math.floor(this.random() * cards.length)];
        target.hand[stolen]--;
        player.hand[stolen]++;
        this.emit('steal', { from: victim, to: player.id, resource: stolen });
        this.log(`${player.name}が盗賊を動かし、${target.name}から1枚奪いました`, {
            seats: [player.id, victim],
            text: `${player.name}が盗賊を動かし、${target.name}から${RESOURCE_NAMES[stolen]}を奪いました`
        });
        return true;
    }

    // ===== 発展カード =====

    buyDevCard(player) {
        const blocked = this.blockedFor(player);
        if (blocked) return this.reject(blocked);
        if (!this.rolled) return this.reject('先にサイコロを振ってください');
        if (this.devDeck.length === 0) return this.reject('発展カードはもうありません');
        if (!hasCards(player.hand, COSTS.devCard)) return this.reject('資源が足りません');
        this.pay(player, COSTS.devCard);
        const type = this.devDeck.pop();
        player.devCards.push({ type, turn: this.turnNumber });
        this.emit('buyDev', { player: player.id, card: type, cost: { ...COSTS.devCard } });
        this.log(`${player.name}が発展カードを買いました`, { seats: [player.id], text: `${player.name}が発展カード（${DEV_NAMES[type]}）を買いました` });
        return true;
    }

    // 今使える発展カードの種類（勝利点は使うカードではない）
    playableDevCards(playerId) {
        const player = this.players[playerId];
        if (this.isRealtimePlay()) {
            if (this.devPlayedBy[playerId] || this.blockedFor(player)) return [];
        } else if (this.phase !== 'play' || playerId !== this.currentPlayerIndex || this.devPlayed || this.pending) {
            return [];
        }
        return [...new Set(player.devCards.filter(c => c.type !== 'victoryPoint' && c.turn < this.turnNumber).map(c => c.type))];
    }

    playDev(player, { card, resources, resource }) {
        if (this.phase !== 'play') return this.reject('初期配置の途中です');
        const blocked = this.blockedFor(player);
        if (blocked) return this.reject(blocked);
        if (!DEV_NAMES[card] || card === 'victoryPoint') return this.reject('そのカードは使えません');
        if (this.mode === 'realtime' ? this.devPlayedBy[player.id] : this.devPlayed) {
            return this.reject(`発展カードは1${this.mode === 'realtime' ? '巡' : '手番'}に1枚までです`);
        }
        const index = player.devCards.findIndex(c => c.type === card && c.turn < this.turnNumber);
        if (index < 0) {
            return this.reject(player.devCards.some(c => c.type === card) ? `買った${this.mode === 'realtime' ? '巡' : '手番'}には使えません` : 'そのカードを持っていません');
        }

        if (card === 'yearOfPlenty') {
            if (!Array.isArray(resources) || resources.length !== 2 || !resources.every(r => RESOURCES.includes(r))) {
                return this.reject('もらう資源を2つ選んでください');
            }
            const cards = emptyCards();
            resources.forEach(r => { cards[r]++; });
            if (!hasCards(this.bank, cards)) return this.reject('銀行にその資源が足りません');
            this.emit('playDev', { player: player.id, card });
            this.pay(player, cards, -1);
            this.emit('gain', { player: player.id, cards });
            this.log(`${player.name}が収穫を使い、${formatCards(cards)}をもらいました`);
        } else if (card === 'monopoly') {
            if (!RESOURCES.includes(resource)) return this.reject('独占する資源を選んでください');
            let total = 0;
            const taken = [];
            this.players.forEach(p => {
                if (p === player) return;
                if (p.hand[resource] > 0) taken.push({ player: p.id, count: p.hand[resource] });
                total += p.hand[resource];
                p.hand[resource] = 0;
            });
            player.hand[resource] += total;
            this.emit('playDev', { player: player.id, card });
            this.emit('monopoly', { player: player.id, resource, taken });
            this.log(`${player.name}が独占を使い、${RESOURCE_NAMES[resource]}を${total}枚集めました`);
        } else if (card === 'roadBuilding') {
            const remaining = Math.min(2, player.pieces.road);
            if (remaining === 0 || this.roadSpots(player.id).length === 0) return this.reject('道を置ける場所がありません');
            this.setPending(player.id, { type: 'roadBuilding', remaining });
            this.emit('playDev', { player: player.id, card });
            this.log(`${player.name}が街道建設を使いました。道を${remaining}本無料で置けます`);
        } else {
            player.knights++;
            this.setPending(player.id, { type: 'robber' });
            this.emit('playDev', { player: player.id, card });
            this.log(`${player.name}が騎士を使いました`);
            this.updateLargestArmy(player);
        }
        player.devCards.splice(index, 1);
        this.devPlayed = true;
        this.devPlayedBy[player.id] = true;
        return true;
    }

    // ===== 交換 =====

    // 銀行に何枚で1枚と交換できるか（港があれば 3:1 や 2:1）
    tradeRatio(playerId, resource) {
        let ratio = 4;
        this.buildings.forEach((building, v) => {
            if (building?.owner !== playerId || !this.harbors[v]) return;
            if (this.harbors[v] === resource) ratio = Math.min(ratio, 2);
            else if (this.harbors[v] === 'any') ratio = Math.min(ratio, 3);
        });
        return ratio;
    }

    bankTrade(player, give, get) {
        const blocked = this.blockedFor(player);
        if (blocked) return this.reject(blocked);
        if (!this.rolled) return this.reject('先にサイコロを振ってください');
        if (!RESOURCES.includes(give) || !RESOURCES.includes(get) || give === get) return this.reject('交換する資源を選んでください');
        const ratio = this.tradeRatio(player.id, give);
        if (player.hand[give] < ratio) return this.reject(`${RESOURCE_NAMES[give]}が${ratio}枚必要です`);
        if (this.bank[get] === 0) return this.reject(`銀行に${RESOURCE_NAMES[get]}がありません`);
        player.hand[give] -= ratio;
        this.bank[give] += ratio;
        player.hand[get]++;
        this.bank[get]--;
        this.emit('bankTrade', { player: player.id, give, count: ratio, get });
        this.log(`${player.name}が銀行と交換しました（${RESOURCE_NAMES[give]}${ratio} → ${RESOURCE_NAMES[get]}1）`);
        return true;
    }

    offerTrade(player, giveValue, getValue) {
        const blocked = this.blockedFor(player);
        if (blocked) return this.reject(blocked);
        if (this.trade && this.trade.from !== player.id) return this.reject('ほかの人の交渉が終わるのを待ってください');
        if (!this.rolled) return this.reject('先にサイコロを振ってください');
        const give = parseCards(giveValue);
        const get = parseCards(getValue);
        if (!give || !get || countCards(give) === 0 || countCards(get) === 0) return this.reject('出す資源と欲しい資源を選んでください');
        if (RESOURCES.some(r => give[r] > 0 && get[r] > 0)) return this.reject('同じ資源を出して受け取ることはできません');
        if (!hasCards(player.hand, give)) return this.reject('持っていない資源は出せません');
        this.trade = { id: this.tradeSerial + 1, from: player.id, give, get, responses: {} };
        this.tradeSerial++;
        this.log(`${player.name}が交渉を持ちかけました（${formatCards(give)} → ${formatCards(get)}）`);
        return true;
    }

    // 受けたら、その場で交換する（先に受けた人と交換する）
    respondTrade(player, id, accept) {
        const trade = this.trade;
        if (!trade || trade.id !== id) return this.reject('その交渉は終わっています');
        if (player.id === trade.from) return this.reject('自分の交渉には答えられません');
        if (trade.responses[player.id]) return this.reject('もう答えています');
        if (!accept) {
            trade.responses[player.id] = 'reject';
            this.log(`${player.name}が交渉を断りました`);
            return true;
        }
        if (!hasCards(player.hand, trade.get)) return this.reject('求められた資源を持っていません');
        const from = this.players[trade.from];
        if (!hasCards(from.hand, trade.give)) return this.reject('持ちかけた人の資源が足りなくなっています');
        addCards(from.hand, trade.give, -1);
        addCards(player.hand, trade.give);
        addCards(player.hand, trade.get, -1);
        addCards(from.hand, trade.get);
        this.emit('trade', { from: from.id, to: player.id, give: { ...trade.give }, get: { ...trade.get } });
        this.trade = null;
        this.log(`${from.name}と${player.name}が交換しました（${formatCards(trade.give)} ⇄ ${formatCards(trade.get)}）`);
        return true;
    }

    cancelTrade(player) {
        if (!this.trade) return this.reject('交渉はありません');
        if (this.trade.from !== player.id) return this.reject('自分の交渉ではありません');
        this.trade = null;
        this.log(`${player.name}が交渉を取り下げました`);
        return true;
    }

    // ===== 手番の終わり =====

    endTurn(player) {
        if (this.phase !== 'play') return this.reject('初期配置の途中です');
        if (this.mode === 'realtime') return this.finishRound(player);
        if (this.pending) return this.reject(this.pendingMessage());
        if (!this.rolled) return this.reject('先にサイコロを振ってください');
        this.trade = null;
        this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
        this.turnNumber++;
        this.rolled = false;
        this.dice = null;
        this.devPlayed = false;
        this.log(`${player.name}が手番を終えました。${this.getCurrentPlayer().name}の番です`);
        return true;
    }

    // ===== 得点 =====

    // 勝利点（hidden: 本人にしか見えない勝利点カードも数える）
    points(playerId, { hidden = true } = {}) {
        let points = 0;
        this.buildings.forEach(b => { if (b?.owner === playerId) points += b.type === 'city' ? 2 : 1; });
        if (this.longestRoad === playerId) points += 2;
        if (this.largestArmy === playerId) points += 2;
        if (hidden) points += this.players[playerId].devCards.filter(c => c.type === 'victoryPoint').length;
        return points;
    }

    checkWin(player) {
        if (this.phase !== 'play' || this.points(player.id) < WIN_POINTS) return;
        this.phase = 'end';
        this.pending = null;
        this.trade = null;
        this.result = { winnerId: player.id, points: this.players.map(p => this.points(p.id)) };
        this.log(`${player.name}が${this.points(player.id)}点に達して勝ちました！`);
    }

    // リアルタイムモード：操作した人を先に、全員の点を確かめる（ほかの人の道が分断されて点が動くこともあるため）
    checkWinAll(actor) {
        [actor, ...this.players.filter(p => p !== actor)].forEach(player => this.checkWin(player));
    }

    // 最長交易路の長さ（他人の建物がある頂点で道は途切れる）
    roadLength(playerId) {
        let best = 0;
        const walk = (vertex, used, length) => {
            best = Math.max(best, length);
            const building = this.buildings[vertex];
            if (length > 0 && building && building.owner !== playerId) return;
            GEOMETRY.vertices[vertex].edges.forEach(e => {
                if (this.roads[e] !== playerId || used.has(e)) return;
                used.add(e);
                walk(otherEnd(e, vertex), used, length + 1);
                used.delete(e);
            });
        };
        this.roads.forEach((owner, e) => {
            if (owner !== playerId) return;
            const { a, b } = GEOMETRY.edges[e];
            walk(a, new Set(), 0);
            walk(b, new Set(), 0);
        });
        return best;
    }

    updateLongestRoad() {
        this.roadLengths = this.players.map(p => this.roadLength(p.id));
        const max = Math.max(...this.roadLengths);
        const holder = this.longestRoad;
        let next;
        if (max < LONGEST_ROAD_MIN) {
            next = null;
        } else if (holder !== null && this.roadLengths[holder] === max) {
            next = holder; // 並ばれても、持っている人のまま
        } else {
            const leaders = this.players.filter(p => this.roadLengths[p.id] === max);
            next = leaders.length === 1 ? leaders[0].id : null; // 持ち主が抜かれて並んだら、誰のものでもなくなる
        }
        if (next !== holder) {
            this.emit('award', { award: 'longestRoad', from: holder, to: next });
            this.longestRoad = next;
            this.log(next === null ? '最長交易路は誰のものでもなくなりました' : `${this.players[next].name}が最長交易路（${max}本）を手に入れました`);
        }
    }

    updateLargestArmy(player) {
        if (player.knights < LARGEST_ARMY_MIN || this.largestArmy === player.id) return;
        if (this.largestArmy !== null && this.players[this.largestArmy].knights >= player.knights) return;
        this.emit('award', { award: 'largestArmy', from: this.largestArmy, to: player.id });
        this.largestArmy = player.id;
        this.log(`${player.name}が最大騎士力（騎士${player.knights}枚）を手に入れました`);
    }

    // ===== 補助 =====

    // 今、操作が必要な人（CPU の進行と、ローカル対戦で誰の画面を出すかに使う）
    actors() {
        if (this.phase === 'end') return [];
        if (this.isRealtimePlay()) {
            // 完了していない人・先に片付ける処理がある人・交渉に答えていない人
            return this.players.filter(p => !this.done[p.id] || this.queues[p.id].length > 0
                || (this.trade && this.trade.from !== p.id && !this.trade.responses[p.id])).map(p => p.id);
        }
        if (this.pending?.type === 'discard') return Object.keys(this.pending.remaining).map(Number);
        if (this.trade) {
            const waiting = this.players.filter(p => p.id !== this.trade.from && !this.trade.responses[p.id]).map(p => p.id);
            return [...waiting, this.currentPlayerIndex];
        }
        return [this.currentPlayerIndex];
    }

    pendingMessage() {
        switch (this.pending?.type) {
            case 'discard': return '手札を捨てる人を待っています';
            case 'robber': return '先に盗賊を動かしてください';
            case 'roadBuilding': return '先に街道建設の道を置いてください';
            default: return '今はその操作はできません';
        }
    }

    // ===== リアルタイムモード =====

    isRealtimePlay() {
        return this.mode === 'realtime' && this.phase === 'play';
    }

    // seat の人が先に片付ける処理（なければ null）。手札を捨てるときは、通常モードと同じ形 { type: 'discard', remaining: { 席: 枚数 } }
    pendingOf(seat) {
        if (this.mode === 'realtime' && this.phase === 'play') {
            const head = this.queues[seat]?.[0];
            if (!head) return null;
            return head.type === 'discard' ? { type: 'discard', remaining: { [seat]: head.count } } : head;
        }
        if (this.pending?.type === 'discard') return this.pending.remaining[seat] ? this.pending : null;
        return seat === this.currentPlayerIndex ? this.pending : null;
    }

    setPending(seat, pending) {
        if (this.mode === 'realtime' && this.phase === 'play') this.queues[seat].unshift(pending);
        else this.pending = pending;
    }

    clearPending(seat) {
        if (this.mode === 'realtime' && this.phase === 'play') this.queues[seat].shift();
        else this.pending = null;
    }

    // ふだんの操作（建設・交換・発展カード・完了）ができないときの理由。できるなら null
    blockedFor(player) {
        if (this.mode === 'realtime' && this.phase === 'play') {
            const head = this.queues[player.id][0];
            if (head) return { discard: '先に手札を捨ててください', robber: '先に盗賊を動かしてください', roadBuilding: '先に街道建設の道を置いてください' }[head.type];
            if (this.done[player.id]) return 'この巡はもう完了しています。全員が完了するのを待ってください';
            return null;
        }
        return this.pending ? this.pendingMessage() : null;
    }

    // 巡を始める：全員が同時にサイコロを振る
    startRound() {
        this.turnNumber++;
        this.rolled = true;
        this.trade = null;
        this.done = this.players.map(() => false);
        this.devPlayedBy = this.players.map(() => false);
        this.queues = this.players.map(() => []);
        this.rolls = this.players.map(() => [1 + Math.floor(this.random() * 6), 1 + Math.floor(this.random() * 6)]);
        this.dice = null;
        this.log(`出た目 ${this.players.map((p, i) => `${p.name} ${this.rolls[i][0] + this.rolls[i][1]}`).join('・')}`);
        this.players.forEach(p => this.emit('roll', { player: p.id, dice: [...this.rolls[p.id]] }));
        const sevens = this.players.filter(p => this.rolls[p.id][0] + this.rolls[p.id][1] === 7);
        // 7 があれば、生産の前に手札を半分捨てる（何人が7を出しても1回）
        if (sevens.length > 0) {
            const discarding = this.players.filter(p => countCards(p.hand) > HAND_LIMIT);
            discarding.forEach(p => this.queues[p.id].push({ type: 'discard', count: Math.floor(countCards(p.hand) / 2) }));
            this.log(`7 が出ました（${sevens.map(p => p.name).join('・')}）。${discarding.length ? `手札が${HAND_LIMIT + 1}枚以上の人は半分を捨てます` : '盗賊を動かします'}`);
        }
        // 生産は目ごとに配り、ログは1行にまとめる
        const total = this.players.map(() => emptyCards());
        this.players.forEach(p => {
            const sum = this.rolls[p.id][0] + this.rolls[p.id][1];
            if (sum === 7) return;
            this.produce(sum, { log: false }).forEach((cards, id) => addCards(total[id], cards));
        });
        if (sevens.length < this.players.length) this.logProduction(total);
        sevens.forEach(p => this.queues[p.id].push({ type: 'robber' }));
    }

    // seat の人がこの巡を完了する。全員が完了したら次の巡へ
    finishRound(player) {
        const blocked = this.blockedFor(player);
        if (blocked) return this.reject(blocked);
        if (this.trade?.from === player.id) this.trade = null;
        this.done[player.id] = true;
        if (this.done.every(Boolean)) this.startRound();
        return true;
    }

    // 資源を銀行に払う（sign = -1 で銀行からもらう）
    pay(player, cards, sign = 1) {
        addCards(player.hand, cards, -sign);
        addCards(this.bank, cards, sign);
    }

    reject(message) {
        this.lastError = message;
        return false;
    }

    // secret: { seats, text } を渡すと、その席の人にだけ詳しい文を見せる
    log(text, secret = null) {
        this.logs.push(secret ? { text, secret } : { text });
        if (this.logs.length > MAX_LOGS) this.logs.shift();
    }

    // 起きたことを記録する（通し番号つき。最近の MAX_EVENTS 件だけ持つ）
    emit(type, data) {
        this.eventSerial++;
        this.events.push({ id: this.eventSerial, type, ...data });
        if (this.events.length > MAX_EVENTS) this.events.shift();
    }

    // 参加者・オプション・操作の記録からゲームを再現する
    static replay(players, options, commands) {
        const game = new Game(players, options);
        commands.forEach(({ playerId, ...command }, index) => {
            if (!game.applyCommand(playerId, command)) {
                throw new Error(`操作 ${index} を再現できませんでした: ${game.lastError}`);
            }
        });
        return game;
    }
}
