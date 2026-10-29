import { describe, it, expect, vi, afterEach } from 'vitest';
import LocalGameController from '../public/js/game-controller.js';
import Game, { emptyCards } from '../public/js/game.js';
import { runCpuStep } from '../public/js/cpu-player.js';

const cards = (partial) => ({ ...emptyCards(), ...partial });

// 初期配置を済ませ、サイコロを振ったゲームを、手番の人だけ人間にしてコントローラーに載せる
function controllerAfterRoll() {
    vi.useFakeTimers();
    const controller = new LocalGameController([{ name: 'P0', isCPU: false }, { name: 'P1', isCPU: true }, { name: 'P2', isCPU: true }]);
    controller.stop();
    const game = new Game(controller.game.players.map(p => ({ name: p.name, isCPU: true })), { seed: 1 });
    while (game.phase === 'setup') runCpuStep(game);
    const human = game.currentPlayerIndex;
    game.players[human].isCPU = false;
    game.applyCommand(human, { type: 'roll' });
    game.pending = null;
    controller.game = game;
    return { controller, game, human };
}

afterEach(() => vi.useRealTimers());

describe('ローカル対戦のコントローラー', () => {
    it('CPU は交渉を持ちかけられてから 2〜4 秒たってから返事をする', () => {
        const { controller, game, human } = controllerAfterRoll();
        game.players.forEach(p => { p.hand = cards({ wood: 2, ore: 2 }); });
        expect(controller.send({ type: 'offerTrade', give: { wood: 1 }, get: { ore: 1 } })).toBe(true);
        const trade = game.trade;

        vi.advanceTimersByTime(1999);
        expect(game.trade).toBe(trade);
        expect(trade.responses).toEqual({});

        vi.advanceTimersByTime(2001 + 700);
        const others = game.players.filter(p => p.id !== human).map(p => p.id);
        expect(game.trade === null || others.every(id => trade.responses[id])).toBe(true);
        controller.stop();
    });
});
