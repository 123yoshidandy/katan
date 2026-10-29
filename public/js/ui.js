/**
 * 画面の描画と操作
 * ゲームはコントローラー（ローカル対戦 / オンライン対戦）から getView() で受け取ったビューだけを見て描画する
 */

import LocalGameController from './game-controller.js';
import OnlineGameController, { loadOnlineSession } from './online-controller.js';
import { getServerUrl, hasServer } from './online-config.js';
import Game, {
    MIN_PLAYERS, MAX_PLAYERS, RESOURCES, RESOURCE_NAMES, COSTS, DEV_NAMES, PIECE_NAMES, hasCards, countCards
} from './game.js';
import { GEOMETRY } from './board.js';
import { renderBoard, injectSymbols, resourceIcon, pieceIcon, vertexPips, PLAYER_COLORS } from './board-view.js';
import { runCpuStep } from './cpu-player.js';
import { unlockSound, playEffect, toggleSound, isSoundOn, onSoundChange } from './sound.js';
import NetplayClient from './netplay/netplay-client.mjs';
import { renderCoach } from './coach.js';
import { playAnimations } from './animator.js';

const SETUP_KEY = 'katan.setup'; // 開始画面で選んだ人数・名前・CPU
const ASSIST_KEY = 'katan.assist'; // アシスト（おすすめの手・出やすさなど）の ON/OFF
const AUTO_REJECT_KEY = 'katan.autoReject'; // 求められた資源を持っていない交渉を、自動で断るか
const TOAST_MS = 2500;
const AUTO_ROLL_DELAY_MS = 700;  // サイコロを振るしかないとき、自動で振るまでの間
const STAMP_MS = 2500;
const TITLE_SEED = 20261020;     // タイトル画面の絵に使う盤面

const DEV_TEXTS = {
    knight: '盗賊を動かして、隣の人から1枚奪う',
    roadBuilding: '道を2本、無料で置く',
    yearOfPlenty: '好きな資源を2枚もらう',
    monopoly: '資源を1種類選び、全員からその資源を全部もらう',
    victoryPoint: '持っているだけで1点'
};

const $ = (id) => document.getElementById(id);

function element(tag, { className, text, onClick, disabled, title } = {}, children = []) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    if (title) node.title = title;
    if (disabled) node.disabled = true;
    if (onClick) node.addEventListener('click', onClick);
    children.forEach(child => node.append(child));
    return node;
}

// 切り替えボタン（.segmented）の選択を描く
function selectSegment(group, value) {
    group.querySelectorAll('button').forEach(button => {
        const selected = (button.dataset.mode ?? button.dataset.count) === value;
        button.classList.toggle('selected', selected);
        button.setAttribute('aria-checked', String(selected));
    });
}

function loadSetup() {
    try {
        return JSON.parse(localStorage.getItem(SETUP_KEY) || 'null');
    } catch {
        return null;
    }
}

function saveSetup(setup) {
    try {
        localStorage.setItem(SETUP_KEY, JSON.stringify(setup));
    } catch {
        // 保存できなくても遊べる
    }
}

// ON/OFF の設定（初めは ON）
function loadSwitch(key) {
    try {
        return localStorage.getItem(key) !== 'off';
    } catch {
        return true;
    }
}

function saveSwitch(key, on) {
    try {
        localStorage.setItem(key, on ? 'on' : 'off');
    } catch {
        // 保存できなくても遊べる
    }
}

// 資源の組を小さな図柄で並べる（{ wood: 1, ore: 2 } → 🌲 ⛰⛰）
function cardsLine(cards) {
    const line = element('span', { className: 'cards-line' });
    RESOURCES.forEach(r => {
        for (let i = 0; i < (cards[r] ?? 0); i++) line.append(resourceIcon(r, 'mini-icon'));
    });
    return line;
}

export default class UI {
    constructor() {
        this.controller = null; // 遊んでいるゲームのコントローラー
        this.online = null;     // オンライン対戦のコントローラー（部屋に入っている間）
        this.localPlayers = null;
        this.mode = null;       // 建てる場所を選んでいるもの（road / settlement / city）
        this.lastView = null;
        this.toastTimer = null;
        this.autoTimer = null;
        this.tradeTab = 'bank';
        this.bankChoice = { give: null, get: null };
        this.offer = { give: {}, get: {} };
        this.discardChoice = {};
        this.devChoice = null;  // 収穫・独占で選んでいる資源 { card, picks }
        this.robberHex = null;  // 奪う相手を選んでいる盗賊の行き先
        this.assist = loadSwitch(ASSIST_KEY);
        this.autoReject = loadSwitch(AUTO_REJECT_KEY);
        this.autoRejectedTrade = null; // 自動で断った交渉の番号（同じ交渉に何度も送らない）
        injectSymbols();
        this.bindEvents();
        this.renderTitleArt();
        this.renderSoundButtons();
        this.renderAssistButtons();
        $('room-code').maxLength = NetplayClient.ROOM_CODE_LENGTH;
        $('room-code').placeholder = `${NetplayClient.ROOM_CODE_LENGTH}桁の数字`;
        $('open-online').classList.toggle('hidden', !hasServer());
    }

    // ===== 画面の切り替え =====

    showScreen(name) {
        ['setup', 'online', 'lobby', 'game'].forEach(screen => {
            $(`screen-${screen}`).classList.toggle('hidden', screen !== name);
        });
        this.screen = name;
        if (name !== 'game') {
            this.closeDialogs();
            clearTimeout(this.autoTimer);
        }
    }

    showSetup() {
        const setup = loadSetup() ?? { count: 3, seats: [] };
        this.setPlayerCount(setup.count, setup.seats);
        this.setGameMode(setup.mode ?? 'classic');
        this.showScreen('setup');
    }

    showOnlineMenu({ roomCode = '' } = {}) {
        const session = loadOnlineSession();
        $('online-name').value = session?.name ?? loadSetup()?.seats?.[0]?.name ?? '';
        $('room-code').value = roomCode;
        this.showScreen('online');
    }

    // 前回入っていた部屋があれば、自動で戻る
    async resumeOnline() {
        if (!loadOnlineSession() || !hasServer()) return false;
        try {
            await this.connectOnline().resume();
            return true;
        } catch {
            this.leaveOnline();
            return false;
        }
    }

    goHome() {
        this.controller?.stop?.();
        if (this.controller === this.online) this.leaveOnline();
        this.controller = null;
        this.lastView = null;
        this.mode = null;
        this.showSetup();
    }

    // ===== イベント =====

