import { describe, it, expect } from 'vitest';
import Game from '../public/js/game.js';
import { createGameView } from '../public/js/game-view.js';

const humans = (n) => Array.from({ length: n }, (_, i) => ({ name: `P${i}`, isCPU: false }));

describe('アシスト（おすすめの手）', () => {
    it('全員がおすすめの手だけを打つと、どの場面でも手が通り、最後まで進む', () => {
        for (let seed = 1; seed <= 6; seed++) {
            const game = new Game(humans(2 + (seed % 3)), { seed });
            for (let i = 0; i < 20000 && game.phase !== 'end'; i++) {
                const seat = game.actors().find(id => !(game.trade && id === game.trade.from)) ?? game.currentPlayerIndex;
                const suggestion = createGameView(game, seat).options.suggestion;
                expect(suggestion).not.toBeNull();
                expect(game.applyCommand(seat, suggestion.command), game.lastError).toBe(true);
            }
            expect(game.phase).toBe('end');
        }
    });

    it('操作する番でない人には、おすすめを出さない', () => {
        const game = new Game(humans(3), { seed: 3 });
        const others = [0, 1, 2].filter(id => id !== game.currentPlayerIndex);
        others.forEach(id => expect(createGameView(game, id).options.suggestion).toBeNull());
        expect(createGameView(game, game.currentPlayerIndex).options.suggestion.command.type).toBe('build');
    });

    it('手番を終えるのがおすすめのときは、次に建てたいものと足りない資源を出す', () => {
        const game = new Game(humans(2), { seed: 5 });
        while (game.phase === 'setup') {
            const seat = game.currentPlayerIndex;
            game.applyCommand(seat, createGameView(game, seat).options.suggestion.command);
        }
        const seat = game.currentPlayerIndex;
        game.applyCommand(seat, { type: 'roll' });
        game.pending = null;
        game.players[seat].hand = { wood: 0, brick: 0, sheep: 0, wheat: 1, ore: 0 };
        const { command, goal } = createGameView(game, seat).options.suggestion;
        expect(command.type).toBe('endTurn');
        expect(goal.piece).toBe('city');
        expect(goal.missing).toEqual({ wood: 0, brick: 0, sheep: 0, wheat: 1, ore: 3 });
    });
});
