import { describe, it, expect } from 'vitest';
import Game, { emptyCards, countCards } from '../public/js/game.js';
import { GEOMETRY } from '../public/js/board.js';
import { createGameView } from '../public/js/game-view.js';
import { runCpuStep } from '../public/js/cpu-player.js';

const players = (n) => Array.from({ length: n }, (_, i) => ({ name: `P${i}`, isCPU: false }));
const cards = (partial) => ({ ...emptyCards(), ...partial });

// 初期配置を CPU の手で済ませたゲーム（人間の席でも CPU の考えで置く）
function afterSetup(n = 3, seed = 1) {
    const game = new Game(players(n), { seed });
    game.players.forEach(p => { p.isCPU = true; });
    while (game.phase === 'setup') runCpuStep(game);
    game.players.forEach(p => { p.isCPU = false; });
    return game;
}

// 手番の人がサイコロを振った状態（7 が出たら盗賊まで片付ける）
function rolled(game) {
    const id = game.currentPlayerIndex;
    game.applyCommand(id, { type: 'roll' });
    game.pending = null;
    return id;
}

describe('初期配置', () => {
    it('蛇行順に開拓地と道を置き、2つ目の開拓地の周りの資源をもらう', () => {
        const game = new Game(players(3), { seed: 3 });
        const order = game.setupOrder;
        expect(order).toHaveLength(6);
        expect(order.slice(3)).toEqual([...order.slice(0, 3)].reverse());

        game.players.forEach(p => { p.isCPU = true; });
        for (let i = 0; i < 6; i++) { runCpuStep(game); runCpuStep(game); }
        expect(game.phase).toBe('play');
        expect(game.currentPlayerIndex).toBe(order[0]);
        game.players.forEach(p => {
            expect(p.pieces.settlement).toBe(3);
            expect(p.pieces.road).toBe(13);
        });
        expect(game.players.reduce((sum, p) => sum + countCards(p.hand), 0)).toBeGreaterThan(0);
    });

    it('他の建物の隣には開拓地を置けず、道は置いたばかりの開拓地につなげる', () => {
        const game = new Game(players(2), { seed: 1 });
        const first = game.currentPlayerIndex;
        expect(game.applyCommand(first, { type: 'build', piece: 'road', at: 0 })).toBe(false);
        expect(game.applyCommand(first, { type: 'build', piece: 'settlement', at: 0 })).toBe(true);
        const far = GEOMETRY.edges.find(e => e.a !== 0 && e.b !== 0).id;
        expect(game.applyCommand(first, { type: 'build', piece: 'road', at: far })).toBe(false);
        expect(game.applyCommand(first, { type: 'build', piece: 'road', at: GEOMETRY.vertices[0].edges[0] })).toBe(true);

        const second = game.currentPlayerIndex;
        expect(second).not.toBe(first);
        const neighbor = GEOMETRY.vertices[0].neighbors[0];
        expect(game.applyCommand(second, { type: 'build', piece: 'settlement', at: neighbor })).toBe(false);
        expect(game.lastError).toBe('そこには開拓地を置けません');
    });
});