    bindEvents() {
        // 最初の操作で音を鳴らせるようにする
        document.addEventListener('pointerdown', () => unlockSound(), { capture: true });
        // 入力欄以外の長押しでメニューを出さない
        document.addEventListener('contextmenu', (event) => {
            if (!event.target.closest('input')) event.preventDefault();
        });

        $('player-count').addEventListener('click', (event) => {
            const button = event.target.closest('button[data-count]');
            if (button) this.setPlayerCount(button.dataset.count);
        });
        $('mode-select').addEventListener('click', (event) => {
            const button = event.target.closest('button[data-mode]');
            if (button) this.setGameMode(button.dataset.mode);
        });
        $('lobby-mode').addEventListener('click', (event) => {
            const button = event.target.closest('button[data-mode]');
            if (button && this.online?.isHost()) this.online.setMode(button.dataset.mode);
        });
        $('start-local').addEventListener('click', () => this.startLocal());
        $('open-online').addEventListener('click', () => this.showOnlineMenu());
        $('back-to-setup').addEventListener('click', () => this.showSetup());
        $('create-room').addEventListener('click', () => this.createRoom());
        $('join-room').addEventListener('click', () => this.joinRoom());
        $('share-invite').addEventListener('click', () => this.shareInvite());
        $('add-cpu').addEventListener('click', () => this.online?.addCpu());
        $('start-online').addEventListener('click', () => this.online?.startGame());
        $('leave-room').addEventListener('click', () => {
            this.leaveOnline();
            this.showSetup();
        });

        $('open-help').addEventListener('click', () => this.openDialog('help-dialog'));
        $('help-button').addEventListener('click', () => this.openDialog('help-dialog'));
        $('menu-button').addEventListener('click', () => this.goHome());
        document.querySelectorAll('.sound-toggle').forEach(button => button.addEventListener('click', () => toggleSound()));
        onSoundChange(() => {
            this.renderSoundButtons();
            this.renderSettings();
        });
        $('stamp-button').addEventListener('click', () => $('stamps').classList.toggle('hidden'));
        document.querySelectorAll('.assist-toggle').forEach(button => button.addEventListener('click', () => {
            this.setAssist(!this.assist);
            this.toast(`アシスト ${this.assist ? 'ON' : 'OFF'}`);
        }));

        // 設定
        document.querySelectorAll('.open-settings').forEach(button => button.addEventListener('click', () => {
            this.renderSettings();
            this.showModal($('settings-dialog'));
        }));
        $('set-sound').addEventListener('change', () => {
            if ($('set-sound').checked !== isSoundOn()) toggleSound();
        });
        $('set-assist').addEventListener('change', () => this.setAssist($('set-assist').checked));
        $('set-auto-reject').addEventListener('change', () => {
            this.autoReject = $('set-auto-reject').checked;
            saveSwitch(AUTO_REJECT_KEY, this.autoReject);
            this.renderGame();
        });

        // ダイアログ：✕ と外側のタップで閉じる（手札を捨てるダイアログは閉じられない）
        document.querySelectorAll('dialog').forEach(dialog => {
            dialog.addEventListener('click', (event) => {
                if (event.target === dialog && dialog.id !== 'discard-dialog') dialog.close();
            });
            dialog.addEventListener('cancel', (event) => {
                if (dialog.id === 'discard-dialog') event.preventDefault();
            });
            dialog.addEventListener('close', () => this.renderGame());
        });
        document.querySelectorAll('.close-dialog').forEach(button => {
            button.addEventListener('click', () => button.closest('dialog').close());
        });

        // 手番の操作
        $('act-roll').addEventListener('click', () => this.send({ type: 'roll' }));
        ['road', 'settlement', 'city'].forEach(piece => {
            $(`act-${piece}`).addEventListener('click', () => {
                this.mode = this.mode === piece ? null : piece;
                this.renderGame();
            });
        });
        $('act-dev').addEventListener('click', () => {
            this.devChoice = null;
            this.openDialog('dev-dialog');
        });
        $('act-trade').addEventListener('click', () => {
            const hint = this.hint(this.view());
            this.bankChoice = hint?.type === 'bankTrade' ? { give: hint.give, get: hint.get } : { give: null, get: null };
            if (hint?.type === 'bankTrade') this.tradeTab = 'bank';
            this.offer = { give: {}, get: {} };
            this.openDialog('trade-dialog');
        });
        $('act-end').addEventListener('click', () => this.send({ type: 'endTurn' }));

        // 交換
        document.querySelectorAll('#trade-dialog [data-tab]').forEach(button => {
            button.addEventListener('click', () => {
                this.tradeTab = button.dataset.tab;
                this.renderTradeDialog(this.view());
            });
        });
        $('bank-confirm').addEventListener('click', () => {
            const { give, get } = this.bankChoice;
            if (!give || !get) return;
            this.bankChoice = { give: null, get: null };
            this.send({ type: 'bankTrade', give, get });
        });
        $('offer-confirm').addEventListener('click', () => {
            const { give, get } = this.offer;
            if (this.send({ type: 'offerTrade', give, get })) $('trade-dialog').close();
        });

        // 手札を捨てる
        $('discard-confirm').addEventListener('click', () => {
            $('discard-confirm').disabled = true;
            this.send({ type: 'discard', cards: this.discardChoice });
        });

        $('discard-auto').addEventListener('click', () => {
            const hint = this.hint(this.view());
            if (hint?.type !== 'discard') return;
            this.discardChoice = { ...hint.cards };
            this.renderDiscardDialog(this.view());
        });

        // 発展カード
        $('dev-buy').addEventListener('click', () => this.send({ type: 'buyDevCard' }));
        $('dev-choose-confirm').addEventListener('click', () => {
            const choice = this.devChoice;
            if (!choice) return;
            const command = choice.card === 'yearOfPlenty'
                ? { type: 'playDev', card: 'yearOfPlenty', resources: RESOURCES.flatMap(r => Array(choice.picks[r] ?? 0).fill(r)) }
                : { type: 'playDev', card: 'monopoly', resource: RESOURCES.find(r => choice.picks[r]) };
            this.devChoice = null;
            if (this.send(command)) $('dev-dialog').close();
        });

        // 奪う相手
        $('victim-cancel').addEventListener('click', () => {
            this.robberHex = null;
            $('victim-dialog').close();
        });
    }

    renderSoundButtons() {
        document.querySelectorAll('.sound-toggle').forEach(button => {
            button.classList.toggle('off', !isSoundOn());
            button.setAttribute('aria-pressed', String(isSoundOn()));
        });
    }

    setAssist(on) {
        this.assist = on;
        saveSwitch(ASSIST_KEY, on);
        this.renderAssistButtons();
        this.renderSettings();
        this.renderGame();
    }

