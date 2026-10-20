import { describe, it, expect } from 'vitest';
import Game, { RESOURCES } from '../public/js/game.js';
import { runCpuStep } from '../public/js/cpu-player.js';
import { createRandom } from '../public/js/random.js';

// ゲームの状態（断った理由と乱数の関数は除く）
// 断った操作が乱数を消費していないかは、最後に記録から再現して完全に一致するかで確かめる
function snapshot(game) {
    const { random, lastError, ...rest } = game;
    return JSON.stringify(rest);
}

// でたらめな操作（正しいものも、おかしいものも混ぜる）
function randomCommand(pick, game) {
    const resource = () => pick([...RESOURCES, 'gold', null]);
    const cards = () => Object.fromEntries(RESOURCES.map(r => [r, pick([0, 0, 1, 2, -1, 9])]));
    const id = () => pick([0, 1, 5, 20, 53, 71, -1, 100, 'x', null]);
    return pick([
        { type: 'build', piece: pick(['road', 'settlement', 'city', 'castle']), at: id() },
        { type: 'roll' },
        { type: 'moveRobber', hex: pick([0, 3, 9, 18, 19, -1]), victim: pick([0, 1, 2, null, 7]) },
        { type: 'discard', cards: cards() },
        { type: 'buyDevCard' },
        { type: 'playDev', card: pick(['knight', 'roadBuilding', 'yearOfPlenty', 'monopoly', 'victoryPoint', 'x']), resources: [resource(), resource()], resource: resource() },
        { type: 'bankTrade', give: resource(), get: resource() },
        { type: 'offerTrade', give: cards(), get: cards() },
        { type: 'respondTrade', accept: pick([true, false]) },
        { type: 'confirmTrade', with: pick([0, 1, 2, 9]) },
        { type: 'cancelTrade' },
        { type: 'endTurn' },
        { type: 'nonsense' },
        null
    ]);
}

describe('断られた操作', () => {
    it('どんな操作でも、断られたときは状態を変えず、受け付けた操作は記録から再現できる', () => {
        for (let seed = 1; seed <= 12; seed++) {
            const random = createRandom(seed * 7919);
            const pick = (items) => items[Math.floor(random() * items.length)];
            const players = Array.from({ length: 2 + (seed % 3) }, (_, i) => ({ name: `P${i}`, isCPU: true }));
            const game = new Game(players, { seed });
            for (let step = 0; step < 4000 && game.phase !== 'end'; step++) {
                for (let n = 0; n < 3; n++) {
                    const seat = Math.floor(random() * players.length);
                    const before = snapshot(game);
                    if (!game.applyCommand(seat, randomCommand(pick, game))) {
                        expect(snapshot(game)).toBe(before);
                    }
                }
                runCpuStep(game);
            }
            const copy = Game.replay(players, { seed }, game.commands);
            expect(snapshot(copy)).toBe(snapshot(game));
        }
    });
});
