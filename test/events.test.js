import { describe, it, expect } from 'vitest';
import Game, { emptyCards, countCards, RESOURCES } from '../public/js/game.js';
import { GEOMETRY } from '../public/js/board.js';
import { createGameView } from '../public/js/game-view.js';
import { runCpuStep } from '../public/js/cpu-player.js';

const players = (n, isCPU = false) => Array.from({ length: n }, (_, i) => ({ name: `P${i}`, isCPU }));
const cards = (partial) => ({ ...emptyCards(), ...partial });
const hands = (game) => game.players.map(p => ({ ...p.hand }));
const newEvents = (game, since) => game.events.filter(e => e.id > since);

function afterSetup(n = 3, seed = 1) {
    const game = new Game(players(n), { seed });
    game.players.forEach(p => { p.isCPU = true; });
    while (game.phase === 'setup') runCpuStep(game);
    game.players.forEach(p => { p.isCPU = false; });
    return game;
}

// CPU だけの試合を最後まで（か上限まで）進める
function cpuGame(n, seed, steps = 3000) {
    const game = new Game(players(n, true), { seed });
    for (let i = 0; i < steps && game.phase !== 'end'; i++) runCpuStep(game);
    return game;
}

describe('イベントの記録', () => {
    it('初期配置で建てたものと、2つ目の開拓地でもらった資源をタイルごとに記録する', () => {
        const game = new Game(players(2, true), { seed: 4 });
        while (game.phase === 'setup') runCpuStep(game);
        const builds = game.events.filter(e => e.type === 'build');
        expect(builds).toHaveLength(8);
        builds.forEach(e => expect(e.cost).toBeNull());
        const produced = game.events.filter(e => e.type === 'produce').flatMap(e => e.gains);
        // もらった資源の合計が手札と一致し、どれも開拓地の隣のタイルから来ている
        game.players.forEach(p => {
            const total = emptyCards();
            produced.filter(g => g.player === p.id).forEach(g => {
                total[g.resource] += g.count;
                const vertex = game.buildings.findIndex((b, v) => b?.owner === p.id && GEOMETRY.vertices[v].hexes.includes(g.hex));
                expect(vertex).toBeGreaterThanOrEqual(0);
                expect(game.board.hexes[g.hex].terrain).toBe(g.resource);
            });
            expect(total).toEqual(p.hand);
        });
    });

    it('サイコロと生産：出た目と、どのタイルから誰に何枚かを記録し、手札の増え方と一致する', () => {
        let checked = 0;
        for (let seed = 1; seed <= 30 && checked < 5; seed++) {
            const game = afterSetup(3, seed);
            const id = game.currentPlayerIndex;
            const before = hands(game);
            const since = game.eventSerial;
            expect(game.applyCommand(id, { type: 'roll' })).toBe(true);
            const events = newEvents(game, since);
            expect(events[0]).toMatchObject({ type: 'roll', player: id, dice: game.dice });
            const sum = game.dice[0] + game.dice[1];
            if (sum === 7) continue;
            const produce = events.find(e => e.type === 'produce');
            const gained = game.players.map(() => emptyCards());
            (produce?.gains ?? []).forEach(g => {
                expect(game.board.hexes[g.hex]).toMatchObject({ number: sum, terrain: g.resource });
                expect(g.hex).not.toBe(game.robber);
                gained[g.player][g.resource] += g.count;
            });
            game.players.forEach((p, i) => {
                RESOURCES.forEach(r => expect(p.hand[r] - before[i][r]).toBe(gained[i][r]));
            });
            if (produce) checked++;
        }
        expect(checked).toBeGreaterThan(0);
    });

    it('建設：払った資源と置いた場所を記録する', () => {
        const game = afterSetup(2, 2);
        const id = game.currentPlayerIndex;
        game.applyCommand(id, { type: 'roll' });
        game.pending = null;
        game.players[id].hand = cards({ wood: 1, brick: 1 });
        const edge = game.roadSpots(id)[0];
        const since = game.eventSerial;
        expect(game.applyCommand(id, { type: 'build', piece: 'road', at: edge })).toBe(true);
        expect(newEvents(game, since)[0]).toMatchObject({ type: 'build', player: id, piece: 'road', at: edge, cost: { wood: 1, brick: 1 } });
    });

    it('盗賊と奪ったカード、捨てたカード、交換、発展カードを記録する', () => {
        const game = afterSetup(3, 1);
        const id = game.currentPlayerIndex;
        const other = (id + 1) % 3;
        game.applyCommand(id, { type: 'roll' });
        game.pending = null;

        // 7 で手札を捨てる
        game.players[other].hand = cards({ wood: 4, ore: 4 });
        game.pending = { type: 'discard', remaining: { [other]: 4 } };
        let since = game.eventSerial;
        expect(game.applyCommand(other, { type: 'discard', cards: { wood: 2, ore: 2 } })).toBe(true);
        expect(newEvents(game, since)).toEqual([{ id: since + 1, type: 'discard', player: other, cards: cards({ wood: 2, ore: 2 }) }]);

        // 盗賊を動かして奪う
        const hex = GEOMETRY.hexes.find(h => h.id !== game.robber && game.robberVictims(id, h.id).includes(other))?.id;
        if (hex !== undefined) {
            const from = game.robber;
            since = game.eventSerial;
            expect(game.applyCommand(id, { type: 'moveRobber', hex, victim: other })).toBe(true);
            const [robber, steal] = newEvents(game, since);
            expect(robber).toMatchObject({ type: 'robber', player: id, from, to: hex });
            expect(steal).toMatchObject({ type: 'steal', from: other, to: id });
            expect(RESOURCES).toContain(steal.resource);
        } else {
            game.pending = null;
        }

        // 銀行との交換
        game.players[id].hand = cards({ wheat: 4, sheep: 1, ore: 1 });
        since = game.eventSerial;
        expect(game.applyCommand(id, { type: 'bankTrade', give: 'wheat', get: 'brick' })).toBe(true);
        expect(newEvents(game, since)[0]).toMatchObject({ type: 'bankTrade', player: id, give: 'wheat', count: game.tradeRatio(id, 'wheat'), get: 'brick' });

        // 発展カードの購入
        game.players[id].hand = cards({ wheat: 1, sheep: 1, ore: 1 });
        since = game.eventSerial;
        expect(game.applyCommand(id, { type: 'buyDevCard' })).toBe(true);
        expect(newEvents(game, since)[0]).toMatchObject({ type: 'buyDev', player: id, card: game.players[id].devCards.at(-1).type });

        // プレイヤーどうしの交換
        game.players[id].hand = cards({ wood: 1 });
        game.players[other].hand = cards({ ore: 1 });
        game.applyCommand(id, { type: 'offerTrade', give: { wood: 1 }, get: { ore: 1 } });
        game.applyCommand(other, { type: 'respondTrade', id: game.trade.id, accept: true });
        since = game.eventSerial;
        expect(game.applyCommand(id, { type: 'confirmTrade', id: game.trade.id, with: other })).toBe(true);
        expect(newEvents(game, since)).toEqual([{ id: since + 1, type: 'trade', from: id, to: other, give: cards({ wood: 1 }), get: cards({ ore: 1 }) }]);
    });

    it('独占と収穫：使ったカードと、誰から何枚集めたかを記録する', () => {
        const game = afterSetup(3, 1);
        const id = game.currentPlayerIndex;
        const [b, c] = [(id + 1) % 3, (id + 2) % 3];
        game.applyCommand(id, { type: 'roll' });
        game.pending = null;
        game.players[id].devCards = [{ type: 'monopoly', turn: 0 }];
        game.players[b].hand = cards({ sheep: 3 });
        game.players[c].hand = cards({ wood: 2 });
        let since = game.eventSerial;
        expect(game.applyCommand(id, { type: 'playDev', card: 'monopoly', resource: 'sheep' })).toBe(true);
        expect(newEvents(game, since).map(({ id: _, ...e }) => e)).toEqual([
            { type: 'playDev', player: id, card: 'monopoly' },
            { type: 'monopoly', player: id, resource: 'sheep', taken: [{ player: b, count: 3 }] }
        ]);

        game.devPlayed = false;
        game.players[id].devCards = [{ type: 'yearOfPlenty', turn: 0 }];
        since = game.eventSerial;
        expect(game.applyCommand(id, { type: 'playDev', card: 'yearOfPlenty', resources: ['ore', 'ore'] })).toBe(true);
        expect(newEvents(game, since).map(({ id: _, ...e }) => e)).toEqual([
            { type: 'playDev', player: id, card: 'yearOfPlenty' },
            { type: 'gain', player: id, cards: cards({ ore: 2 }) }
        ]);
    });

    it('断った操作ではイベントが増えない', () => {
        const game = afterSetup(3, 1);
        const id = game.currentPlayerIndex;
        const since = game.eventSerial;
        expect(game.applyCommand(id, { type: 'build', piece: 'road', at: 0 })).toBe(false);
        expect(game.applyCommand((id + 1) % 3, { type: 'roll' })).toBe(false);
        expect(game.applyCommand(id, { type: 'endTurn' })).toBe(false);
        expect(game.eventSerial).toBe(since);
    });

    it('CPU だけの試合で全種類が出て、通し番号は1ずつ増え、持つのは最近の分だけ', () => {
        const seen = new Set();
        for (let seed = 1; seed <= 6; seed++) {
            const game = cpuGame(3 + (seed % 2), seed);
            game.events.forEach((e, i) => { if (i > 0) expect(e.id).toBe(game.events[i - 1].id + 1); });
            expect(game.events.at(-1).id).toBe(game.eventSerial);
            expect(game.events.length).toBeLessThanOrEqual(40);
            // 途中のイベントも数えるため、毎手の分を集め直す
            const replayed = new Game(players(3 + (seed % 2), true), { seed });
            let last = 0;
            game.commands.forEach(({ playerId, ...command }) => {
                replayed.applyCommand(playerId, command);
                newEvents(replayed, last).forEach(e => seen.add(e.type));
                last = replayed.eventSerial;
            });
        }
        ['roll', 'produce', 'build', 'robber', 'steal', 'discard', 'buyDev', 'playDev', 'bankTrade', 'award']
            .forEach(type => expect(seen, type).toContain(type));
    });

    it('記録から再現すると、同じイベントになる', () => {
        for (let seed = 1; seed <= 4; seed++) {
            const game = cpuGame(4, seed, 1500);
            const copy = Game.replay(game.players.map(({ name, isCPU }) => ({ name, isCPU })), { seed }, game.commands);
            expect(copy.events).toEqual(game.events);
            expect(copy.eventSerial).toBe(game.eventSerial);
        }
    });
});

