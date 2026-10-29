/**
 * オンライン対戦のゲームコントローラー
 * ローカル対戦の LocalGameController と同じく、画面には getView() でビューを渡し、操作は send() で受け取る
 * ゲームはサーバーが進め、ここではサーバーから届いた自分のビューを表示するだけ
 * 接続・再接続・参加情報の保存・CPU の手を間を置いて見せる処理は、共通部品の NetplayClient が行う
 */

import NetplayClient from './netplay/netplay-client.mjs';
import { hydrateGameView } from './game-view.js';

const STORAGE_KEY = 'katan.online'; // 再接続に使う部屋コードとトークン
const CPU_STEP_DELAY_MS = 700;              // CPUの手はローカル対戦と同じ間隔で順に見せる
const REALTIME_CPU_STEP_DELAY_MS = 350;     // リアルタイムモードでは、CPU が並んで動くので間を短くする

// 保存した参加情報（部屋コード・トークン・席・名前）
export function loadOnlineSession() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    } catch {
        return null;
    }
}

export default class OnlineGameController {
    // listeners: onUpdate() / onLobby(lobby) / onError(message) / onConnectionChange(connected) / onStamp({ seat, stamp })
    constructor(serverUrl, listeners = {}) {
        this.listeners = listeners;
        this.view = null;              // 表示中のビュー（hydrate 済み）
        this.awaitingResponse = false; // 操作を送ってから返事が届くまで
        this.net = new NetplayClient({ serverUrl, storageKey: STORAGE_KEY, cpuStepDelayMs: CPU_STEP_DELAY_MS });

        this.net.on('lobby', (lobby) => {
            // ロビーに戻ったら、前のゲームの表示を消す
            if (lobby.status === 'lobby') this.view = null;
            this.net.cpuStepDelayMs = lobby.settings?.mode === 'realtime' ? REALTIME_CPU_STEP_DELAY_MS : CPU_STEP_DELAY_MS;
            listeners.onLobby?.(lobby);
        });
        this.net.on('state', ({ view }) => {
            this.awaitingResponse = false;
            this.view = hydrateGameView(view);
            listeners.onUpdate?.();
        });
        this.net.on('error', ({ message }) => {
            this.awaitingResponse = false;
            listeners.onError?.(message);
            listeners.onUpdate?.();
        });
        this.net.on('connection', (connected) => listeners.onConnectionChange?.(connected));
        this.net.on('stamp', (message) => listeners.onStamp?.(message));
    }

    get session() { return this.net.session; }
    get lobby() { return this.net.lobby; }
    get seat() { return this.net.seat; }

    // ===== 部屋の操作 =====

    createRoom(name) { return this.net.createRoom(name); }
    joinRoom(roomCode, name) { return this.net.joinRoom(roomCode, name); }
    resume() { return this.net.resume(); }
    addCpu() { this.net.addCpu(); }
    removeCpu(seat) { this.net.removeCpu(seat); }
    startGame() { this.net.start(); }
    setMode(mode) { this.net.setSettings({ mode }); }
    backToLobby() { this.net.backToLobby(); }
    isHost() { return this.net.isHost(); }
    inviteUrl() { return this.net.inviteUrl(); }
    stamp(stamp) { this.net.stamp(stamp); }

    // 部屋を出る（サーバーに知らせるので、席が「切断中」のまま残らない。保存した参加情報も消す）
    leave() {
        this.net.leave();
        this.view = null;
    }

    // ===== 画面とのやり取り（ローカル対戦のコントローラーと同じ形） =====

    getView() {
        if (!this.view) return null;
        // 操作の返事を待つ間は、二重に操作しないよう自分の番として扱わない
        return this.awaitingResponse ? { ...this.view, isMyTurn: false } : this.view;
    }

    send(command) {
        if (!this.net.send('command', { command })) {
            this.listeners.onError?.('サーバーとの接続が切れています。再接続しています…');
            return false;
        }
        this.awaitingResponse = true;
        this.listeners.onUpdate?.();
        return true;
    }
}
