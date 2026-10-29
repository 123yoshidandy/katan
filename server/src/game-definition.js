/**
 * オンライン対戦に差し込むゲームの定義（部屋の処理は server/netplay/ の共通部品が行う）
 *
 * 部屋には参加者・シード・操作の記録だけを保存し、操作を受けるたびに記録からゲームを再現する
 * 各プレイヤーには、そのプレイヤーから見える状態（ビュー）だけを送る（他人の手札と発展カードは枚数だけ）
 */

import Game, { MIN_PLAYERS, MAX_PLAYERS, MODES } from '../../public/js/game.js';
import { createGameView } from '../../public/js/game-view.js';
import { runCpuStep, isCpuTurn, isAnsweringTrade } from '../../public/js/cpu-player.js';

// 端末から送れる操作（proxy はサーバーだけが使う）
const PLAYER_COMMANDS = [
    'build', 'roll', 'moveRobber', 'discard', 'buyDevCard', 'playDev',
    'bankTrade', 'offerTrade', 'respondTrade', 'cancelTrade', 'endTurn'
];

// 交渉にほかの人間が答える余地を残すため、CPU は持ちかけられてから 2〜4 秒たつまで返事をしない
const TRADE_REPLY_MIN_MS = 2000;
const TRADE_REPLY_MAX_MS = 4000;

// 交渉に、持ちかけた人以外の人間でまだ答えていない人がいるか
const humanAnswering = (game) => game.players.some(p => !p.isCPU && !p.proxy && isAnsweringTrade(game, p.id));
// CPU の返事を待たせているか（人間がみな答えたら、時刻を待たずに返事をさせる）
const holding = (game) => Boolean(game.trade && game.cpuReplyAt?.id === game.trade.id && humanAnswering(game));
// 待たせている間は、交渉に答える CPU を飛ばす（リアルタイムモードでは、ほかの手は進める）
const ready = (game) => (seat) => !(holding(game) && isAnsweringTrade(game, seat));

export default {
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    allowCpu: true,
    stamps: ['👍', '🙏', '😮', '😭', '🤝', '🎉'],

    // ホストがロビーで選ぶ設定：モード（通常 / リアルタイム）
    settings: {
        defaults: () => ({ mode: 'classic' }),
        validate: (patch, current) => ({ ...current, mode: MODES.includes(patch.mode) ? patch.mode : current?.mode ?? 'classic' })
    },

    // シードは共通部品の乱数から作る（テストでは乱数を固定できる）
    create: ({ players, random, settings }) => new Game(players, { seed: Math.floor(random() * 2 ** 32), mode: settings?.mode }),

    // 保存するのは記録だけ。読み込むたびに記録から再現する
    persist: (game) => ({
        players: game.players.map(({ name, isCPU }) => ({ name, isCPU })),
        options: { seed: game.seed, mode: game.mode },
        commands: game.commands,
        cpuReplyAt: holding(game) ? game.cpuReplyAt : null
    }),
    restore: (saved) => {
        const game = Game.replay(saved.players, saved.options, saved.commands);
        game.cpuReplyAt = saved.cpuReplyAt ?? null;
        return game;
    },

    view: (game, seat) => createGameView(game, seat),

    actions: {
        command({ game, seat, message, reject, now, random }) {
            // 操作の中身の検証と、記録する項目の絞り込みは Game.applyCommand が行う
            const command = message.command;
            if (!command || typeof command !== 'object' || !PLAYER_COMMANDS.includes(command.type)) {
                reject('今はその操作はできません');
            }
            if (!game.applyCommand(seat, command)) reject(game.lastError ?? '今はその操作はできません');
            if (command.type === 'offerTrade' && humanAnswering(game)) {
                game.cpuReplyAt = { id: game.trade.id, at: now() + TRADE_REPLY_MIN_MS + random() * (TRADE_REPLY_MAX_MS - TRADE_REPLY_MIN_MS) };
            }
        }
    },

    isOver: (game) => game.phase === 'end',

    cpu: {
        needsStep: (game) => isCpuTurn(game, ready(game)),
        step: (game) => runCpuStep(game, ready(game)),
        progress: (game) => game.commands.length
    },

    // 返事の時刻を過ぎたら、待たせていた CPU に返事をさせる（時刻は、端末から届いたメッセージのたびに確かめる）
    deadline: (game) => (holding(game) ? game.cpuReplyAt.at : null),
    onDeadline(ctx) {
        ctx.game.cpuReplyAt = null;
    },

    // 対戦中に部屋を出た人の手番（手札を捨てる・交渉に答えるも含む）は、CPU が代わりに打つ
    // 切断は戻ってくるかもしれないので待つ
    onPlayerGone(ctx, { seat, reason }) {
        if (reason !== 'left' || ctx.game.phase === 'end' || ctx.game.players[seat].proxy) return ctx.ignore();
        ctx.game.applyCommand(seat, { type: 'proxy' });
    }
};
