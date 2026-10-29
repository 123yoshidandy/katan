/**
 * ローカル対戦（同じ端末で、人間とCPUが交代で遊ぶ）のゲームコントローラー
 * 画面には getView() でビューを渡し、操作は send() で受け取る（オンライン対戦のコントローラーと同じ形）
 * 手番の人だけでなく、手札を捨てる人・交渉に答える人も操作するので、今操作が必要な人間から見たビューを渡す
 */

import Game from './game.js';
import { createGameView, hydrateGameView } from './game-view.js';
import { runCpuStep, isCpuTurn, isAnsweringTrade } from './cpu-player.js';

const CPU_STEP_DELAY_MS = 700; // CPUの手は1手ずつ間を置いて見せる
const REALTIME_CPU_STEP_DELAY_MS = 350; // リアルタイムモードでは、CPU が並んで動くので間を短くする
const TRADE_REPLY_MIN_MS = 2000;        // 交渉の返事は、持ちかけられてから 2〜4 秒考えてから返す（すぐ返すと落ち着かない）
const TRADE_REPLY_MAX_MS = 4000;

export default class LocalGameController {
    // players: [{ name, isCPU }] / listeners: onUpdate() / onError(message) / options: { mode }
    constructor(players, listeners = {}, { mode = 'classic' } = {}) {
        this.listeners = listeners;
        this.game = new Game(players, { mode });
        this.cpuTimer = null;
        this.lastHumanId = null;
        this.replies = null; // 交渉ごとの、CPU が返事をする時刻 { id, at: { 席: 時刻 } }
        this.scheduleCpu();
    }

    // 操作が必要な人間（いなければ、最後に操作した人間。全員CPUなら観戦）
    viewerId() {
        const humans = this.game.players.filter(p => !p.isCPU).map(p => p.id);
        const actor = this.game.actors().find(id => humans.includes(id) && !(this.game.trade && id === this.game.trade.from && this.waitingTradeHumans().length > 0));
        if (actor !== undefined) this.lastHumanId = actor;
        return this.lastHumanId ?? humans[0] ?? null;
    }

    // 交渉に答えていない人間（手番の人の前に答えてもらう）
    waitingTradeHumans() {
        const { trade } = this.game;
        if (!trade) return [];
        return this.game.players.filter(p => !p.isCPU && p.id !== trade.from && !trade.responses[p.id]).map(p => p.id);
    }

    getView() {
        return hydrateGameView(createGameView(this.game, this.viewerId()));
    }

    send(command) {
        const id = this.viewerId();
        if (id === null) return false;
        if (!this.game.applyCommand(id, command)) {
            this.listeners.onError?.(this.game.lastError);
            return false;
        }
        this.listeners.onUpdate?.();
        this.scheduleCpu();
        return true;
    }

    scheduleCpu() {
        clearTimeout(this.cpuTimer);
        if (!isCpuTurn(this.game)) return;
        const step = this.game.isRealtimePlay() ? REALTIME_CPU_STEP_DELAY_MS : CPU_STEP_DELAY_MS;
        // 返事を考えている CPU は飛ばし、動ける CPU がいなければ、一番早い返事の時刻まで待つ
        const readyAt = (time) => (seat) => this.replyTime(seat) <= time;
        const waiting = this.game.players.map(p => this.replyTime(p.id)).filter(time => time > 0);
        const delay = isCpuTurn(this.game, readyAt(Date.now() + step)) ? step
            : Math.max(step, Math.min(...waiting) - Date.now());
        this.cpuTimer = setTimeout(() => {
            if (runCpuStep(this.game, readyAt(Date.now()))) this.listeners.onUpdate?.();
            this.scheduleCpu();
        }, delay);
    }

    // seat の CPU が動いてよい時刻（交渉にまだ答えていなければ、返事をする時刻）
    replyTime(seat) {
        const { trade } = this.game;
        if (!isAnsweringTrade(this.game, seat)) return 0;
        if (this.replies?.id !== trade.id) {
            const at = {};
            this.game.players.forEach(p => { at[p.id] = Date.now() + TRADE_REPLY_MIN_MS + Math.random() * (TRADE_REPLY_MAX_MS - TRADE_REPLY_MIN_MS); });
            this.replies = { id: trade.id, at };
        }
        return this.replies.at[seat];
    }

    stop() {
        clearTimeout(this.cpuTimer);
    }
}