describe('ビューのイベント', () => {
    it('最後の番号と最近のイベントを入れ、JSON にできる', () => {
        const game = cpuGame(3, 2, 400);
        const view = createGameView(game, 0);
        expect(view.eventId).toBe(game.eventSerial);
        expect(view.events.at(-1).id).toBe(game.eventSerial);
        expect(view.events.length).toBeLessThanOrEqual(20);
        expect(JSON.parse(JSON.stringify(view.events))).toEqual(view.events);
    });

    it('奪ったカードは奪った人と奪われた人だけ、捨てたカードは本人だけ、買った発展カードは本人だけが見える', () => {
        const game = afterSetup(3, 1);
        const event = (type, data) => {
            game.emit(type, data);
            return game.events.at(-1).id;
        };
        const steal = event('steal', { from: 1, to: 2, resource: 'ore' });
        const discard = event('discard', { player: 1, cards: cards({ wood: 2, brick: 2 }) });
        const buy = event('buyDev', { player: 2, card: 'victoryPoint', cost: cards({ sheep: 1, wheat: 1, ore: 1 }) });
        const find = (view, id) => view.events.find(e => e.id === id);

        const v0 = createGameView(game, 0);
        const v1 = createGameView(game, 1);
        const v2 = createGameView(game, 2);
        const spectator = createGameView(game, null);

        expect(find(v1, steal).resource).toBe('ore');
        expect(find(v2, steal).resource).toBe('ore');
        expect(find(v0, steal).resource).toBeNull();
        expect(find(spectator, steal).resource).toBeNull();

        expect(find(v1, discard)).toMatchObject({ cards: cards({ wood: 2, brick: 2 }), count: 4 });
        expect(find(v0, discard)).toMatchObject({ cards: null, count: 4 });
        expect(find(v2, discard)).toMatchObject({ cards: null, count: 4 });

        expect(find(v2, buy).card).toBe('victoryPoint');
        expect(find(v0, buy).card).toBeNull();
        expect(find(v1, buy).card).toBeNull();

        // 伏せた中身が、ほかの項目にも残っていない
        expect(JSON.stringify(find(v0, steal))).not.toContain('ore');
        expect(JSON.stringify(find(v0, buy))).not.toContain('victoryPoint');
        // ゲームの記録そのものは書き換えない
        expect(game.events.find(e => e.id === steal).resource).toBe('ore');
    });
});
