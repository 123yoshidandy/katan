/**
 * ローカル対戦（同じ端末で、人間とCPUが交代で遊ぶ）のゲームコントローラー
 * 画面には getView() でビューを渡し、操作は send() で受け取る（オンライン対戦のコントローラーと同じ形）
 * 手番の人だけでなく、手札を捨てる人・交渉に答える人も操作するので、今操作が必要な人間から見たビューを渡す
 */

import Game, { RESOURCES } from './game.js';
import { GEOMETRY } from './board.js';
import { createGameView, hydrateGameView } from './game-view.js';
import { runCpuStep, isCpuTurn, cpuActor, setupCpuSeats, setupCpuDelay } from './cpu-player.js';

const CPU_STEP_DELAY_MS = 700; // CPUの手は1手ずつ間を置いて見せる
const REALTIME_CPU_STEP_DELAY_MS = 350; // リアルタイムモードでは、CPU が並んで動くので間を短くする
const STALL_LIMIT = 3; // CPU の手が進まないことがこの回数続いたら、いちばん単純な答えか「番を終える」で抜ける

export default class LocalGameController {
    // players: [{ name, isCPU }] / listeners: onUpdate() / onError(message) / options: { mode }
    constructor(players, listeners = {}, { mode = 'classic' } = {}) {
        this.listeners = listeners;
        this.game = new Game(players, { mode });
        this.cpuTimer = null;
        this.setupDueAt = {};   // リアルタイムモードの初期配置で、CPU ごとに次に置く時刻
        this.lastHumanId = null;
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
        if (this.game.isRealtimeSetup()) {
            this.scheduleSetupCpu();
            return;
        }
        if (!isCpuTurn(this.game)) return;
        this.cpuTimer = setTimeout(() => {
            // どこで例外が出ても、必ず次の手を予約する（対戦が止まらないように）
            try {
                this.stepCpu();
            } catch (error) {
                console.error(error);
            } finally {
                try {
                    this.listeners.onUpdate?.();
                } finally {
                    this.scheduleCpu();
                }
            }
        }, this.game.isRealtimePlay() ? REALTIME_CPU_STEP_DELAY_MS : CPU_STEP_DELAY_MS);
    }

    // リアルタイムモードの初期配置：CPU ごとに、人間が場所を選ぶくらいの間を置いて1つずつ置く（早い者勝ちなので）
    scheduleSetupCpu() {
        const seats = setupCpuSeats(this.game);
        if (seats.length === 0) return;
        const now = Date.now();
        seats.forEach(seat => { this.setupDueAt[seat] ??= now + setupCpuDelay(this.game, seat); });
        const next = Math.min(...seats.map(seat => this.setupDueAt[seat]));
        this.cpuTimer = setTimeout(() => {
            const time = Date.now();
            try {
                seats.filter(seat => this.setupDueAt[seat] <= time && this.game.isRealtimeSetup()).forEach(seat => {
                    try {
                        runCpuStep(this.game, seat);
                    } catch (error) {
                        console.error(error);
                    }
                    this.setupDueAt[seat] = time + setupCpuDelay(this.game, seat);
                });
            } finally {
                try {
                    this.listeners.onUpdate?.();
                } finally {
                    this.scheduleCpu();
                }
            }
        }, Math.max(0, next - now));
    }

    stepCpu() {
        const before = this.game.commands.length;
        try {
            runCpuStep(this.game);
        } catch (error) {
            console.error(error);
        }
        this.stalls = this.game.commands.length === before ? (this.stalls ?? 0) + 1 : 0;
        if (this.stalls < STALL_LIMIT) return;
        this.stalls = 0;
        const seat = cpuActor(this.game);
        if (seat !== null) simpleCommands(this.game, seat).some(command => this.game.applyCommand(seat, command));
    }

    stop() {
        clearTimeout(this.cpuTimer);
    }
}

// CPU の手が進まないときに試す、いちばん単純な手（通るものを順に試す）
export function simpleCommands(game, seat) {
    const commands = [];
    if (game.trade && seat !== game.trade.from && !game.trade.responses[seat]) {
        commands.push({ type: 'respondTrade', id: game.trade.id, accept: false });
    }
    const pending = game.pendingOf(seat);
    if (pending?.type === 'discard') {
        // 手札の先頭の資源から順に捨てる
        let count = pending.remaining[seat];
        const cards = Object.fromEntries(RESOURCES.map(r => {
            const n = Math.min(count, game.players[seat].hand[r]);
            count -= n;
            return [r, n];
        }));
        commands.push({ type: 'discard', cards });
    }
    if (pending?.type === 'robber') {
        GEOMETRY.hexes.filter(h => h.id !== game.robber).forEach(h => {
            commands.push({ type: 'moveRobber', hex: h.id, victim: null });
            game.players.forEach(p => commands.push({ type: 'moveRobber', hex: h.id, victim: p.id }));
        });
    }
    commands.push({ type: 'endTurn' });
    return commands;
}
