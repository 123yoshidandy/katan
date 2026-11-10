import { describe, it, expect } from 'vitest';
import Game from '../public/js/game.js';
import { runCpuStep, cpuActor, chooseCommand, chooseCpuCommand, suggest } from '../public/js/cpu-player.js';

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

    it('交渉には人間が先に答え、CPU は人間がみな答えてから答える', () => {
        const game = new Game([{ name: '人A', isCPU: false }, { name: '人B', isCPU: false }, { name: 'CPU', isCPU: true }], { seed: 2 });
        game.players.forEach(p => { p.isCPU = true; });
        while (game.phase === 'setup') runCpuStep(game);
        game.players[0].isCPU = false;
        game.players[1].isCPU = false;
        while (game.currentPlayerIndex !== 0) {
            if (cpuActor(game) === null) game.applyCommand(game.currentPlayerIndex, game.rolled ? { type: 'endTurn' } : { type: 'roll' });
            else runCpuStep(game);
            game.pending = null;
        }
        if (!game.rolled) game.applyCommand(0, { type: 'roll' });
        game.pending = null;
        game.players[0].hand = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 3 };
        game.players[2].hand = { wood: 1, brick: 0, sheep: 0, wheat: 0, ore: 0 };
        game.applyCommand(0, { type: 'offerTrade', give: { ore: 3 }, get: { wood: 1 } });
        expect(cpuActor(game)).toBeNull();
        // 人間が受ければ、CPU より先に交換が決まる
        game.players[1].hand = { wood: 1, brick: 0, sheep: 0, wheat: 0, ore: 0 };
        game.applyCommand(1, { type: 'respondTrade', id: game.trade.id, accept: false });
        expect(cpuActor(game)).toBe(2);
    });

    it('実際に打つ CPU は見落とすが、同じ手番の中では考えが変わらない。アシストのおすすめは見落とさない', () => {
        let differs = 0;
        for (let seed = 1; seed <= 20; seed++) {
            const game = new Game(cpus(4), { seed });
            // 初期配置の1つ目：見落としのない手は、一番良い場所
            const sharp = chooseCommand(game, game.currentPlayerIndex);
            const casual = chooseCpuCommand(game, game.currentPlayerIndex);
            expect(chooseCpuCommand(game, game.currentPlayerIndex)).toEqual(casual);
            expect(suggest(game, game.currentPlayerIndex).command).toEqual(sharp);
            if (casual.at !== sharp.at) differs++;
        }
        expect(differs).toBeGreaterThan(0);
        expect(differs).toBeLessThan(20);
    });

    it('盗賊は、点の高い人ばかりを狙わない', () => {
        const targets = new Map();
        for (let seed = 1; seed <= 40; seed++) {
            const game = new Game(cpus(3), { seed });
            while (game.phase === 'setup') runCpuStep(game);
            game.players.forEach(p => { p.hand = { wood: 1, brick: 1, sheep: 1, wheat: 1, ore: 1 }; });
            // 1番を大きく先行させ、0番が騎士で盗賊を動かす
            game.longestRoad = 1;
            game.largestArmy = 1;
            game.currentPlayerIndex = 0;
            game.pending = { type: 'robber' };
            [['casual', chooseCpuCommand], ['sharp', chooseCommand]].forEach(([kind, choose]) => {
                const { victim } = choose(game, 0);
                if (victim !== null) targets.set(`${kind}${victim}`, (targets.get(`${kind}${victim}`) ?? 0) + 1);
            });
        }
        // 見落としのない手（アシスト）は先行する1番を狙うが、実際に打つ CPU は2番も同じくらい狙う
        expect(targets.get('sharp1')).toBeGreaterThan(targets.get('sharp2') ?? 0);
        expect(targets.get('casual2')).toBeGreaterThan(targets.get('casual1') / 2);
    });

    it('部屋を出た人の手番は、代わりに CPU が打つ', () => {
        const game = new Game([{ name: 'A', isCPU: false }, { name: 'B', isCPU: false }], { seed: 4 });
        expect(cpuActor(game)).toBeNull();
        game.applyCommand(game.currentPlayerIndex, { type: 'proxy' });
        expect(cpuActor(game)).toBe(game.currentPlayerIndex);
    });
});
