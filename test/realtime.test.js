import { describe, it, expect } from 'vitest';
import Game, { emptyCards, countCards } from '../public/js/game.js';
import { GEOMETRY } from '../public/js/board.js';
import { createGameView, hydrateGameView } from '../public/js/game-view.js';
import { runCpuStep, isCpuTurn } from '../public/js/cpu-player.js';

const players = (n, isCPU = false) => Array.from({ length: n }, (_, i) => ({ name: `P${i}`, isCPU }));
const cards = (partial) => ({ ...emptyCards(), ...partial });

// 初期配置を CPU の手で済ませた、リアルタイムモードのゲーム（第1巡が始まっている）
function afterSetup(n = 3, seed = 1) {
    const game = new Game(players(n), { seed, mode: 'realtime' });
    game.players.forEach(p => { p.isCPU = true; });
    while (game.phase === 'setup') runCpuStep(game);
    game.players.forEach(p => { p.isCPU = false; });
    // 7 で生まれた処理は片付けて、全員が自由に動ける状態にする
    game.queues = game.players.map(() => []);
    return game;
}

// 次の巡のサイコロの目を決める（[[d1, d2], ...] を席の順に）
function fixDice(game, dice) {
    const values = dice.flat().map(d => (d - 1) / 6 + 0.01);
    game.random = () => values.shift();
}

