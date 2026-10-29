import { describe, it, expect } from 'vitest';
import Game from '../public/js/game.js';
import { runCpuStep, cpuActor } from '../public/js/cpu-player.js';

const cpus = (n) => Array.from({ length: n }, (_, i) => ({ name: `CPU${i}`, isCPU: true }));

describe('CPU', () => {
    it('CPU だけのゲームは、2〜4人のどれでも最後まで進む', () => {
        for (let seed = 1; seed <= 15; seed++) {
            const game = new Game(cpus(2 + (seed % 3)), { seed });
            for (let i = 0; i < 20000 && game.phase !== 'end'; i++) runCpuStep(game);
            expect(game.phase).toBe('end');
            expect(game.points(game.result.winnerId)).toBeGreaterThanOrEqual(10);
        }
    });

    it('人間の番では動かず、人間が持ちかけた交渉には CPU が答える', () => {
        const game = new Game([{ name: '人', isCPU: false }, { name: 'CPU', isCPU: true }], { seed: 2 });
        game.players.forEach(p => { p.isCPU = true; });
        while (game.phase === 'setup') runCpuStep(game);
        game.players[0].isCPU = false;
        while (game.currentPlayerIndex !== 0) runCpuStep(game);
        expect(cpuActor(game)).toBeNull();

        game.applyCommand(0, { type: 'roll' });
        game.pending = null;
        game.players[0].hand = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 3 };
        game.players[1].hand = { wood: 1, brick: 0, sheep: 0, wheat: 0, ore: 0 };
        game.applyCommand(0, { type: 'offerTrade', give: { ore: 3 }, get: { wood: 1 } });
        expect(cpuActor(game)).toBe(1);
        // 得な交渉なので受け、その場で交換が成立する
        runCpuStep(game);
        expect(game.trade).toBeNull();
        expect(game.players[0].hand.wood).toBe(1);
        expect(cpuActor(game)).toBeNull();
    });

    it('部屋を出た人の手番は、代わりに CPU が打つ', () => {
        const game = new Game([{ name: 'A', isCPU: false }, { name: 'B', isCPU: false }], { seed: 4 });
        expect(cpuActor(game)).toBeNull();
        game.applyCommand(game.currentPlayerIndex, { type: 'proxy' });
        expect(cpuActor(game)).toBe(game.currentPlayerIndex);
    });
});
