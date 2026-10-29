/**
 * オンライン対戦に差し込むゲームの定義（部屋の処理は server/netplay/ の共通部品が行う）
 *
 * 部屋には参加者・シード・操作の記録だけを保存し、操作を受けるたびに記録からゲームを再現する
 * 各プレイヤーには、そのプレイヤーから見える状態（ビュー）だけを送る（他人の手札と発展カードは枚数だけ）
 */

import Game, { MIN_PLAYERS, MAX_PLAYERS, MODES } from '../../public/js/game.js';
import { createGameView } from '../../public/js/game-view.js';
import { runCpuStep, isCpuTurn } from '../../public/js/cpu-player.js';

// 端末から送れる操作（proxy はサーバーだけが使う）
const PLAYER_COMMANDS = [
    'build', 'roll', 'moveRobber', 'discard', 'buyDevCard', 'playDev',
    'bankTrade', 'offerTrade', 'respondTrade', 'cancelTrade', 'endTurn'
];

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
        commands: game.commands
    }),
    restore: (saved) => Game.replay(saved.players, saved.options, saved.commands),

    view: (game, seat) => createGameView(game, seat),

    actions: {
        command({ game, seat, message, reject }) {
            // 操作の中身の検証と、記録する項目の絞り込みは Game.applyCommand が行う
            const command = message.command;
            if (!command || typeof command !== 'object' || !PLAYER_COMMANDS.includes(command.type)) {
                reject('今はその操作はできません');
            }
            if (!game.applyCommand(seat, command)) reject(game.lastError ?? '今はその操作はできません');
        }
    },

    isOver: (game) => game.phase === 'end',

    cpu: {
        needsStep: (game) => isCpuTurn(game),
        step: (game) => runCpuStep(game),
        progress: (game) => game.commands.length
    },

    // 対戦中に部屋を出た人の手番（手札を捨てる・交渉に答えるも含む）は、CPU が代わりに打つ
    // 切断は戻ってくるかもしれないので待つ
    onPlayerGone(ctx, { seat, reason }) {
        if (reason !== 'left' || ctx.game.phase === 'end' || ctx.game.players[seat].proxy) return ctx.ignore();
        ctx.game.applyCommand(seat, { type: 'proxy' });
    }
};