describe('リアルタイムモード', () => {
    it('初期配置は順番どおり。終わると第1巡が始まり、全員が同時にサイコロを振る', () => {
        const game = new Game(players(3), { seed: 4, mode: 'realtime' });
        expect(game.applyCommand((game.currentPlayerIndex + 1) % 3, { type: 'build', piece: 'settlement', at: 0 })).toBe(false);
        game.players.forEach(p => { p.isCPU = true; });
        while (game.phase === 'setup') runCpuStep(game);
        expect(game.phase).toBe('play');
        expect(game.turnNumber).toBe(1);
        expect(game.rolls.every(r => r && r.length === 2)).toBe(true);
        expect(game.done).toEqual([false, false, false]);
        expect(game.events.filter(e => e.type === 'roll').map(e => e.player)).toEqual([0, 1, 2]);
        expect(game.applyCommand(0, { type: 'roll' })).toBe(false);
    });

    it('どの人の目でも、全員が資源をもらう', () => {
        const game = afterSetup(3, 5);
        game.players.forEach(p => { p.hand = cards({}); });
        // 各人が自分の建物が接するタイルの数字を出せば、その人は必ず資源をもらう
        const numberOf = (seat) => GEOMETRY.hexes.find(h => game.board.hexes[h.id].number && h.id !== game.robber
            && h.vertices.some(v => game.buildings[v]?.owner === seat)).id;
        const dice = [0, 1, 2].map(seat => {
            const n = game.board.hexes[numberOf(seat)].number;
            return [Math.max(1, n - 6), Math.min(6, n - 1)];
        });
        fixDice(game, dice);
        [0, 1, 2].forEach(seat => game.applyCommand(seat, { type: 'endTurn' }));
        expect(game.turnNumber).toBe(2);
        game.players.forEach(p => expect(countCards(p.hand)).toBeGreaterThan(0));
    });

    it('全員が完了するまで次の巡に進まない。完了した人はもう操作できない', () => {
        const game = afterSetup(3);
        game.players[0].hand = cards({ wood: 1, brick: 1 });
        expect(game.applyCommand(1, { type: 'endTurn' })).toBe(true);
        expect(game.applyCommand(1, { type: 'endTurn' })).toBe(false);
        expect(game.applyCommand(2, { type: 'endTurn' })).toBe(true);
        expect(game.turnNumber).toBe(1);
        // 手番の人でなくても建てられる
        const edge = game.roadSpots(0)[0];
        expect(game.applyCommand(0, { type: 'build', piece: 'road', at: edge })).toBe(true);
        expect(game.applyCommand(0, { type: 'endTurn' })).toBe(true);
        expect(game.turnNumber).toBe(2);
        expect(game.done).toEqual([false, false, false]);
    });

    it('同じ場所は早い者勝ち', () => {
        const game = afterSetup(2);
        // 2人とも道をつなげられる、空いた辺を作る
        const edge = GEOMETRY.edges.find(e => {
            if (game.roads[e.id] !== null || game.buildings[e.a] || game.buildings[e.b]) return false;
            const free = (v) => GEOMETRY.vertices[v].edges.filter(x => x !== e.id && game.roads[x] === null);
            return free(e.a).length > 0 && free(e.b).length > 0;
        });
        const side = (v) => GEOMETRY.vertices[v].edges.find(x => x !== edge.id && game.roads[x] === null);
        game.roads[side(edge.a)] = 0;
        game.roads[side(edge.b)] = 1;
        game.players[0].hand = cards({ wood: 1, brick: 1 });
        game.players[1].hand = cards({ wood: 1, brick: 1 });
        expect(game.applyCommand(1, { type: 'build', piece: 'road', at: edge.id })).toBe(true);
        expect(game.applyCommand(0, { type: 'build', piece: 'road', at: edge.id })).toBe(false);
        expect(game.players[0].hand).toEqual(cards({ wood: 1, brick: 1 }));
    });

    it('7 で捨てるかは、同じ巡に出たほかの目の資源をもらったあとの手札で数える', () => {
        const game = afterSetup(3, 2);
        // 1番の建物が接する、数字のあるタイル（盗賊のいないもの）
        const hexId = game.buildings
            .flatMap((b, v) => (b?.owner === 1 ? GEOMETRY.vertices[v].hexes : []))
            .find(id => game.board.hexes[id].number && id !== game.robber);
        const n = game.board.hexes[hexId].number;
        game.players[0].hand = cards({});
        game.players[1].hand = cards({ wood: 7 }); // 7枚。資源をもらう前に数えれば、捨てずに済む
        game.players[2].hand = cards({});
        fixDice(game, [[3, 4], [Math.max(1, n - 6), Math.min(6, n - 1)], [3, 4]]); // 0番と2番が7、1番の目で1番に資源が入る
        [0, 1, 2].forEach(seat => game.applyCommand(seat, { type: 'endTurn' }));
        const total = countCards(game.players[1].hand);
        expect(total).toBeGreaterThan(7);
        expect(game.queues[1]).toEqual([{ type: 'discard', count: Math.floor(total / 2) }]);
    });

    it('7 が出たら、手札が8枚以上の人が半分捨て、7を出した人が盗賊を動かす。ほかの人は待たずに動ける', () => {
        const game = afterSetup(3, 2);
        game.players[0].hand = cards({ wood: 4, brick: 4 });
        game.players[1].hand = cards({ wood: 1, brick: 1 });
        game.players[2].hand = cards({ ore: 9 });
        fixDice(game, [[3, 4], [1, 1], [1, 1]]); // 0番が7
        [0, 1, 2].forEach(seat => game.applyCommand(seat, { type: 'endTurn' }));
        expect(game.queues[0].map(q => q.type)).toEqual(['discard', 'robber']);
        expect(game.queues[2]).toEqual([{ type: 'discard', count: 4 }]);
        expect(game.queues[1]).toEqual([]);
        // 7を出した人は、先に捨てて盗賊を動かすまで建てられない
        expect(game.applyCommand(0, { type: 'endTurn' })).toBe(false);
        // ほかの人は待たずに動ける
        const edge = game.roadSpots(1)[0];
        expect(game.applyCommand(1, { type: 'build', piece: 'road', at: edge })).toBe(true);
        expect(game.applyCommand(0, { type: 'discard', cards: { wood: 4 } })).toBe(true);
        const hex = GEOMETRY.hexes.map(h => h.id).find(id => id !== game.robber && game.robberVictims(0, id).length === 0);
        expect(game.applyCommand(0, { type: 'moveRobber', hex, victim: null })).toBe(true);
        expect(game.robber).toBe(hex);
        expect(game.applyCommand(0, { type: 'endTurn' })).toBe(true);
        // 捨てていない人がいると、その人は完了できない
        expect(game.applyCommand(2, { type: 'endTurn' })).toBe(false);
    });

    it('発展カードは1巡に1枚。買った巡には使えない', () => {
        const game = afterSetup(2);
        game.players[0].devCards = [{ type: 'yearOfPlenty', turn: 0 }, { type: 'monopoly', turn: 0 }, { type: 'knight', turn: 1 }];
        expect(game.playableDevCards(0)).toEqual(['yearOfPlenty', 'monopoly']);
        expect(game.applyCommand(0, { type: 'playDev', card: 'yearOfPlenty', resources: ['ore', 'ore'] })).toBe(true);
        expect(game.applyCommand(0, { type: 'playDev', card: 'monopoly', resource: 'ore' })).toBe(false);
        expect(game.playableDevCards(0)).toEqual([]);
        expect(game.applyCommand(0, { type: 'playDev', card: 'knight' })).toBe(false);
    });

    it('交渉は誰でも持ちかけられる。同時に進むのは1つまで', () => {
        const game = afterSetup(3);
        game.players[0].hand = cards({ ore: 1 });
        game.players[1].hand = cards({ wood: 2 });
        game.players[2].hand = cards({ wood: 1, ore: 1 });
        expect(game.applyCommand(1, { type: 'offerTrade', give: { wood: 1 }, get: { ore: 1 } })).toBe(true);
        expect(game.applyCommand(2, { type: 'offerTrade', give: { ore: 1 }, get: { wood: 1 } })).toBe(false);
        expect(game.applyCommand(0, { type: 'cancelTrade' })).toBe(false);
        const id = game.trade.id;
        expect(game.applyCommand(0, { type: 'respondTrade', id, accept: true })).toBe(true);
        expect(game.trade).toBeNull();
        expect(game.players[1].hand).toEqual(cards({ wood: 1, ore: 1 }));
        expect(game.players[0].hand).toEqual(cards({ wood: 1 }));
    });

    it('交渉を持ちかけた人が完了すると、交渉は取り下げになる。完了した人も交渉に答えられる', () => {
        const game = afterSetup(2);
        game.players[0].hand = cards({ ore: 1 });
        game.players[1].hand = cards({ wood: 1 });
        game.applyCommand(0, { type: 'endTurn' });
        expect(game.applyCommand(1, { type: 'offerTrade', give: { wood: 1 }, get: { ore: 1 } })).toBe(true);
        expect(game.actors()).toEqual([0, 1]);
        expect(game.applyCommand(0, { type: 'respondTrade', id: game.trade.id, accept: false })).toBe(true);
        expect(game.applyCommand(1, { type: 'endTurn' })).toBe(true);
        expect(game.trade).toBeNull();
    });

    it('CPU だけのゲームは2〜4人のどれでも最後まで進み、記録から同じゲームを再現できる', () => {
        for (let seed = 1; seed <= 9; seed++) {
            const list = players(2 + (seed % 3), true);
            const game = new Game(list, { seed, mode: 'realtime' });
            for (let i = 0; i < 20000 && isCpuTurn(game); i++) runCpuStep(game);
            expect(game.phase).toBe('end');
            expect(game.points(game.result.winnerId)).toBeGreaterThanOrEqual(10);
            const copy = Game.replay(list, { seed, mode: 'realtime' }, game.commands);
            expect(copy.result).toEqual(game.result);
            expect(copy.events).toEqual(game.events);
        }
    });

    it('全員がおすすめの手だけを打っても、どの場面でも手が通り、最後まで進む', () => {
        for (let seed = 1; seed <= 4; seed++) {
            const game = new Game(players(2 + (seed % 3)), { seed, mode: 'realtime' });
            for (let i = 0; i < 20000 && game.phase !== 'end'; i++) {
                const seat = game.actors().find(id => !(game.trade && id === game.trade.from)) ?? game.actors()[0];
                const suggestion = createGameView(game, seat).options.suggestion;
                expect(suggestion).not.toBeNull();
                expect(game.applyCommand(seat, suggestion.command), game.lastError).toBe(true);
            }
            expect(game.phase).toBe('end');
        }
    });

    it('ビュー：見ている人の処理と目だけを pending・dice に入れ、完了したかと全員の目を出す', () => {
        const game = afterSetup(3, 2);
        game.players[0].hand = cards({ wood: 4, brick: 4 });
        fixDice(game, [[3, 4], [2, 2], [5, 6]]);
        [0, 1, 2].forEach(seat => game.applyCommand(seat, { type: 'endTurn' }));
        game.applyCommand(1, { type: 'endTurn' });
        const view0 = hydrateGameView(createGameView(game, 0));
        const view1 = hydrateGameView(createGameView(game, 1));
        expect(view0.mode).toBe('realtime');
        expect(view0.pending).toEqual({ type: 'discard', remaining: { 0: 4 } });
        expect(view0.discardCount).toBe(4);
        expect(view1.pending).toBeNull();
        expect(view0.dice).toEqual([3, 4]);
        expect(view1.dice).toEqual([2, 2]);
        expect(view1.rolls).toEqual([[3, 4], [2, 2], [5, 6]]);
        expect(view1.done).toEqual([false, true, false]);
        expect(view0.isMyTurn).toBe(true);
        expect(view1.isMyTurn).toBe(false);
    });
});
