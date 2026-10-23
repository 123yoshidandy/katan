import { describe, it, expect } from 'vitest';
import Game, { RESOURCES } from '../public/js/game.js';
import { GEOMETRY, TERRAIN_NAMES } from '../public/js/board.js';
import { createGameView, hydrateGameView } from '../public/js/game-view.js';
import { coachPlan, resourceSources } from '../public/js/coach.js';

const humans = (n) => Array.from({ length: n }, (_, i) => ({ name: `P${i}`, isCPU: false }));
const viewOf = (game, seat) => hydrateGameView(createGameView(game, seat));
const hand = (cards = {}) => ({ wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0, ...cards });

// 初期配置をおすすめの手で済ませ、手番の人がサイコロを振ったあとのゲーム
function playing(seed) {
    const game = new Game(humans(3), { seed });
    while (game.phase === 'setup') {
        const seat = game.currentPlayerIndex;
        game.applyCommand(seat, createGameView(game, seat).options.suggestion.command);
    }
    game.applyCommand(game.currentPlayerIndex, { type: 'roll' });
    game.pending = null;
    return game;
}

// seat の建物が接する、資源の出るタイル
const ownHexes = (game, seat) => [...new Set(game.buildings.flatMap((b, v) => (b?.owner === seat ? GEOMETRY.vertices[v].hexes : [])))]
    .filter(id => game.board.hexes[id].number);

describe('作戦（今の目標）', () => {
    it('観戦・ゲームの終わりには出さない', () => {
        const game = playing(1);
        expect(coachPlan(viewOf(game, null))).toBeNull();
        game.phase = 'end';
        expect(coachPlan(viewOf(game, 0))).toBeNull();
    });

    it('初期配置では選び方と資源の使いみちを出す。道の段階の説明は、自分が道を置く番だけ', () => {
        const game = new Game(humans(3), { seed: 2 });
        const seat = game.currentPlayerIndex;
        const other = (seat + 1) % 3;
        expect(coachPlan(viewOf(game, seat))).toMatchObject({ kind: 'setup', title: '開拓地' });
        game.applyCommand(seat, createGameView(game, seat).options.suggestion.command);
        expect(coachPlan(viewOf(game, seat))).toMatchObject({ kind: 'setup', title: '道' });
        expect(coachPlan(viewOf(game, other))).toMatchObject({ kind: 'setup', title: '開拓地' });
        expect(coachPlan(viewOf(game, seat)).uses.flatMap(u => u.resources).sort()).toEqual([...RESOURCES].sort());
    });

    it('目標・理由・足りない資源・10点までの残りを出す（自分の番でなくても）', () => {
        const game = playing(5);
        const seat = (game.currentPlayerIndex + 1) % 3;
        game.players[seat].hand = hand({ wheat: 1 });
        const view = viewOf(game, seat);
        const plan = coachPlan(view);
        expect(plan.kind).toBe('goal');
        expect(plan.piece).toBe(view.options.goal.piece);
        expect(plan.remaining).toBe(10 - view.me.points);
        expect(plan.ready).toBe(false);
        const missing = view.options.goal.missing;
        expect(plan.needs.map(n => [n.resource, n.count])).toEqual(RESOURCES.filter(r => missing[r] > 0).map(r => [r, missing[r]]));
    });

    it('都市の目標では、都市の理由を出す', () => {
        const game = playing(5);
        const seat = game.currentPlayerIndex;
        game.players[seat].hand = hand({ wheat: 1 });
        const plan = coachPlan(viewOf(game, seat));
        expect(plan.piece).toBe('city');
        expect(plan.title).toBe('都市');
        expect(plan.reason).toContain('2倍');
        expect(plan.needs.map(n => [n.resource, n.count])).toEqual([['wheat', 1], ['ore', 3]]);
    });

    it('資源の出どころは、自分の建物が接するタイルの数字（出やすい順。盗賊がいれば blocked）', () => {
        const game = playing(7);
        const seat = game.currentPlayerIndex;
        const hexes = ownHexes(game, seat);
        game.robber = hexes[0];
        const sources = resourceSources(viewOf(game, seat), seat);
        RESOURCES.forEach(r => {
            const expected = hexes.filter(id => game.board.hexes[id].terrain === r);
            expect(sources[r].map(s => s.number).sort()).toEqual(expected.map(id => game.board.hexes[id].number).sort());
            const pips = sources[r].map(s => 6 - Math.abs(7 - s.number));
            expect(pips).toEqual([...pips].sort((a, b) => b - a));
        });
        const blocked = Object.values(sources).flat().filter(s => s.blocked);
        expect(blocked).toEqual([{ number: game.board.hexes[hexes[0]].number, blocked: true }]);
    });

    it('出るタイルがない資源は、出どころが空（画面では「交換で」）', () => {
        const game = playing(5);
        const seat = game.currentPlayerIndex;
        const sources = resourceSources(viewOf(game, seat), seat);
        const owned = new Set(ownHexes(game, seat).map(id => game.board.hexes[id].terrain));
        RESOURCES.filter(r => !owned.has(r)).forEach(r => expect(sources[r]).toEqual([]));
    });

    it('資源が揃っていれば ready', () => {
        const game = playing(5);
        const seat = game.currentPlayerIndex;
        game.players[seat].hand = hand({ wheat: 2, ore: 3 });
        const plan = coachPlan(viewOf(game, seat));
        expect(plan.ready).toBe(true);
        expect(plan.needs).toEqual([]);
    });

    it('注意：手札が8枚以上なら捨てる危険を、盗賊が自分のタイルにいればそのことを出す（騎士があれば動かせると添える。手札が優先）', () => {
        const game = playing(7);
        const seat = game.currentPlayerIndex;
        const hex = ownHexes(game, seat)[0];
        game.players[seat].hand = hand({ wood: 1 });
        game.robber = hex;
        expect(coachPlan(viewOf(game, seat)).note).toBe(`${game.board.hexes[hex].number}の${TERRAIN_NAMES[game.board.hexes[hex].terrain]}に盗賊`);
        game.players[seat].devCards = [{ type: 'knight', turn: 0 }];
        expect(coachPlan(viewOf(game, seat)).note).toBe(`${game.board.hexes[hex].number}に盗賊、騎士で動かす`);
        game.players[seat].hand = hand({ wood: 4, sheep: 4 });
        expect(coachPlan(viewOf(game, seat)).note).toBe('手札8枚、7で半減');
        game.players[seat].hand = hand({ wood: 1 });
        game.robber = game.board.hexes.findIndex(h => h.terrain === 'desert');
        expect(coachPlan(viewOf(game, seat)).note).toBeNull();
    });

    it('建てられるものがなければ、発展カードを目標にする', () => {
        const game = playing(5);
        const seat = game.currentPlayerIndex;
        game.players[seat].pieces = { road: 0, settlement: 0, city: 0 };
        game.players[seat].hand = hand({ sheep: 1 });
        const plan = coachPlan(viewOf(game, seat));
        expect(plan.piece).toBe('devCard');
        expect(plan.needs.map(n => [n.resource, n.count])).toEqual([['wheat', 1], ['ore', 1]]);
    });
});
