import { describe, it, expect, vi, afterEach } from 'vitest';

// CPU の考えで例外が出る場合を作る（初期配置だけは本物の手で進める）
const real = await vi.importActual('../public/js/cpu-player.js');
let broken = false;
vi.mock('../public/js/cpu-player.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        runCpuStep: (game, ...rest) => {
            if (broken) throw new Error('CPU の考えで例外');
            return actual.runCpuStep(game, ...rest);
        }
    };
});

const { default: LocalGameController, simpleCommands } = await import('../public/js/game-controller.js');

afterEach(() => {
    broken = false;
    vi.useRealTimers();
});

describe('ローカル対戦のコントローラー', () => {
    it('CPU の手で例外が出ても止まらず、3回進まなければ「番を終える」で抜ける', () => {
        vi.useFakeTimers();
        const cpus = [0, 1, 2].map(i => ({ name: `CPU${i}`, isCPU: true }));
        const controller = new LocalGameController(cpus);
        controller.stop();
        const game = controller.game;
        while (game.phase === 'setup') real.runCpuStep(game);
        game.applyCommand(game.currentPlayerIndex, { type: 'roll' });
        game.pending = null;
        const current = game.currentPlayerIndex;

        broken = true;
        vi.spyOn(console, 'error').mockImplementation(() => {});
        controller.scheduleCpu();
        vi.advanceTimersByTime(700 * 2);
        expect(game.currentPlayerIndex).toBe(current);
        vi.advanceTimersByTime(700);
        expect(game.currentPlayerIndex).not.toBe(current);
        // 抜けたあとも、次の手が予約されている
        expect(vi.getTimerCount()).toBe(1);
        controller.stop();
    });

    it('リアルタイムモードの初期配置では、CPU は人間が場所を選ぶくらいの間を置いて1つずつ置く', () => {
        vi.useFakeTimers();
        const players = [{ name: '人', isCPU: false }, { name: 'CPU1', isCPU: true }, { name: 'CPU2', isCPU: true }];
        const controller = new LocalGameController(players, {}, { mode: 'realtime' });
        const game = controller.game;
        const placedBy = (seat) => game.commands.filter(c => c.playerId === seat).length;
        vi.advanceTimersByTime(3900);
        expect(placedBy(1) + placedBy(2)).toBe(0);
        // 開拓地は 4〜7秒で置き、道はその 1.5秒後
        vi.advanceTimersByTime(3200);
        expect([game.setupCounts[1], game.setupCounts[2]]).toEqual([1, 1]);
        // 人間は順番を待たずに置ける
        expect(controller.send({ type: 'build', piece: 'settlement', at: game.settlementSpots(0)[0] })).toBe(true);
        vi.advanceTimersByTime(60000);
        expect([placedBy(1), placedBy(2)]).toEqual([4, 4]);
        expect(game.phase).toBe('setup');
        ['road', 'settlement', 'road'].forEach(piece => {
            const at = piece === 'road' ? game.roadSpots(0)[0] : game.settlementSpots(0)[0];
            expect(controller.send({ type: 'build', piece, at })).toBe(true);
        });
        expect(game.phase).toBe('play');
        controller.stop();
    });

    it('単純な手：交渉は断り、捨てるときは手札の先頭の資源から捨て、最後に「番を終える」', () => {
        const game = {
            trade: { id: 5, from: 0, responses: {} },
            players: [{}, { hand: { wood: 1, brick: 0, sheep: 3, wheat: 0, ore: 2 } }],
            pendingOf: () => ({ type: 'discard', remaining: { 1: 3 } })
        };
        expect(simpleCommands(game, 1)).toEqual([
            { type: 'respondTrade', id: 5, accept: false },
            { type: 'discard', cards: { wood: 1, brick: 0, sheep: 2, wheat: 0, ore: 0 } },
            { type: 'endTurn' }
        ]);
    });
});
