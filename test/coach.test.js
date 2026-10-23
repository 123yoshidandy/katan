import { describe, it, expect } from 'vitest';
import Game, { RESOURCES } from '../public/js/game.js';
import { GEOMETRY } from '../public/js/board.js';
import { createGameView, hydrateGameView } from '../public/js/game-view.js';
import { coachStory, resourceSources } from '../public/js/coach.js';

const humans = (n) => Array.from({ length: n }, (_, i) => ({ name: `P${i}`, isCPU: false }));
const viewOf = (game, seat) => hydrateGameView(createGameView(game, seat));
const hand = (cards = {}) => ({ wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0, ...cards });

// 部品の列を文字にする（資源は [ore]、数字の札は (5)、薄い図柄は [-ore]）
const text = (parts) => parts.map(p => {
    if (typeof p === 'string') return p;
    if (p.icon) return `[${p.dim ? '-' : ''}${p.icon}]`;
    if (p.chip) return `(${p.chip.number}${p.chip.blocked ? 'x' : ''})`;
    return '★';
}).join('');
const story = (game, seat, mode) => {
    const s = coachStory(viewOf(game, seat), mode);
    return s && { goal: text(s.goal), need: text(s.need), action: text(s.action), points: s.points };
};

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

describe('作戦（目標 → 必要 → だから）', () => {
    it('観戦・ゲームの終わりには出さない', () => {
        const game = playing(1);
        expect(coachStory(viewOf(game, null))).toBeNull();
        game.phase = 'end';
        expect(coachStory(viewOf(game, 0))).toBeNull();
    });

    it('初期配置：資源の出る場所を取る理由と、今置くもの', () => {
        const game = new Game(humans(3), { seed: 2 });
        const seat = game.currentPlayerIndex;
        const other = (seat + 1) % 3;
        expect(story(game, seat)).toMatchObject({ goal: '資源の出る場所に開拓地を置く', need: '資源は、出た目のタイルに接すると出る', action: '点の多い数字の近くに置く★' });
        expect(story(game, other).action).toBe('点の多い数字・違う資源の場所を探す');
        game.applyCommand(seat, createGameView(game, seat).options.suggestion.command);
        expect(story(game, seat).action).toBe('次の開拓地の方へ道を置く★');
    });

    it('都市が目標なら、材料（足りないものは薄く）と足りない枚数を出す', () => {
        const game = playing(5);
        const seat = game.currentPlayerIndex;
        game.players[seat].hand = hand({ wheat: 1 });
        const s = story(game, seat);
        expect(s.goal).toBe('都市で+1点・資源2倍');
        expect(s.need).toBe('[wheat][-wheat][-ore][-ore][-ore]小麦・鉄があと4枚');
        expect(s.points).toBe(10 - viewOf(game, seat).me.points);
    });

    it('だから：手番を終えるなら、足りない資源が出る自分の数字を待つ', () => {
        const game = playing(5);
        const seat = game.currentPlayerIndex;
        game.players[seat].hand = hand({ wheat: 1 });
        const view = viewOf(game, seat);
        expect(view.options.suggestion.command.type).toBe('endTurn');
        const sources = resourceSources(view, seat);
        const numbers = [...new Set([...sources.wheat, ...sources.ore].filter(s => !s.blocked).map(s => s.number))];
        const s = story(game, seat);
        if (numbers.length) expect(s.action).toMatch(/^手番を終え、(\(\d+\))+を待つ★$/);
        else expect(s.action).toBe('手番を終える。次は交換を狙う★');
    });

    it('だから：材料が揃えば建てる。銀行と交換できるなら、交換を勧める', () => {
        const game = playing(5);
        const seat = game.currentPlayerIndex;
        game.players[seat].hand = hand({ wheat: 2, ore: 3 });
        expect(story(game, seat)).toMatchObject({ need: '[wheat][wheat][ore][ore][ore]揃っている', action: '材料が揃ったので都市を建てる★' });
        game.players[seat].hand = hand({ wheat: 2, ore: 2, sheep: 4 });
        expect(story(game, seat).action).toMatch(/^余った\[sheep\]\d枚を\[ore\]に交換★$/);
    });

    it('建てる場所を選んでいる間は、光っている場所に建てると言う', () => {
        const game = playing(5);
        const seat = game.currentPlayerIndex;
        game.players[seat].hand = hand({ wheat: 2, ore: 3 });
        expect(story(game, seat, 'city').action).toBe('光っている場所に都市を建てる★');
    });

    it('相手の番：足りない資源が出る数字を待つ（揃っていれば次の番で建てる）', () => {
        const game = playing(5);
        const seat = (game.currentPlayerIndex + 1) % 3;
        game.players[seat].hand = hand({ wheat: 2, ore: 3 });
        expect(story(game, seat).action).toBe('揃った。次の番で建てる');
        game.players[seat].hand = hand();
        expect(story(game, seat).action).toMatch(/が出れば手に入る$|^自分の番に交換で手に入れる$/);
    });

    it('7で手札を捨てる・盗賊を動かすときは、その理由を出す', () => {
        const game = playing(5);
        const seat = game.currentPlayerIndex;
        game.pending = { type: 'robber' };
        expect(story(game, seat)).toMatchObject({ goal: '盗賊で相手の資源を止める', action: '点の多い相手のタイルを止める★' });
        game.players[seat].hand = hand({ wood: 4, sheep: 4 });
        game.pending = { type: 'discard', remaining: { [seat]: 4 } };
        expect(story(game, seat)).toMatchObject({ goal: '7が出た。手札を半分捨てる', action: '目標に使わない資源から4枚捨てる' });
    });

    it('交換の申し出には、受けるか断るかを理由と一緒に出す', () => {
        const game = playing(5);
        const from = game.currentPlayerIndex;
        const seat = (from + 1) % 3;
        game.players[from].hand = hand({ ore: 3 });
        game.players[seat].hand = hand({ wood: 1 });
        game.applyCommand(from, { type: 'offerTrade', give: { ore: 3 }, get: { wood: 1 } });
        const s = story(game, seat);
        expect(s.goal).toBe(`P${from}からの交換の申し出`);
        expect(s.need).toBe('[ore][ore][ore]をもらい[wood]を渡す');
        expect(s.action).toMatch(/^(目標に要る資源なので受ける|得にならないので断る)★$/);
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

    it('建てられるものがなければ、発展カードを目標にする', () => {
        const game = playing(5);
        const seat = game.currentPlayerIndex;
        game.players[seat].pieces = { road: 0, settlement: 0, city: 0 };
        game.players[seat].hand = hand({ sheep: 1 });
        const s = story(game, seat);
        expect(s.goal).toBe('発展カードで騎士・勝利点');
        expect(s.need).toBe('[sheep][-wheat][-ore]小麦・鉄があと2枚');
    });
});