describe('手番', () => {
    it('サイコロを振る前には建てられず、手番は振ってから終えられる', () => {
        const game = afterSetup();
        const id = game.currentPlayerIndex;
        expect(game.applyCommand(id, { type: 'endTurn' })).toBe(false);
        expect(game.lastError).toBe('先にサイコロを振ってください');
        rolled(game);
        expect(game.applyCommand(id, { type: 'endTurn' })).toBe(true);
        expect(game.currentPlayerIndex).toBe((id + 1) % 3);
        expect(game.applyCommand(id, { type: 'roll' })).toBe(false);
    });

    it('出た目のタイルに接する開拓地は1枚、都市は2枚もらい、盗賊のいるタイルは出ない', () => {
        const game = afterSetup();
        const hexId = game.board.hexes.findIndex(h => h.number === 6);
        const [v1, , v3] = GEOMETRY.hexes[hexId].vertices;
        game.buildings = game.buildings.map(() => null);
        game.buildings[v1] = { owner: 0, type: 'settlement' };
        game.buildings[v3] = { owner: 1, type: 'city' };
        game.players.forEach(p => { p.hand = emptyCards(); });
        const terrain = game.board.hexes[hexId].terrain;
        game.produce(6);
        // 頂点が接する3枚のタイルは互いに隣り合うので、6 のタイルを2枚触ることはない
        expect(game.players[0].hand[terrain]).toBe(1);
        expect(game.players[1].hand[terrain]).toBe(2);

        game.players.forEach(p => { p.hand = emptyCards(); });
        game.robber = hexId;
        game.produce(6);
        expect(countCards(game.players[0].hand) + countCards(game.players[1].hand)).toBe(0);
    });

    it('7 が出たら、8枚以上持つ人は半分を捨て、そのあと盗賊を動かして1枚奪う', () => {
        const game = afterSetup(3, 1);
        const id = game.currentPlayerIndex;
        const other = (id + 1) % 3;
        game.players.forEach(p => { p.hand = emptyCards(); });
        game.players[other].hand = cards({ wood: 5, ore: 4 });
        let calls = 0;
        game.random = () => [0.0, 0.99][calls++ % 2]; // サイコロを 1 と 6 にする
        game.applyCommand(id, { type: 'roll' });
        expect(game.dice[0] + game.dice[1]).toBe(7);
        expect(game.pending).toEqual({ type: 'discard', remaining: { [other]: 4 } });
        expect(game.applyCommand(id, { type: 'endTurn' })).toBe(false);

        expect(game.applyCommand(other, { type: 'discard', cards: cards({ wood: 3 }) })).toBe(false);
        expect(game.applyCommand(other, { type: 'discard', cards: cards({ wood: 2, ore: 2 }) })).toBe(true);
        expect(game.pending).toEqual({ type: 'robber' });

        const hex = GEOMETRY.hexes.find(h => h.id !== game.robber && h.vertices.some(v => game.buildings[v]?.owner === other)).id;
        expect(game.applyCommand(id, { type: 'moveRobber', hex, victim: null })).toBe(false);
        expect(game.applyCommand(id, { type: 'moveRobber', hex, victim: other })).toBe(true);
        expect(countCards(game.players[other].hand)).toBe(4);
        expect(countCards(game.players[id].hand)).toBe(1);
        expect(game.robber).toBe(hex);
    });

    it('奪ったカードの種類は、奪った人と奪われた人のログにだけ出る', () => {
        const game = afterSetup(3, 1);
        const id = game.currentPlayerIndex;
        const other = (id + 1) % 3;
        const third = (id + 2) % 3;
        game.players[other].hand = cards({ brick: 1 });
        game.rolled = true;
        game.pending = { type: 'robber' };
        const hex = GEOMETRY.hexes.find(h => h.id !== game.robber && h.vertices.some(v => game.buildings[v]?.owner === other)
            && !h.vertices.some(v => game.buildings[v]?.owner === third && countCards(game.players[third].hand) > 0)).id;
        game.applyCommand(id, { type: 'moveRobber', hex, victim: other });
        expect(createGameView(game, id).logs.at(-1)).toContain('レンガ');
        expect(createGameView(game, other).logs.at(-1)).toContain('レンガ');
        expect(createGameView(game, third).logs.at(-1)).not.toContain('レンガ');
    });
});

