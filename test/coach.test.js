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
// 文章全体（今すること＝太字の文は 《》 で囲む）
const story = (game, seat, mode) => {
    const sentences = coachStory(viewOf(game, seat), mode);
    return sentences && sentences.map(x => (x.strong ? `《${text(x.parts)}》` : text(x.parts))).join('');
};
const action = (game, seat, mode) => story(game, seat, mode).match(/《(.*)》/)[1];

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

describe('作戦（状況の説明）', () => {
    it('観戦・ゲームの終わりには出さない', () => {
        const game = playing(1);
        expect(coachStory(viewOf(game, null))).toBeNull();
        game.phase = 'end';
        expect(coachStory(viewOf(game, 0))).toBeNull();
    });

    it('初期配置：資源の入り方と、今置くもの', () => {
        const game = new Game(humans(3), { seed: 2 });
        const seat = game.currentPlayerIndex;
        const other = (seat + 1) % 3;
        expect(story(game, seat)).toBe('資源は、サイコロで出た数字のタイルに接する開拓地に入ります。《7に近い数字（6・8は赤）の近くに置くと、よく集まります★》');
        expect(story(game, other)).toBe('資源は、サイコロで出た数字のタイルに接する開拓地に入ります。7に近い数字の近くが狙い目です。');
        game.applyCommand(seat, createGameView(game, seat).options.suggestion.command);
        expect(story(game, seat)).toBe('開拓地は、道の先にしか建てられません。《次に開拓地を置きたい方へ、道を伸ばします★》');
    });

    it('都市を目指す理由・足りない資源（足りない材料は薄く）・今することがつながる', () => {
        const game = playing(5);
        const seat = game.currentPlayerIndex;
        game.players[seat].pieces.road = 0; // 道を使い切り、広げる先がない（都市を目指す）
        game.players[seat].hand = hand({ wheat: 1 });
        const view = viewOf(game, seat);
        expect(view.options.suggestion.command.type).toBe('endTurn');
        const sources = resourceSources(view, seat);
        const numbers = [...sources.wheat, ...sources.ore].filter(x => !x.blocked);
        const text = story(game, seat);
        expect(text.startsWith('都市にすると1点増え、資源も2倍です。[wheat][-wheat][-ore][-ore][-ore]のうち、小麦と鉄があと4枚足りません。')).toBe(true);
        if (numbers.length) expect(action(game, seat)).toMatch(/^(\(\d+\))+で出るので、手番を終えて待ちます★$/);
        else expect(action(game, seat)).toBe('出るタイルがないので、交換で手に入れます。今は手番を終えます★');
    });

    it('材料が揃えば建てる。銀行と交換すれば揃うなら、交換を勧める', () => {
        const game = playing(5);
        const seat = game.currentPlayerIndex;
        game.players[seat].pieces.road = 0; // 道を使い切り、広げる先がない（都市を目指す）
        game.players[seat].hand = hand({ wheat: 2, ore: 3 });
        expect(story(game, seat)).toBe('都市にすると1点増え、資源も2倍です。材料は揃っています。《なので、都市を建てます★》');
        game.players[seat].hand = hand({ wheat: 2, ore: 2, sheep: 4 });
        expect(action(game, seat)).toMatch(/^余っている\[sheep\]\d枚を、銀行で\[ore\]に換えれば揃います★$/);
    });

    it('交換で揃わなくても、余っている資源は足りない資源に換える', () => {
        const game = playing(5);
        const seat = game.currentPlayerIndex;
        game.players[seat].pieces.road = 0; // 道を使い切り、広げる先がない（都市を目指す）
        game.players[seat].hand = hand({ sheep: 5 });
        expect(createGameView(game, seat).options.suggestion.command).toMatchObject({ type: 'bankTrade', give: 'sheep' });
        expect(action(game, seat)).toMatch(/^余っている\[sheep\]\d枚を、銀行で\[(ore|wheat)\]に換えて、足りない分を減らします★$/);
    });

    it('目指すもののほかに材料が揃っている物を建てるときは、先に建てると言う（道は木材・レンガが2枚ずつあるとき）', () => {
        let found = 0;
        for (let seed = 1; seed <= 6; seed++) {
            const game = new Game(humans(3), { seed });
            for (let i = 0; i < 3000 && game.phase !== 'end'; i++) {
                const seat = game.actors()[0];
                const view = viewOf(game, seat);
                const { command } = view.options.suggestion;
                const goal = view.options.goal?.piece;
                if (game.phase === 'play' && command.type === 'build' && goal && command.piece !== goal && !game.pendingOf?.(seat)) {
                    found++;
                    expect(action(game, seat)).toBe(`${{ road: '道', settlement: '開拓地', city: '都市' }[command.piece]}の材料が揃っているので、先に建てます★`);
                    if (command.piece === 'road') {
                        expect(game.players[seat].hand.wood).toBeGreaterThanOrEqual(2);
                        expect(game.players[seat].hand.brick).toBeGreaterThanOrEqual(2);
                    }
                }
                expect(game.applyCommand(seat, command), game.lastError).toBe(true);
            }
        }
        expect(found).toBeGreaterThan(0);
    });

    it('建てる場所を選んでいる間は、光っている場所から選ぶと言う', () => {
        const game = playing(5);
        const seat = game.currentPlayerIndex;
        game.players[seat].hand = hand({ wheat: 2, ore: 3 });
        expect(action(game, seat, 'city')).toBe('光っている場所から、都市を建てる場所を選びます★');
    });

    it('相手の番：足りない資源が出る数字を待つ（揃っていれば次の番で建てる）', () => {
        const game = playing(5);
        const seat = (game.currentPlayerIndex + 1) % 3;
        game.players[seat].hand = hand({ wheat: 2, ore: 3 });
        expect(action(game, seat)).toBe('次の自分の番で建てられます');
        game.players[seat].hand = hand();
        expect(action(game, seat)).toMatch(/が出れば手に入ります$|^出るタイルがないので、自分の番に交換します$/);
    });

    it('7で手札を捨てる・盗賊を動かすときは、そのしくみと今することを言う', () => {
        const game = playing(5);
        const seat = game.currentPlayerIndex;
        game.pending = { type: 'robber' };
        expect(story(game, seat)).toBe('盗賊を置いたタイルは資源が出なくなり、そこに建物を持つ人から1枚奪えます。《得点の多い相手のタイルを狙います★》');
        game.players[seat].hand = hand({ wood: 4, sheep: 4 });
        game.pending = { type: 'discard', remaining: { [seat]: 4 } };
        expect(story(game, seat)).toBe('7が出たとき、手札が8枚以上あると半分を捨てます。《次に建てたい物に使わない資源から、4枚捨てます》');
    });

    it('交換の申し出には、何を渡して何をもらうかと、受けるか断るかを言う', () => {
        const game = playing(5);
        const from = game.currentPlayerIndex;
        const seat = (from + 1) % 3;
        game.players[from].hand = hand({ ore: 3 });
        game.players[seat].hand = hand({ wood: 1 });
        game.applyCommand(from, { type: 'offerTrade', give: { ore: 3 }, get: { wood: 1 } });
        expect(story(game, seat)).toMatch(new RegExp(`^P${from}が、\\[ore\\]\\[ore\\]\\[ore\\]を渡すので\\[wood\\]がほしいそうです。《(欲しい資源が手に入るので、受けます|得にならないので、断ります)★》$`));
    });

    it('資源の出どころは、自分の建物が接するタイルの数字（出やすい順。盗賊がいれば blocked）', () => {
        const game = playing(7);
        const seat = game.currentPlayerIndex;
        const hexes = ownHexes(game, seat);
        game.robber = hexes[0];
        const sources = resourceSources(viewOf(game, seat), seat);
        RESOURCES.forEach(r => {
            const expected = hexes.filter(id => game.board.hexes[id].terrain === r);
            expect(sources[r].map(x => x.number).sort()).toEqual(expected.map(id => game.board.hexes[id].number).sort());
            const pips = sources[r].map(x => 6 - Math.abs(7 - x.number));
            expect(pips).toEqual([...pips].sort((a, b) => b - a));
        });
        const blocked = Object.values(sources).flat().filter(x => x.blocked);
        expect(blocked).toEqual([{ number: game.board.hexes[hexes[0]].number, blocked: true }]);
    });

    it('建てられるものがなければ、発展カードを目指す', () => {
        const game = playing(5);
        const seat = game.currentPlayerIndex;
        game.players[seat].pieces = { road: 0, settlement: 0, city: 0 };
        game.players[seat].hand = hand({ sheep: 1 });
        expect(story(game, seat).startsWith('建てる物がないので、発展カードを集めます。[sheep][-wheat][-ore]のうち、小麦と鉄があと2枚足りません。')).toBe(true);
    });
});
