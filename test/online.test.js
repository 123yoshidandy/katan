import { describe, it, expect } from 'vitest';
import { createTestServer } from '../server/netplay/testing.js';
import game from '../server/src/game-definition.js';

// 手番の人の接続
const currentOf = (clients) => clients[clients[0].last('state').view.currentPlayerId];

// 初期配置を、各自の候補の先頭に置いて済ませる
async function finishSetup(clients) {
    for (let i = 0; i < clients.length * 4; i++) {
        const view = clients[0].last('state').view;
        if (view.phase !== 'setup') break;
        const current = currentOf(clients);
        const { options, setup } = current.last('state').view;
        const piece = setup.step;
        const at = piece === 'settlement' ? options.settlementSpots[0] : options.roadSpots[0];
        await current.send('command', { command: { type: 'build', piece, at } });
    }
}

describe('オンライン対戦（ゲームの定義）', () => {
    it('部屋を作ると部屋番号が届き、参加者はロビーで互いを見られる', async () => {
        const server = createTestServer(game);
        const [a, b] = await server.createRoom(['あき', 'はる']);
        expect(a.last('joined').roomCode).toMatch(/^\d{4}$/);
        expect(b.last('joined').seat).toBe(1);
        expect(a.last('lobby').players.map(p => p.name)).toEqual(['あき', 'はる']);
    });

    it('1人では始められず、CPU を足せばホストが始められる', async () => {
        const server = createTestServer(game);
        const [a] = await server.createRoom(['あき']);
        await a.send('start');
        expect(a.last('error').code).toBe('not_enough_players');
        await a.send('addCpu');
        await a.send('start');
        expect(a.last('lobby').status).toBe('playing');
        expect(a.last('state').view.viewerId).toBe(0);
    });

    it('それぞれに自分から見た状態が届き、他人の手札と発展カードの山の並びは送られない', async () => {
        const server = createTestServer(game);
        const clients = await server.createRoom(['あき', 'はる', 'なつ']);
        await clients[0].send('start');
        await finishSetup(clients);
        const view = clients[0].last('state').view;
        expect(view.phase).toBe('play');
        expect(view.players[0].hand).not.toBeNull();
        expect(view.players[1].hand).toBeNull();
        expect(view.players[1].cardCount).toBe(clients[1].last('state').view.players[1].cardCount);
        expect(view.devDeckCount).toBe(25);
        expect(JSON.stringify(view)).not.toContain('devDeck"');
    });

    it('手番でない人の操作と代行の操作は断られ、手番の人の操作は全員に届く', async () => {
        const server = createTestServer(game);
        const clients = await server.createRoom(['あき', 'はる']);
        await clients[0].send('start');
        await finishSetup(clients);
        const current = currentOf(clients);
        const other = clients.find(c => c !== current);

        await other.send('command', { command: { type: 'roll' } });
        expect(other.last('error').message).toBe('あなたの番ではありません');
        await current.send('command', { command: { type: 'proxy' } });
        expect(current.last('error').code).toBe('rejected');

        await current.send('command', { command: { type: 'roll' } });
        expect(other.last('state').view.dice).toHaveLength(2);
    });

    it('交渉は手番でない人も答えられ、手番の人が相手を選ぶと成立する', async () => {
        const server = createTestServer(game);
        const clients = await server.createRoom(['あき', 'はる']);
        await clients[0].send('start');
        await finishSetup(clients);
        const current = currentOf(clients);
        const other = clients.find(c => c !== current);
        await current.send('command', { command: { type: 'roll' } });
        // 7 が出たら片付けてから交渉する
        for (let i = 0; i < 3 && current.last('state').view.pending; i++) {
            const { pending } = current.last('state').view;
            expect(pending.type).toBe('robber'); // 初期配置の直後に8枚以上持つ人はいない
            if (pending.type === 'robber') {
                const view = current.last('state').view;
                const hex = view.board.hexes.findIndex((_, id) => id !== view.robber);
                await current.send('command', { command: { type: 'moveRobber', hex, victim: null } });
                if (current.last('error')?.message === '奪う相手を選んでください') {
                    await current.send('command', { command: { type: 'moveRobber', hex, victim: clients.indexOf(other) } });
                }
            }
        }
        const mine = current.last('state').view.me ?? current.last('state').view.players[clients.indexOf(current)];
        const giveResource = Object.keys(mine.hand).find(r => mine.hand[r] > 0);
        const theirs = other.last('state').view.players[clients.indexOf(other)].hand;
        const getResource = Object.keys(theirs).find(r => theirs[r] > 0 && r !== giveResource);
        expect(giveResource && getResource).toBeTruthy();

        await current.send('command', { command: { type: 'offerTrade', give: { [giveResource]: 1 }, get: { [getResource]: 1 } } });
        expect(other.last('state').view.trade.from).toBe(clients.indexOf(current));
        await other.send('command', { command: { type: 'respondTrade', accept: true } });
        expect(current.last('state').view.trade.responses[clients.indexOf(other)]).toBe('accept');
        await current.send('command', { command: { type: 'confirmTrade', with: clients.indexOf(other) } });
        expect(other.last('state').view.trade).toBeNull();
        expect(other.last('state').view.players[clients.indexOf(other)].hand[giveResource]).toBe(theirs[giveResource] + 1);
    });

    it('CPU の手はサーバーが進め、cpu: true で1手ずつ届く', async () => {
        const server = createTestServer(game);
        const [a] = await server.createRoom(['あき']);
        await a.send('addCpu');
        await a.send('start');
        // 人間の番で止まっている（CPU が先手なら、開始時に CPU の初期配置が済んでいる）
        expect(a.last('state').view.currentPlayerId).toBe(0);
        const view = a.last('state').view;
        const cpuFirst = view.buildings.some(b => b?.owner === 1);
        await a.send('command', { command: { type: 'build', piece: 'settlement', at: view.options.settlementSpots[0] } });
        const roadSpots = a.last('state').view.options.roadSpots;
        a.clear();
        await a.send('command', { command: { type: 'build', piece: 'road', at: roadSpots[0] } });
        const states = a.all('state');
        // CPU が先手なら、自分は折り返しで続けて置くので CPU の手は挟まらない
        // 自分が先手なら、CPU が開拓地と道を2組置いて、自分の番に戻る
        expect(states.filter(m => m.cpu)).toHaveLength(cpuFirst ? 0 : 4);
        expect(states.at(-1).view.currentPlayerId).toBe(0);
    });

    it('接続が切れても、トークンで同じ席に戻って続きが届く', async () => {
        const server = createTestServer(game);
        const [a, b] = await server.createRoom(['あき', 'はる']);
        await a.send('start');
        const b2 = await server.reconnect(b);
        expect(b2.last('joined').seat).toBe(1);
        expect(b2.last('state').view.viewerId).toBe(1);
    });

    it('対戦中に部屋を出た人の手番は、CPU が代わりに打つ', async () => {
        const server = createTestServer(game);
        const clients = await server.createRoom(['あき', 'はる']);
        await clients[0].send('start');
        const current = currentOf(clients);
        const other = clients.find(c => c !== current);
        await current.send('leave');
        const view = other.last('state').view;
        expect(view.players[clients.indexOf(current)].proxy).toBe(true);
        expect(view.currentPlayerId).toBe(clients.indexOf(other));
    });

    it('対戦後は、ホストが同じ顔ぶれで再戦できる', async () => {
        const server = createTestServer(game);
        const [a] = await server.createRoom(['あき']);
        await a.send('addCpu');
        await a.send('start');
        // 自分の番は最小限の手（初期配置・サイコロ・7の処理・手番を終える）だけで進め、CPU に勝たせる
        for (let i = 0; i < 3000 && a.last('lobby').status === 'playing'; i++) {
            const view = a.last('state').view;
            let command;
            if (view.pending?.type === 'discard' && view.pending.remaining[0]) {
                const hand = { ...view.players[0].hand };
                const cards = {};
                for (let n = 0; n < view.pending.remaining[0]; n++) {
                    const r = Object.keys(hand).find(k => hand[k] > 0);
                    hand[r]--;
                    cards[r] = (cards[r] ?? 0) + 1;
                }
                command = { type: 'discard', cards };
            } else if (view.phase === 'setup') {
                command = { type: 'build', piece: view.setup.step, at: view.setup.step === 'settlement' ? view.options.settlementSpots[0] : view.options.roadSpots[0] };
            } else if (view.pending?.type === 'robber') {
                const hex = view.board.hexes.findIndex((_, id) => id !== view.robber);
                command = { type: 'moveRobber', hex, victim: null };
                await a.send('command', { command });
                if (a.last('error') && a.last('state').view.pending?.type === 'robber') {
                    command = { type: 'moveRobber', hex, victim: 1 };
                } else continue;
            } else if (view.trade) {
                command = { type: 'cancelTrade' };
            } else {
                command = { type: view.rolled ? 'endTurn' : 'roll' };
            }
            await a.send('command', { command });
        }
        expect(a.last('lobby').status).toBe('ended');
        expect(a.last('state').view.result.winnerId).toBe(1);

        const matchId = a.last('lobby').matchId;
        await a.send('start');
        expect(a.last('lobby').status).toBe('playing');
        expect(a.last('lobby').matchId).not.toBe(matchId);
        expect(a.last('state').view.result).toBeNull();
    });
});