describe('建設', () => {
    it('道は自分の道か建物につなげ、開拓地は自分の道につながる、他の建物から離れた場所に置く', () => {
        const game = afterSetup();
        const id = rolled(game);
        const player = game.players[id];
        player.hand = cards({ wood: 5, brick: 5, sheep: 2, wheat: 2 });
        const spots = game.roadSpots(id);
        expect(spots.length).toBeGreaterThan(0);
        const notConnected = GEOMETRY.edges.map(e => e.id).find(e => !spots.includes(e) && game.roads[e] === null);
        expect(game.applyCommand(id, { type: 'build', piece: 'road', at: notConnected })).toBe(false);
        expect(game.applyCommand(id, { type: 'build', piece: 'road', at: spots[0] })).toBe(true);
        expect(player.hand.wood).toBe(4);
        expect(player.pieces.road).toBe(12);

        game.settlementSpots(id).forEach(v => {
            expect(GEOMETRY.vertices[v].neighbors.every(n => !game.buildings[n])).toBe(true);
            expect(GEOMETRY.vertices[v].edges.some(e => game.roads[e] === id)).toBe(true);
        });
    });

    it('都市は自分の開拓地を置き換え、開拓地は手元に戻る', () => {
        const game = afterSetup();
        const id = rolled(game);
        const player = game.players[id];
        player.hand = cards({ wheat: 2, ore: 3 });
        const [vertex] = game.citySpots(id);
        const before = game.points(id);
        expect(game.applyCommand(id, { type: 'build', piece: 'city', at: vertex })).toBe(true);
        expect(game.buildings[vertex]).toEqual({ owner: id, type: 'city' });
        expect(player.pieces).toMatchObject({ city: 3, settlement: 4 });
        expect(game.points(id)).toBe(before + 1);
        expect(game.applyCommand(id, { type: 'build', piece: 'city', at: vertex })).toBe(false);
    });

    it('資源が足りなければ建てられない', () => {
        const game = afterSetup();
        const id = rolled(game);
        game.players[id].hand = emptyCards();
        expect(game.applyCommand(id, { type: 'build', piece: 'road', at: game.roadSpots(id)[0] })).toBe(false);
        expect(game.lastError).toBe('資源が足りません');
    });
});

describe('発展カード', () => {
    it('買った手番には使えず、次の手番から1手番に1枚使える', () => {
        const game = afterSetup(2);
        const id = rolled(game);
        const player = game.players[id];
        player.hand = cards({ sheep: 2, wheat: 2, ore: 2 });
        game.devDeck.push('knight', 'knight');
        game.applyCommand(id, { type: 'buyDevCard' });
        game.applyCommand(id, { type: 'buyDevCard' });
        expect(player.devCards.map(c => c.type)).toEqual(['knight', 'knight']);
        expect(game.applyCommand(id, { type: 'playDev', card: 'knight' })).toBe(false);
        expect(game.lastError).toBe('買った手番には使えません');

        game.applyCommand(id, { type: 'endTurn' });
        const other = game.currentPlayerIndex;
        rolled(game);
        game.applyCommand(other, { type: 'endTurn' });

        // サイコロの前でも騎士は使える
        expect(game.applyCommand(id, { type: 'playDev', card: 'knight' })).toBe(true);
        expect(game.pending).toEqual({ type: 'robber' });
        const hex = GEOMETRY.hexes.find(h => h.id !== game.robber && game.robberVictims(id, h.id).length === 0).id;
        game.applyCommand(id, { type: 'moveRobber', hex, victim: null });
        expect(game.rolled).toBe(false);
        game.applyCommand(id, { type: 'roll' });
        game.pending = null;
        expect(game.applyCommand(id, { type: 'playDev', card: 'knight' })).toBe(false);
        expect(game.lastError).toBe('発展カードは1手番に1枚までです');
    });

    it('騎士を3枚使うと最大騎士力（2点）を得て、より多く使った人に移る', () => {
        const game = afterSetup(2);
        const [a, b] = game.players;
        a.knights = 2;
        game.updateLargestArmy(a);
        expect(game.largestArmy).toBeNull();
        a.knights = 3;
        game.updateLargestArmy(a);
        expect(game.largestArmy).toBe(a.id);
        b.knights = 3;
        game.updateLargestArmy(b);
        expect(game.largestArmy).toBe(a.id);
        b.knights = 4;
        game.updateLargestArmy(b);
        expect(game.largestArmy).toBe(b.id);
    });

    it('収穫で2枚もらい、独占で他の人の資源を全部集める', () => {
        const game = afterSetup(3);
        const id = rolled(game);
        const player = game.players[id];
        player.devCards = [{ type: 'yearOfPlenty', turn: 0 }, { type: 'monopoly', turn: 0 }];
        player.hand = emptyCards();
        expect(game.applyCommand(id, { type: 'playDev', card: 'yearOfPlenty', resources: ['ore', 'ore'] })).toBe(true);
        expect(player.hand.ore).toBe(2);

        game.devPlayed = false;
        game.players.forEach(p => { if (p !== player) p.hand.wheat = 3; });
        expect(game.applyCommand(id, { type: 'playDev', card: 'monopoly', resource: 'wheat' })).toBe(true);
        expect(player.hand.wheat).toBe(6);
        game.players.forEach(p => { if (p !== player) expect(p.hand.wheat).toBe(0); });
    });

    it('街道建設で道を2本無料で置ける', () => {
        const game = afterSetup(2);
        const id = rolled(game);
        const player = game.players[id];
        player.devCards = [{ type: 'roadBuilding', turn: 0 }];
        player.hand = emptyCards();
        game.applyCommand(id, { type: 'playDev', card: 'roadBuilding' });
        expect(game.applyCommand(id, { type: 'endTurn' })).toBe(false);
        game.applyCommand(id, { type: 'build', piece: 'road', at: game.roadSpots(id)[0] });
        game.applyCommand(id, { type: 'build', piece: 'road', at: game.roadSpots(id)[0] });
        expect(game.pending).toBeNull();
        expect(player.pieces.road).toBe(11);
    });
});