    renderSettings() {
        $('set-sound').checked = isSoundOn();
        $('set-assist').checked = this.assist;
        $('set-auto-reject').checked = this.autoReject;
    }

    renderAssistButtons() {
        document.querySelectorAll('.assist-toggle').forEach(button => {
            button.classList.toggle('off', !this.assist);
            button.setAttribute('aria-pressed', String(this.assist));
        });
    }

    openDialog(id) {
        const dialog = $(id);
        if (!dialog.open) this.showModal(dialog);
        this.renderDialogs(this.view());
    }

    // 開いたときに先頭のボタンへフォーカスが移って枠が出ないよう、ダイアログ自体にフォーカスする
    showModal(dialog) {
        dialog.showModal();
        dialog.focus();
    }

    closeDialogs() {
        document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
    }

    // ===== 開始画面（ローカル対戦） =====

    // タイトル画面の絵：実際のゲームで、CPU が初期配置を済ませた盤面
    renderTitleArt() {
        const game = new Game([{ name: 'A', isCPU: true }, { name: 'B', isCPU: true }, { name: 'C', isCPU: true }], { seed: TITLE_SEED });
        while (game.phase === 'setup') runCpuStep(game);
        renderBoard($('title-board'), game);
    }

    setPlayerCount(count, savedSeats = this.readSeats()) {
        this.playerCount = Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, Number(count) || 3));
        $('player-count').querySelectorAll('button').forEach(button => {
            const selected = Number(button.dataset.count) === this.playerCount;
            button.classList.toggle('selected', selected);
            button.setAttribute('aria-checked', String(selected));
        });
        this.renderSeats(savedSeats);
    }

    renderSeats(savedSeats = this.readSeats()) {
        const list = $('seat-list');
        list.replaceChildren();
        for (let i = 0; i < this.playerCount; i++) {
            const saved = savedSeats[i] ?? { name: i === 0 ? 'あなた' : `CPU${i}`, isCPU: i !== 0 };
            const row = element('div', { className: 'seat' });
            const swatch = element('span', { className: 'swatch' });
            swatch.style.background = PLAYER_COLORS[i];
            const name = element('input');
            name.maxLength = 12;
            name.value = saved.name;
            name.dataset.role = 'name';
            const cpuLabel = element('label', { className: 'cpu-toggle' });
            const cpu = element('input');
            cpu.type = 'checkbox';
            cpu.checked = saved.isCPU;
            cpu.dataset.role = 'cpu';
            cpuLabel.append(cpu, 'CPU');
            row.append(swatch, name, cpuLabel);
            list.append(row);
        }
    }

    readSeats() {
        return [...$('seat-list').querySelectorAll('.seat')].map((row, i) => ({
            name: row.querySelector('[data-role=name]').value.trim() || `プレイヤー${i + 1}`,
            isCPU: row.querySelector('[data-role=cpu]').checked
        }));
    }

    // 開始画面のモード（classic / realtime）
    setGameMode(mode) {
        this.gameMode = mode === 'realtime' ? 'realtime' : 'classic';
        selectSegment($('mode-select'), this.gameMode);
    }

    startLocal(players = null) {
        if (!players) {
            players = this.readSeats();
            saveSetup({ count: players.length, seats: players, mode: this.gameMode });
            // リアルタイムは全員が同時に動くので、同じ端末では人間1人まで
            if (this.gameMode === 'realtime' && players.filter(p => !p.isCPU).length > 1) {
                this.toast('リアルタイムは、人間1人とCPUで遊ぶモードです（人間どうしはオンライン対戦で）');
                return;
            }
            this.localMode = this.gameMode;
        }
        this.controller?.stop?.();
        this.localPlayers = players;
        this.lastView = null;
        this.autoRejectedTrade = null;
        this.mode = null;
        this.controller = new LocalGameController(players, {
            onUpdate: () => this.renderGame(),
            onError: (message) => this.toast(message)
        }, { mode: this.localMode });
        $('stamp-button').classList.add('hidden');
        this.showScreen('game');
        this.renderGame();
    }

    // ===== オンライン対戦 =====

    connectOnline() {
        if (this.online) return this.online;
        this.online = new OnlineGameController(getServerUrl(), {
            onUpdate: () => {
                if (this.controller === this.online && this.online.view) this.renderGame();
            },
            onLobby: (lobby) => this.onLobby(lobby),
            onError: (message) => this.toast(message),
            onConnectionChange: (connected) => {
                if (!connected) this.toast('サーバーとの接続が切れました。再接続しています…');
            },
            onStamp: ({ seat, stamp }) => this.showStamp(seat, stamp)
        });
        return this.online;
    }

    async createRoom() {
        const name = $('online-name').value.trim();
        if (!name) return this.toast('名前を入れてください');
        try {
            await this.connectOnline().createRoom(name);
        } catch (error) {
            this.toast(error.message);
        }
    }

    async joinRoom() {
        const name = $('online-name').value.trim();
        const code = $('room-code').value.trim();
        if (!name) return this.toast('名前を入れてください');
        if (!NetplayClient.isRoomCode(code)) return this.toast(`部屋番号（数字${NetplayClient.ROOM_CODE_LENGTH}桁）を入れてください`);
        try {
            await this.connectOnline().joinRoom(code, name);
        } catch (error) {
            this.toast(error.message);
        }
    }

    onLobby(lobby) {
        const online = this.online;
        if (this.controller !== online) this.controller?.stop?.();
        this.controller = online;
        if (lobby.matchId !== this.matchId) {
            this.matchId = lobby.matchId;
            this.lastView = null;
            this.mode = null;
        }
        this.renderStampButtons();
        // 対戦中（playing）と対戦後（ended）はゲーム画面
        if (lobby.status !== 'lobby') {
            $('stamp-button').classList.remove('hidden');
            this.showScreen('game');
            if (online.view) this.renderGame();
            return;
        }

        this.showScreen('lobby');
        $('lobby-code').textContent = lobby.roomCode;
        const isHost = online.isHost();
        const list = $('lobby-players');
        list.replaceChildren();
        lobby.players.forEach(player => {
            const item = element('li');
            const swatch = element('span', { className: 'swatch' });
            swatch.style.background = PLAYER_COLORS[player.seat];
            item.append(swatch, element('span', { text: player.name, className: player.connected ? '' : 'offline' }));
            if (player.seat === lobby.hostSeat) item.append(element('span', { className: 'badge', text: 'ホスト' }));
            if (player.seat === lobby.seat) item.append(element('span', { className: 'badge', text: 'あなた' }));
            if (!player.connected) item.append(element('span', { className: 'badge muted', text: '切断中' }));
            if (isHost && player.isCPU) {
                item.append(element('button', { className: 'small', text: '外す', onClick: () => online.removeCpu(player.seat) }));
            }
            list.append(item);
        });
        const mode = lobby.settings?.mode ?? 'classic';
        selectSegment($('lobby-mode'), mode);
        $('lobby-mode').querySelectorAll('button').forEach(button => { button.disabled = !isHost && button.dataset.mode !== mode; });
        $('host-controls').classList.toggle('hidden', !isHost);
        $('guest-note').classList.toggle('hidden', isHost);
        $('add-cpu').disabled = lobby.players.length >= MAX_PLAYERS;
        $('start-online').disabled = lobby.players.length < MIN_PLAYERS;
    }

    async shareInvite() {
        const code = this.online?.lobby?.roomCode;
        if (!code) return;
        const url = this.online.inviteUrl();
        const text = `KATAN で遊ぼう！ 部屋番号 ${code}`;
        try {
            if (navigator.share) {
                await navigator.share({ title: 'KATAN', text, url });
            } else {
                await navigator.clipboard.writeText(url);
                this.toast('招待URLをコピーしました');
            }
        } catch {
            // 共有をやめたときなど
        }
    }

    leaveOnline() {
        this.online?.leave();
        if (this.controller === this.online) this.controller = null;
        this.online = null;
        const url = new URL(location.href);
        url.searchParams.delete('room');
        history.replaceState(null, '', url);
    }

    renderStampButtons() {
        const row = $('stamps');
        if (row.childElementCount > 0) return;
        const stamps = this.online?.lobby ? ['👍', '🙏', '😮', '😭', '🤝', '🎉'] : [];
        stamps.forEach(stamp => row.append(element('button', {
            className: 'stamp', text: stamp,
            onClick: () => {
                this.online?.stamp(stamp);
                row.classList.add('hidden');
            }
        })));
    }

    showStamp(seat, stamp) {
        const row = document.querySelector(`#screen-game .player[data-seat="${seat}"]`);
        if (!row) return;
        const bubble = element('span', { className: 'stamp-bubble', text: stamp });
        row.append(bubble);
        setTimeout(() => bubble.remove(), STAMP_MS);
    }

    // ===== 操作 =====

    view() {
        return this.controller?.getView() ?? null;
    }

    send(command) {
        unlockSound();
        return this.controller?.send(command) ?? false;
    }

    // ===== ゲーム画面 =====

    renderGame() {
        if (this.screen !== 'game') return;
        const view = this.view();
        if (!view) return;
        const previous = this.lastView;

        // ローカル対戦で、操作する人間が替わったら知らせる
        if (previous && previous.me && view.me && previous.me.id !== view.me.id && this.controller instanceof LocalGameController) {
            this.toast(`${view.me.name}の操作です`);
        }
        // 建てる場所を選んでいる途中で、建てられなくなったらやめる
        if (this.mode && !this.canBuild(view, this.mode)) this.mode = null;

        this.renderBoardArea(view);
        this.renderPlayers(view);
        // アシストが ON の間は、作戦の欄（目標 → 必要 → だから）が案内を兼ねる
        const coached = renderCoach($('coach'), view, { assist: this.assist, mode: this.mode });
        $('guide').classList.toggle('hidden', coached);
        if (!coached) this.renderGuide(view);
        this.renderTradeStatus(view);
        this.renderHand(view);
        this.renderActions(view);
        this.renderLog(view);
        this.renderDialogs(view);
        this.renderResult(view);
        this.playSounds(previous, view);
        playAnimations(previous, view, { board: $('board'), fx: $('fx'), players: $('screen-game'), hand: $('hand'), dice: $('dice') });
        this.lastView = view;
        this.scheduleAutoRoll(view);
        this.scheduleAutoReject(view);
    }

    // 設定が ON なら、求められた資源を持っていない交渉は自動で断る（描画が終わってから送る）
    scheduleAutoReject(view) {
        const trade = view.trade;
        if (!this.autoReject || !view.tradeWaiting || hasCards(view.me.hand, trade.get)) return;
        const key = `${this.matchId ?? 'local'}:${view.me.id}:${trade.id}`;
        if (this.autoRejectedTrade === key) return;
        this.autoRejectedTrade = key;
        setTimeout(() => {
            const current = this.view();
            if (current?.tradeWaiting && current.trade.id === trade.id && current.me.id === view.me.id) {
                this.send({ type: 'respondTrade', id: trade.id, accept: false });
            }
        }, 0);
    }

    // 自分が今、手番の操作（建設・交換など）をできるか
    canAct(view) {
        return view.isMyTurn && view.phase === 'play' && !view.pending;
    }

    canBuild(view, piece) {
        if (!this.canAct(view) || !view.rolled || !view.options) return false;
        const me = view.me;
        if (me.pieces[piece] === 0 || !hasCards(me.hand, COSTS[piece])) return false;
        return this.spotsFor(view, piece).length > 0;
    }

    spotsFor(view, piece) {
        const options = view.options;
        if (!options) return [];
        return { road: options.roadSpots, settlement: options.settlementSpots, city: options.citySpots }[piece];
    }

    // 盤面で選べる場所
    boardSpots(view) {
        if (!view.isMyTurn || !view.options) return {};
        if (view.phase === 'setup') {
            return view.setup.step === 'settlement' ? { vertices: view.options.settlementSpots } : { edges: view.options.roadSpots };
        }
        if (view.pending?.type === 'robber') return { hexes: GEOMETRY.hexes.map(h => h.id).filter(id => id !== view.robber) };
        if (view.pending?.type === 'roadBuilding') return { edges: view.options.roadSpots };
        if (!view.pending && this.mode) {
            const spots = this.spotsFor(view, this.mode);
            return this.mode === 'road' ? { edges: spots } : { vertices: spots };
        }
        return {};
    }

    // アシスト：おすすめの手（アシストが OFF なら null）
    hint(view) {
        return (this.assist && view?.options?.suggestion?.command) || null;
    }

    // アシスト：盤面で★を付ける場所
    bestSpot(view) {
        const hint = this.hint(view);
        if (!hint || !view.isMyTurn) return {};
        if (hint.type === 'moveRobber') return { hex: hint.hex };
        if (hint.type !== 'build') return {};
        // 手番中は、おすすめと同じものを建てようとしているときだけ
        if (view.phase === 'play' && !view.pending && this.mode !== hint.piece) return {};
        return hint.piece === 'road' ? { edge: hint.at } : { vertex: hint.at };
    }

    renderBoardArea(view) {
        const recent = this.recentPiece(this.lastView, view);
        const spots = this.boardSpots(view);
        const sum = view.dice ? view.dice[0] + view.dice[1] : null;
        renderBoard($('board'), view, {
            spots,
            recent,
            best: this.bestSpot(view),
            labels: this.assist ? Object.fromEntries((spots.vertices ?? []).map(v => [v, vertexPips(view.board, v)])) : null,
            rolled: this.assist && sum !== 7 ? sum : null,
            onVertex: (vertex) => this.onVertex(view, vertex),
            onEdge: (edge) => {
                this.mode = null;
                this.send({ type: 'build', piece: 'road', at: edge });
            },
            onHex: (hex) => this.onHex(hex)
        });
        this.renderDice(view);
    }

    // 前のビューから新しく置かれた建物と道（目立たせる）
    recentPiece(previous, view) {
        if (!previous) return {};
        const vertex = view.buildings.findIndex((b, i) => b && (!previous.buildings[i] || previous.buildings[i].type !== b.type));
        const edge = view.roads.findIndex((r, i) => r !== null && previous.roads[i] === null);
        return { vertex: vertex >= 0 ? vertex : null, edge: edge >= 0 ? edge : null };
    }

    onVertex(view, vertex) {
        const piece = view.phase === 'setup' ? 'settlement' : this.mode;
        if (!piece) return;
        this.mode = null;
        this.send({ type: 'build', piece, at: vertex });
    }

    onHex(hex) {
        const view = this.view();
        if (view.pending?.type !== 'robber' || !view.isMyTurn) return;
        const victims = this.robberVictims(view, hex);
        if (victims.length <= 1) {
            this.send({ type: 'moveRobber', hex, victim: victims[0] ?? null });
            return;
        }
        this.robberHex = hex;
        const list = $('victim-list');
        const hint = this.hint(view);
        list.replaceChildren(...victims.map(id => {
            const player = view.players[id];
            const recommended = hint?.type === 'moveRobber' && hint.hex === hex && hint.victim === id;
            const button = element('button', { className: recommended ? 'recommended' : '', onClick: () => {
                $('victim-dialog').close();
                this.robberHex = null;
                this.send({ type: 'moveRobber', hex, victim: id });
            } });
            const swatch = element('span', { className: 'swatch' });
            swatch.style.background = PLAYER_COLORS[id];
            button.append(swatch, `${player.name}（手札${player.cardCount}枚）`);
            return button;
        }));
        this.showModal($('victim-dialog'));
    }

    robberVictims(view, hex) {
        const owners = new Set(GEOMETRY.hexes[hex].vertices.map(v => view.buildings[v]?.owner).filter(o => o !== undefined));
        return [...owners].filter(o => o !== view.me.id && view.players[o].cardCount > 0).sort((a, b) => a - b);
    }

    renderDice(view) {
        const dice = $('dice');
        dice.replaceChildren();
        if (!view.dice) return;
        // サイコロは、振った人の色にする（最後のサイコロのイベントから。なければ手番の人）
        const roller = view.realtime && view.me ? view.me.id
            : [...(view.events ?? [])].reverse().find(e => e.type === 'roll')?.player ?? view.currentPlayerId;
        view.dice.forEach(value => {
            const die = element('span', { className: `die face-${value} owner-${roller}` });
            for (let i = 0; i < value; i++) die.append(element('i'));
            dice.append(die);
        });
        dice.classList.toggle('seven', view.dice[0] + view.dice[1] === 7);
    }

    // 相手は奥（#opponents）に、自分の次の手番の人から順に左から並べる。自分は手前（#me-row、手札の上）に1行で出す
    // 観戦（自分がいない）のときは、全員を奥に並べる
    renderPlayers(view) {
        const me = view.me;
        const count = view.players.length;
        const others = me
            ? Array.from({ length: count - 1 }, (_, i) => view.players[(me.id + 1 + i) % count])
            : view.players;
        const opponents = $('opponents');
        opponents.replaceChildren(...others.map(player => this.playerRow(view, player, { tile: true })));
        opponents.style.setProperty('--count', String(others.length));
        $('me-row').replaceChildren(...(me ? [this.playerRow(view, me)] : []));
        $('me-row').classList.toggle('hidden', !me);
    }

    // プレイヤーの欄。tile：相手の札（1段目に名前と点数、その下に手札・発展・騎士・道）
    playerRow(view, player, { tile = false } = {}) {
        const row = element('div', { className: `player${tile ? ' tile' : ''}` });
        row.dataset.seat = player.id;
        // リアルタイムモードでは、まだ完了していない人を金色の枠にし、完了した人には「完了」を出す
        const acting = view.realtime ? !view.done[player.id] : player.id === view.currentPlayerId;
        row.classList.toggle('current', acting && view.phase !== 'end');
        row.classList.toggle('finished', Boolean(view.realtime && view.done[player.id]));
        row.classList.toggle('me', player === view.me);
        const swatch = element('span', { className: 'swatch' });
        swatch.style.background = PLAYER_COLORS[player.id];
        const name = element('span', { className: 'name', text: player.name });
        // 手札・発展カードの枚数、使った騎士の数。最大騎士力（2点）を持っていれば騎士の欄を金色にする
        // 道の長さは盤面でわかるので出さず、最長交易路（2点）を持っている人にだけ金色の「道」を出す
        const stats = element('span', { className: 'stats' });
        // 項目名は、狭い札では1文字（短い名前）にする（CSS で切り替える）
        const SHORT = { cards: '札', devs: '発', knights: '騎', roads: '道' };
        const stat = (cls, label, value, title, award = false) => {
            const item = element('span', { className: `stat ${cls}${award ? ' award' : ''}`, title });
            const name = element('span', { className: 'stat-label' }, [element('span', { className: 'full', text: label }), element('span', { className: 'short', text: SHORT[cls] })]);
            item.append(name, element('span', { className: 'stat-value', text: String(value) }));
            stats.append(item);
        };
        stat('cards', '手札', player.cardCount, '手札の枚数');
        stat('devs', '発展', player.devCardCount, '発展カードの枚数');
        stat('knights', '騎士', player.knights, view.largestArmy === player.id ? '使った騎士の数（最大騎士力 2点）' : '使った騎士の数', view.largestArmy === player.id);
        // 相手の札では、名前の行（点数の左）に出す
        if (view.longestRoad === player.id && !tile) stat('roads', '道', player.roadLength, '一番長い道の長さ（最長交易路 2点）', true);
        const points = element('span', { className: 'points', text: String(player.points), title: '勝利点' });
        if (tile) {
            // 札では色の印の代わりに、上の縁をその人の色にする（狭い札でも名前の幅を取れるように）
            row.style.setProperty('--player-color', PLAYER_COLORS[player.id]);
            const head = element('div', { className: 'tile-head' }, [name]);
            if (view.longestRoad === player.id) head.append(element('span', { className: 'stat roads award', text: '道', title: `最長交易路 2点（道の長さ ${player.roadLength}）` }));
            head.append(points);
            if (player.proxy) head.append(element('span', { className: 'badge muted', text: '代行' }));
            row.append(head, stats);
        } else {
            row.append(swatch, name, stats, points);
            if (player.proxy) row.append(element('span', { className: 'badge muted', text: '代行' }));
        }
        return row;
    }

    // 今すべきこと。なければ最新の出来事
    guideText(view) {
        const me = view.me;
        if (view.phase === 'end') return view.logs.at(-1) ?? '';
        if (view.discardCount > 0) return `手札を${view.discardCount}枚捨ててください`;
        if (view.pending?.type === 'discard') return '手札を捨てる人を待っています';
        if (view.tradeWaiting) return `${view.players[view.trade.from].name}からの交換の申し出です`;
        if (view.realtime && view.me && view.done[view.me.id]) {
            const left = view.done.filter(d => !d).length;
            return `ほかの人の完了を待っています（あと${left}人）`;
        }
        if (!view.isMyTurn) return view.logs.at(-1) ?? '';
        if (view.phase === 'setup') {
            return view.setup.step === 'settlement' ? '開拓地を置く場所を選んでください' : '開拓地から伸ばす道を選んでください';
        }
        if (view.pending?.type === 'robber') return '盗賊を動かすタイルを選んでください';
        if (view.pending?.type === 'roadBuilding') return `道を置く場所を選んでください（あと${view.pending.remaining}本）`;
        if (this.mode) return `${PIECE_NAMES[this.mode]}を建てる場所を選んでください`;
        if (!view.rolled) return 'サイコロを振ってください';
        if (view.trade) return '交換の返事を待っています';
        return me ? (view.logs.at(-1) ?? '') : '';
    }

    renderGuide(view) {
        $('guide').textContent = this.guideText(view);
    }

    renderTradeStatus(view) {
        const box = $('trade-status');
        const trade = view.trade;
        box.classList.toggle('hidden', !trade);
        if (!trade) return;
        box.replaceChildren();
        const from = view.players[trade.from];
        const offer = element('div', { className: 'offer' });
        offer.append(element('span', { className: 'who', text: from === view.me ? 'あなた' : from.name }), cardsLine(trade.give), element('span', { className: 'arrow', text: '⇄' }), cardsLine(trade.get));
        box.append(offer);

        if (from === view.me) {
            const replies = element('div', { className: 'replies' });
            // 誰かが受けたら、その場で交換される
            view.players.filter(p => p !== from).forEach(player => {
                const response = trade.responses[player.id];
                replies.append(element('span', { className: 'reply', text: `${player.name}：${response === 'reject' ? '見送り' : '…'}` }));
            });
            replies.append(element('button', { className: 'small', text: '取り下げる', onClick: () => this.send({ type: 'cancelTrade' }) }));
            box.append(replies);
        } else if (view.me) {
            const replies = element('div', { className: 'replies' });
            if (view.tradeWaiting) {
                const canAccept = hasCards(view.me.hand, trade.get);
                const hint = this.hint(view);
                const mark = (accept) => (hint?.type === 'respondTrade' && hint.accept === accept ? ' recommended' : '');
                replies.append(element('button', { className: `small primary${mark(true)}`, text: '受ける', disabled: !canAccept, onClick: () => this.send({ type: 'respondTrade', id: trade.id, accept: true }) }));
                replies.append(element('button', { className: `small${mark(false)}`, text: '断る', onClick: () => this.send({ type: 'respondTrade', id: trade.id, accept: false }) }));
            } else {
                const answer = hasCards(view.me.hand, trade.get) ? '断りました' : '持っていないので断りました';
                replies.append(element('span', { className: 'reply', text: answer }));
            }
            box.append(replies);
        }
    }

    renderHand(view) {
        const hand = $('hand');
        hand.replaceChildren();
        const me = view.me;
        if (!me) return;
        RESOURCES.forEach(r => {
            const count = me.hand[r];
            const card = element('div', { className: `res-card res-${r}${count === 0 ? ' empty' : ''}`, title: RESOURCE_NAMES[r] });
            card.append(resourceIcon(r), element('span', { className: 'count', text: String(count) }));
            hand.append(card);
        });
    }

    renderActions(view) {
        const me = view.me;
        const canAct = this.canAct(view);
        $('actions').classList.toggle('hidden', !me || view.phase === 'end');
        if (!me) return;
        $('act-roll').disabled = !(canAct && !view.rolled);
        if (view.realtime) {
            // サイコロは巡のはじめに自動で振るので出さない。完了したら、全員を待つ
            const finished = view.done[me.id];
            $('act-roll').classList.add('hidden');
            $('act-end').classList.remove('hidden');
            $('act-end').textContent = finished ? '待っています' : '完了';
        } else {
            $('act-roll').classList.toggle('hidden', view.rolled && view.isMyTurn);
            $('act-end').classList.toggle('hidden', !(view.rolled && view.isMyTurn));
            $('act-end').textContent = '手番を終える';
        }
        ['road', 'settlement', 'city'].forEach(piece => {
            const button = $(`act-${piece}`);
            button.disabled = !this.canBuild(view, piece);
            button.classList.toggle('selected', this.mode === piece);
            // アシストが ON なら、足りない資源の図柄を薄くする
            const cost = cardsLine(COSTS[piece]);
            cost.classList.add('cost');
            if (this.assist) {
                let index = 0;
                RESOURCES.forEach(r => {
                    for (let i = 0; i < (COSTS[piece][r] ?? 0); i++, index++) {
                        if (i >= me.hand[r]) cost.children[index].classList.add('lack');
                    }
                });
            }
            button.replaceChildren(element('span', { className: 'label' }, [pieceIcon(piece, me.id), PIECE_NAMES[piece]]), cost);
        });
        const devButton = $('act-dev');
        devButton.disabled = view.phase !== 'play';
        devButton.dataset.count = me.devCardCount > 0 ? String(me.devCardCount) : '';
        devButton.classList.toggle('ready', view.options?.playableDevCards.length > 0);
        $('act-trade').disabled = !(canAct && view.rolled);
        $('act-end').disabled = !(canAct && view.rolled);

        // アシスト：おすすめの操作のボタンに★
        const hint = this.mode ? null : this.hint(view);
        const hinted = hint && view.phase === 'play' && view.isMyTurn && !view.pending ? {
            build: `act-${hint.piece}`, bankTrade: 'act-trade', buyDevCard: 'act-dev', playDev: 'act-dev', endTurn: 'act-end'
        }[hint.type] : null;
        ['act-road', 'act-settlement', 'act-city', 'act-dev', 'act-trade', 'act-end'].forEach(id => {
            $(id).classList.toggle('recommended', id === hinted && !$(id).disabled);
        });
    }

    renderLog(view) {
        const log = $('log');
        log.replaceChildren(...[...view.logs].reverse().slice(0, 40).map(text => element('li', { text })));
    }

    // ===== ダイアログ =====

    renderDialogs(view) {
        if (!view) return;
        // 手札を捨てる：必要なときは自動で開き、済んだら閉じる
        const discard = $('discard-dialog');
        if (view.discardCount > 0) {
            if (!discard.open) {
                this.discardChoice = {};
                this.closeDialogs();
                this.showModal(discard);
            }
            this.renderDiscardDialog(view);
        } else if (discard.open) {
            discard.close();
        }
        if ($('trade-dialog').open) {
            if (!(this.canAct(view) && view.rolled)) $('trade-dialog').close();
            else this.renderTradeDialog(view);
        }
        if ($('dev-dialog').open) {
            if (view.phase !== 'play' || !view.me) $('dev-dialog').close();
            else this.renderDevDialog(view);
        }
        if ($('victim-dialog').open && view.pending?.type !== 'robber') $('victim-dialog').close();
    }

    // 資源ごとの枚数を選ぶ欄（max: 資源ごとの上限、total: 全体の上限）
    // owned: 資源ごとの手持ちの枚数（渡すと、各資源の下に「手持ち n」を出す）
    renderPicker(container, choice, { max, total = Infinity, owned = null, onChange }) {
        container.replaceChildren();
        const sum = countCards({ ...Object.fromEntries(RESOURCES.map(r => [r, 0])), ...choice });
        RESOURCES.forEach(r => {
            const count = choice[r] ?? 0;
            const cell = element('div', { className: 'pick' });
            const plus = element('button', {
                className: `res-card res-${r}`, title: RESOURCE_NAMES[r],
                disabled: count >= max(r) || sum >= total,
                onClick: () => {
                    choice[r] = count + 1;
                    onChange();
                }
            });
            plus.append(resourceIcon(r), element('span', { className: 'count', text: String(count) }));
            const minus = element('button', {
                className: 'small minus', text: '−', disabled: count === 0,
                onClick: () => {
                    choice[r] = count - 1;
                    onChange();
                }
            });
            cell.append(plus);
            if (owned) cell.append(element('span', { className: 'owned', text: `手持ち ${owned(r)}` }));
            cell.append(minus);
            container.append(cell);
        });
    }

    renderDiscardDialog(view) {
        const required = view.discardCount;
        const chosen = countCards({ ...Object.fromEntries(RESOURCES.map(r => [r, 0])), ...this.discardChoice });
        $('discard-note').textContent = chosen < required ? `あと${required - chosen}枚選んでください` : `${required}枚を捨てます`;
        this.renderPicker($('discard-picker'), this.discardChoice, {
            max: (r) => view.me.hand[r], total: required, owned: (r) => view.me.hand[r],
            onChange: () => this.renderDiscardDialog(view)
        });
        $('discard-confirm').disabled = chosen !== required;
        $('discard-auto').classList.toggle('hidden', this.hint(view)?.type !== 'discard');
    }

    renderTradeDialog(view) {
        if (!view?.me) return;
        document.querySelectorAll('#trade-dialog [data-tab]').forEach(button => {
            button.classList.toggle('selected', button.dataset.tab === this.tradeTab);
        });
        $('trade-bank').classList.toggle('hidden', this.tradeTab !== 'bank');
        $('trade-players').classList.toggle('hidden', this.tradeTab !== 'players');
        const me = view.me;

        // 銀行・港
        const ratios = view.options?.tradeRatios ?? {};
        const giveRow = $('bank-give');
        giveRow.replaceChildren(...RESOURCES.map(r => {
            const button = element('button', {
                className: `res-card res-${r}${this.bankChoice.give === r ? ' selected' : ''}`,
                disabled: me.hand[r] < ratios[r],
                onClick: () => {
                    this.bankChoice.give = r;
                    if (this.bankChoice.get === r) this.bankChoice.get = null;
                    this.renderTradeDialog(this.view());
                }
            });
            button.append(resourceIcon(r), element('span', { className: 'count', text: `${ratios[r]}:1` }));
            // 交渉の欄と同じく、下に手持ちの枚数を出す
            const cell = element('div', { className: 'pick' });
            cell.append(button, element('span', { className: 'owned', text: `手持ち ${me.hand[r]}` }));
            return cell;
        }));
        const getRow = $('bank-get');
        getRow.replaceChildren(...RESOURCES.map(r => {
            const button = element('button', {
                className: `res-card res-${r}${this.bankChoice.get === r ? ' selected' : ''}`,
                disabled: r === this.bankChoice.give || view.bank[r] === 0,
                onClick: () => {
                    this.bankChoice.get = r;
                    this.renderTradeDialog(this.view());
                }
            });
            button.append(resourceIcon(r));
            return button;
        }));
        $('bank-confirm').disabled = !(this.bankChoice.give && this.bankChoice.get && me.hand[this.bankChoice.give] >= ratios[this.bankChoice.give]);

        // プレイヤーとの交渉
        const rerender = () => this.renderTradeDialog(this.view());
        this.renderPicker($('offer-give'), this.offer.give, { max: (r) => me.hand[r], owned: (r) => me.hand[r], onChange: rerender });
        this.renderPicker($('offer-get'), this.offer.get, { max: () => 9, onChange: rerender });
        const sum = (cards) => Object.values(cards).reduce((a, b) => a + b, 0);
        const overlap = RESOURCES.some(r => this.offer.give[r] > 0 && this.offer.get[r] > 0);
        $('offer-confirm').disabled = !(sum(this.offer.give) > 0 && sum(this.offer.get) > 0 && !overlap);
    }

    renderDevDialog(view) {
        const me = view.me;
        const canAct = this.canAct(view);
        const buy = $('dev-buy');
        buy.disabled = !(canAct && view.rolled && view.devDeckCount > 0 && hasCards(me.hand, COSTS.devCard));
        if (!buy.querySelector('.cards-line')) {
            buy.replaceChildren('買う', cardsLine(COSTS.devCard));
        }
        const hint = this.hint(view);
        buy.classList.toggle('recommended', hint?.type === 'buyDevCard' && !buy.disabled);
        $('dev-deck-count').textContent = `山札 ${view.devDeckCount}枚`;

        const list = $('dev-list');
        list.replaceChildren();
        const counts = {};
        const fresh = {};
        me.devCards.forEach(card => {
            counts[card.type] = (counts[card.type] ?? 0) + 1;
            if (card.turn >= view.turnNumber) fresh[card.type] = (fresh[card.type] ?? 0) + 1;
        });
        const playable = view.options?.playableDevCards ?? [];
        if (me.devCards.length === 0) list.append(element('p', { className: 'hint', text: '発展カードを持っていません' }));
        Object.keys(DEV_NAMES).filter(type => counts[type]).forEach(type => {
            const row = element('div', { className: 'dev-card' });
            const info = element('div', { className: 'dev-info' });
            const title = element('strong', { text: `${DEV_NAMES[type]} ×${counts[type]}` });
            info.append(title, element('span', { className: 'hint', text: DEV_TEXTS[type] + (fresh[type] && type !== 'victoryPoint' ? `（${fresh[type]}枚は次の手番から）` : '') }));
            row.append(info);
            if (type !== 'victoryPoint') {
                const recommended = hint?.type === 'playDev' && hint.card === type;
                row.append(element('button', {
                    className: `small primary${recommended ? ' recommended' : ''}`, text: '使う', disabled: !playable.includes(type),
                    onClick: () => this.playDev(type)
                }));
            }
            list.append(row);
        });

        // 収穫・独占で、資源を選ぶ
        const choose = $('dev-choose');
        choose.classList.toggle('hidden', !this.devChoice);
        if (this.devChoice) {
            const { card, picks } = this.devChoice;
            const total = card === 'yearOfPlenty' ? 2 : 1;
            const chosen = Object.values(picks).reduce((a, b) => a + b, 0);
            $('dev-choose-note').textContent = card === 'yearOfPlenty' ? 'もらう資源を2枚選んでください' : '独占する資源を選んでください';
            this.renderPicker($('dev-choose-row'), picks, {
                max: (r) => (card === 'yearOfPlenty' ? Math.min(2, view.bank[r]) : 1), total,
                onChange: () => this.renderDevDialog(this.view())
            });
            $('dev-choose-confirm').disabled = chosen !== total;
        }
    }

    playDev(type) {
        if (type === 'yearOfPlenty' || type === 'monopoly') {
            // アシストが ON なら、おすすめの資源を選んでおく
            const hint = this.hint(this.view());
            const picks = {};
            if (hint?.type === 'playDev' && hint.card === type) {
                (hint.resources ?? [hint.resource]).forEach(r => { picks[r] = (picks[r] ?? 0) + 1; });
            }
            this.devChoice = { card: type, picks };
            this.renderDevDialog(this.view());
            return;
        }
        if (this.send({ type: 'playDev', card: type })) $('dev-dialog').close();
    }

    // ===== 結果 =====

    renderResult(view) {
        const box = $('result');
        const ended = view.phase === 'end' && view.result;
        box.classList.toggle('hidden', !ended);
        if (!ended) return;
        box.replaceChildren();
        const winner = view.players[view.result.winnerId];
        const panel = element('div', { className: 'result-panel' });
        panel.append(element('h2', { text: winner === view.me ? 'あなたの勝ち！' : `${winner.name}の勝ち` }));
        const table = element('ol', { className: 'ranking' });
        [...view.players].sort((a, b) => view.result.points[b.id] - view.result.points[a.id]).forEach(player => {
            const item = element('li');
            const swatch = element('span', { className: 'swatch' });
            swatch.style.background = PLAYER_COLORS[player.id];
            const vp = (player.devCards ?? []).filter(c => c.type === 'victoryPoint').length;
            item.append(swatch, element('span', { className: 'name', text: player.name }), element('span', { className: 'points', text: `${view.result.points[player.id]}点` }));
            if (vp > 0) item.append(element('span', { className: 'hint', text: `（勝利点カード${vp}枚）` }));
            table.append(item);
        });
        panel.append(table);

        const buttons = element('div', { className: 'buttons' });
        if (this.controller instanceof LocalGameController) {
            buttons.append(element('button', { className: 'primary', text: 'もう一度', onClick: () => this.startLocal(this.localPlayers) }));
        } else if (this.online) {
            const lobby = this.online.lobby;
            if (lobby?.status === 'ended' && this.online.isHost()) {
                buttons.append(element('button', { className: 'primary', text: 'もう一度', onClick: () => this.online.startGame() }));
            }
            buttons.append(element('button', { text: '部屋に戻る', onClick: () => this.online.backToLobby() }));
        }
        buttons.append(element('button', { text: 'ホーム', onClick: () => this.goHome() }));
        panel.append(buttons);
        box.append(panel);
    }

    // ===== 音・自動の操作 =====

    playSounds(previous, view) {
        if (!previous || previous.phase === undefined) return;
        if (view.result && !previous.result) {
            playEffect('win');
            return;
        }
        const rolledNow = view.dice && (!previous.dice || previous.turnNumber !== view.turnNumber || (previous.dice && !previous.rolled));
        if (rolledNow && view.rolled && !previous.rolled) {
            playEffect('dice');
            const sum = view.dice[0] + view.dice[1];
            if (sum === 7) playEffect('robber', { delay: 0.45 });
            else if (view.me && view.me.cardCount > (previous.me?.cardCount ?? 0)) playEffect('gain', { delay: 0.45 });
        }
        const count = (v) => v.buildings.filter(Boolean).length + v.buildings.filter(b => b?.type === 'city').length + v.roads.filter(r => r !== null).length;
        if (count(view) > count(previous)) playEffect('build');
        if (view.trade && !previous.trade) playEffect('card');
        if (view.isMyTurn && !previous.isMyTurn && view.phase === 'play' && view.me?.id === previous.me?.id) playEffect('turn');
    }

    // サイコロを振るしかないときは、少し間を置いて自動で振る
    scheduleAutoRoll(view) {
        clearTimeout(this.autoTimer);
        const onlyRoll = (v) => v && this.canAct(v) && !v.rolled && (v.options?.playableDevCards.length ?? 0) === 0;
        if (!onlyRoll(view)) return;
        this.autoTimer = setTimeout(() => {
            const current = this.view();
            if (this.screen === 'game' && onlyRoll(current) && !document.querySelector('dialog[open]')) this.send({ type: 'roll' });
        }, AUTO_ROLL_DELAY_MS);
    }

    toast(message) {
        const toast = $('toast');
        toast.textContent = message;
        toast.classList.remove('hidden');
        clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => toast.classList.add('hidden'), TOAST_MS);
    }
}