describe('交換', () => {
    it('銀行とは 4:1、3:1 の港があれば 3:1、資源の港があれば 2:1', () => {
        const game = afterSetup(2);
        const id = rolled(game);
        const player = game.players[id];
        game.harbors = game.harbors.map(() => null);
        expect(game.tradeRatio(id, 'wood')).toBe(4);
        const vertex = game.buildings.findIndex(b => b?.owner === id);
        game.harbors[vertex] = 'any';
        expect(game.tradeRatio(id, 'wood')).toBe(3);
        game.harbors[vertex] = 'wood';
        expect(game.tradeRatio(id, 'wood')).toBe(2);
        expect(game.tradeRatio(id, 'ore')).toBe(4);

        player.hand = cards({ wood: 2 });
        expect(game.applyCommand(id, { type: 'bankTrade', give: 'wood', get: 'ore' })).toBe(true);
        expect(player.hand).toEqual(cards({ ore: 1 }));
    });

    it('交渉は、誰かが受けた時点でその人と成立する（早い者勝ち）', () => {
        const game = afterSetup(3);
        const id = rolled(game);
        const [b, c] = [(id + 1) % 3, (id + 2) % 3];
        game.players[id].hand = cards({ wood: 2 });
        game.players[b].hand = cards({ ore: 1 });
        game.players[c].hand = cards({ ore: 1 });
        expect(game.applyCommand(id, { type: 'offerTrade', give: { wood: 2 }, get: { ore: 1 } })).toBe(true);
        expect(game.actors()).toEqual(expect.arrayContaining([b, c, id]));
        const tradeId = game.trade.id;
        expect(game.applyCommand(b, { type: 'respondTrade', id: tradeId, accept: false })).toBe(true);
        expect(game.applyCommand(b, { type: 'respondTrade', id: tradeId, accept: true })).toBe(false);
        expect(game.applyCommand(c, { type: 'respondTrade', id: tradeId, accept: true })).toBe(true);
        expect(game.players[id].hand).toEqual(cards({ ore: 1 }));
        expect(game.players[c].hand).toEqual(cards({ wood: 2 }));
        expect(game.trade).toBeNull();
    });

    it('持ちかけた人の資源が足りなくなっていたら、受けられない', () => {
        const game = afterSetup(3);
        const id = rolled(game);
        const b = (id + 1) % 3;
        game.players[id].hand = cards({ wood: 2 });
        game.players[b].hand = cards({ ore: 1 });
        expect(game.applyCommand(id, { type: 'offerTrade', give: { wood: 2 }, get: { ore: 1 } })).toBe(true);
        game.players[id].hand = cards({ wood: 1 });
        expect(game.applyCommand(b, { type: 'respondTrade', id: game.trade.id, accept: true })).toBe(false);
        expect(game.players[b].hand).toEqual(cards({ ore: 1 }));
    });

    it('取り下げたあとに届いた、前の交渉への返事は断る', () => {
        const game = afterSetup(2);
        const id = rolled(game);
        const other = (id + 1) % 2;
        game.players[id].hand = cards({ wood: 2 });
        game.players[other].hand = cards({ ore: 2 });
        game.applyCommand(id, { type: 'offerTrade', give: { wood: 1 }, get: { ore: 1 } });
        const oldId = game.trade.id;
        game.applyCommand(id, { type: 'cancelTrade' });
        game.applyCommand(id, { type: 'offerTrade', give: { wood: 2 }, get: { ore: 1 } });
        expect(game.applyCommand(other, { type: 'respondTrade', id: oldId, accept: true })).toBe(false);
        expect(game.lastError).toBe('その交渉は終わっています');
        expect(game.trade.responses).toEqual({});
    });

    it('持っていない資源は出せず、ほかの操作をすると交渉は取り下げになる', () => {
        const game = afterSetup(2);
        const id = rolled(game);
        game.players[id].hand = cards({ wood: 1, sheep: 4 });
        expect(game.applyCommand(id, { type: 'offerTrade', give: { wood: 2 }, get: { ore: 1 } })).toBe(false);
        expect(game.applyCommand(id, { type: 'offerTrade', give: { wood: 1 }, get: { ore: 1 } })).toBe(true);
        game.applyCommand(id, { type: 'bankTrade', give: 'sheep', get: 'brick' });
        expect(game.trade).toBeNull();
    });
});

describe('得点', () => {
    it('5本以上つながった一番長い道に最長交易路（2点）が付き、他人の開拓地で分断される', () => {
        const game = new Game(players(2), { seed: 1 });
        game.phase = 'play';
        // 外周の辺を6本つなげて置く
        const path = [];
        let vertex = GEOMETRY.edges[GEOMETRY.coast[0]].a;
        const used = new Set();
        while (path.length < 6) {
            const e = GEOMETRY.vertices[vertex].edges.find(id => GEOMETRY.coast.includes(id) && !used.has(id));
            used.add(e);
            path.push({ e, from: vertex });
            vertex = GEOMETRY.edges[e].a === vertex ? GEOMETRY.edges[e].b : GEOMETRY.edges[e].a;
        }
        path.forEach(({ e }) => { game.roads[e] = 0; });
        game.updateLongestRoad();
        expect(game.roadLength(0)).toBe(6);
        expect(game.longestRoad).toBe(0);
        expect(game.points(0)).toBe(2);

        // 真ん中の頂点に相手が開拓地を置くと 3 本ずつに分かれる
        game.buildings[path[3].from] = { owner: 1, type: 'settlement' };
        game.updateLongestRoad();
        expect(game.roadLength(0)).toBe(3);
        expect(game.longestRoad).toBeNull();
    });

    it('自分の手番に10点に達したら勝ち', () => {
        const game = afterSetup(2);
        const id = rolled(game);
        game.players[id].devCards = Array.from({ length: 8 }, () => ({ type: 'victoryPoint', turn: 0 })); // 開拓地2つと合わせて10点
        game.players[id].hand = cards({ wood: 1, brick: 1 });
        game.applyCommand(id, { type: 'build', piece: 'road', at: game.roadSpots(id)[0] });
        expect(game.phase).toBe('end');
        expect(game.result.winnerId).toBe(id);
        expect(game.applyCommand(id, { type: 'endTurn' })).toBe(false);
    });
});

describe('ビュー', () => {
    it('他人の手札と発展カードは枚数だけで、勝利点カードは本人にしか数えない', () => {
        const game = afterSetup(2);
        game.players[1].hand = cards({ ore: 3 });
        game.players[1].devCards = [{ type: 'victoryPoint', turn: 0 }];
        const view = createGameView(game, 0);
        expect(view.players[1].hand).toBeNull();
        expect(view.players[1].cardCount).toBe(3);
        expect(view.players[1].devCards).toBeNull();
        expect(view.players[1].points).toBe(game.points(1) - 1);
        expect(JSON.stringify(view)).not.toContain('devDeck"');
        expect(createGameView(game, 1).players[1].points).toBe(game.points(1));
    });
});

describe('再現', () => {
    it('操作の記録から同じゲームを再現できる', () => {
        const game = new Game(players(3).map(p => ({ ...p, isCPU: true })), { seed: 9 });
        for (let i = 0; i < 300 && game.phase !== 'end'; i++) runCpuStep(game);
        const copy = Game.replay(game.players.map(({ name, isCPU }) => ({ name, isCPU })), { seed: 9 }, game.commands);
        expect(copy.players.map(p => p.hand)).toEqual(game.players.map(p => p.hand));
        expect(copy.buildings).toEqual(game.buildings);
        expect(copy.robber).toBe(game.robber);
    });
});
