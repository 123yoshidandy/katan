/**
 * 演出：前のビューから新しく起きたこと（ゲームのイベント）を、動きで見せる
 * 動きは #fx（画面全体に重ねた層）の中に描き、終わったら消す。操作は止めない
 *
 * - サイコロ：振った人の色のサイコロを、自分なら盤面の手前から、ほかの人なら奥から、中央へ投げ込む
 * - 生産：出た目のタイルから、資源がもらった人へ飛ぶ（自分なら手札の欄、他人ならその人の行）
 * - 建設：払った資源が建てる場所へ飛び、建物・道が上からストンと置かれる
 * - 盗賊：前のタイルから新しいタイルへ跳ぶ。奪ったカードが奪われた人から奪った人へ飛ぶ
 * - 手札を捨てる・銀行との交換・発展カードの購入：銀行（盤面の中央）とのあいだでカードが行き来する
 * - プレイヤーどうしの交換・独占・収穫：カードが人から人へ飛ぶ
 * - 最長交易路・最大騎士力：札が前の持ち主から新しい持ち主へ移る
 */

import { GEOMETRY } from './board.js';
import { HEX_SIZE, resourceIcon } from './board-view.js';
import { RESOURCES, DEV_NAMES } from './game.js';

const FLIGHT_MS = 560;   // カードが飛ぶ時間
const THROW_MS = 700;    // サイコロを投げてから止まるまで
const DICE_HOLD_MS = 600; // 止まったサイコロを中央に見せておく時間
const DROP_MS = 380;     // 建物が落ちる時間
const ROBBER_MS = 480;   // 盗賊が跳ぶ時間
const STAGGER_MS = 70;   // 何枚も飛ぶときの間隔
const MAX_CARDS = 5;     // 1組で飛ばすカードの上限（多すぎると見づらい）
const MAX_EVENTS = 8;    // 1度に見せるイベントの上限（再接続などでたまった分は省く）
const MAX_WAIT_MS = 400; // 前の演出の終わりを待つ上限（CPU の手が続いても遅れがたまらないように）
const AWARD_NAMES = { longestRoad: '交易路', largestArmy: '騎士力' };

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

let busyUntil = 0; // 今の演出が一通り終わる時刻（performance.now）

// previous: 前のビュー（なければ null）/ view: 新しいビュー / refs: { board, fx, players, hand, dice }
export function playAnimations(previous, view, refs) {
    // 最初のビュー（開始・再接続）では見せない。別のゲームに替わったとき（番号が戻ったとき）も見せない
    if (!previous || typeof previous.eventId !== 'number' || view.eventId < previous.eventId) {
        lasting = [];
        return;
    }
    // 盤面とサイコロは描き直しで作り直されるので、途中の動きを新しい要素に付け直す
    resumeLasting();
    if (!refs.fx || !Array.isArray(view.events) || view.eventId === previous.eventId) return;
    if (document.hidden || reducedMotion()) return;
    const events = view.events.filter(e => e.id > previous.eventId).slice(-MAX_EVENTS);
    const stage = createStage(view, refs);
    const now = performance.now();
    // 前の演出が続いていれば、そのあとに続ける
    let t = Math.min(Math.max(0, busyUntil - now), MAX_WAIT_MS);
    events.forEach(event => {
        const play = PLAYERS[event.type];
        if (play) t = play(stage, event, t);
    });
    busyUntil = now + t;
}

// ===== 描き直しをまたぐ動き =====

// { root, selector, index, frames, timing, start, end, node }
let lasting = [];

// root の中の selector に合う index 番目の要素を動かす。描き直されたら resumeLasting で付け直す
function animateLasting(root, selector, index, frames, timing) {
    const start = performance.now();
    const entry = { root, selector, index, frames, timing, start, end: start + (timing.delay ?? 0) + timing.duration, node: null };
    lasting.push(entry);
    attach(entry);
}

function resumeLasting() {
    const now = performance.now();
    lasting = lasting.filter(entry => entry.end > now);
    lasting.forEach(attach);
}

function attach(entry) {
    const node = entry.root.querySelectorAll(entry.selector)[entry.index];
    if (!node || node === entry.node) return;
    entry.node = node;
    const animation = node.animate(entry.frames, entry.timing);
    // 遅れて付け直したときは、途中から始める
    animation.currentTime = performance.now() - entry.start;
}

// ===== イベントごとの演出（始める時刻 t を受け取り、次の演出を始める時刻を返す） =====

const PLAYERS = {
    roll(stage, { player, dice }, t) {
        stage.throwDice(player, dice, t);
        // 資源が飛ぶのは、サイコロが止まってから
        return t + THROW_MS;
    },

    produce(stage, { gains }, t) {
        gains.forEach((gain, i) => {
            const from = stage.hexPoint(gain.hex);
            stage.flyCards(cardsOf(gain.resource, gain.count), from, stage.seat(gain.player), t + i * STAGGER_MS, { pop: true });
        });
        return t + FLIGHT_MS;
    },

    build(stage, { player, piece, at, cost }, t) {
        let drop = t;
        if (cost) {
            const to = piece === 'road' ? stage.edgePoint(at) : stage.vertexPoint(at);
            stage.flyCards(expand(cost), stage.seat(player), { point: () => to }, t, { fadeOut: true });
            drop = t + FLIGHT_MS * 0.75;
        }
        stage.dropPiece(piece, at, drop);
        return drop + DROP_MS;
    },

    discard(stage, { player, cards, count }, t) {
        const list = cards ? expand(cards) : Array(count).fill(null);
        stage.flyCards(list, stage.seat(player), stage.bank(), t, { fadeOut: true });
        return t + FLIGHT_MS;
    },

    robber(stage, { from, to }, t) {
        stage.moveRobber(from, to, t);
        return t + ROBBER_MS - 100;
    },

    steal(stage, { from, to, resource }, t) {
        stage.flyCards([resource ?? null], stage.seat(from), stage.seat(to), t);
        return t + FLIGHT_MS;
    },

    buyDev(stage, { player, card, cost }, t) {
        stage.flyCards(expand(cost), stage.seat(player), stage.bank(), t, { fadeOut: true });
        const back = t + FLIGHT_MS * 0.6;
        stage.fly(devCard(card), stage.bank(), stage.seat(player, 'dev'), back);
        return back + FLIGHT_MS;
    },

    playDev(stage, { player, card }, t) {
        // 使ったカードを表にして、盤面の中央に見せる
        stage.fly(devCard(card), stage.seat(player, 'dev'), stage.bank(), t, { hold: 450, endScale: 1.5 });
        return t + FLIGHT_MS;
    },

    gain(stage, { player, cards }, t) {
        stage.flyCards(expand(cards), stage.bank(), stage.seat(player), t);
        return t + FLIGHT_MS;
    },

    monopoly(stage, { player, resource, taken }, t) {
        taken.forEach(({ player: from, count }, i) => {
            stage.flyCards(cardsOf(resource, count), stage.seat(from), stage.seat(player), t + i * STAGGER_MS);
        });
        return t + FLIGHT_MS;
    },

    bankTrade(stage, { player, give, count, get }, t) {
        stage.flyCards(cardsOf(give, count), stage.seat(player), stage.bank(), t, { fadeOut: true });
        const back = t + FLIGHT_MS * 0.7;
        stage.flyCards([get], stage.bank(), stage.seat(player), back);
        return back + FLIGHT_MS;
    },

    trade(stage, { from, to, give, get }, t) {
        stage.flyCards(expand(give), stage.seat(from), stage.seat(to), t);
        stage.flyCards(expand(get), stage.seat(to), stage.seat(from), t + STAGGER_MS);
        return t + FLIGHT_MS;
    },

    award(stage, { award, from, to }, t) {
        const badge = element('div', 'fx-badge', AWARD_NAMES[award]);
        const start = from === null ? stage.bank() : stage.seat(from, `award:${AWARD_NAMES[award]}`);
        const end = to === null ? stage.bank() : stage.seat(to, `award:${AWARD_NAMES[award]}`);
        stage.fly(badge, start, end, t, { fadeOut: to === null });
        return t + FLIGHT_MS;
    }
};

// ===== 盤面と画面の位置 =====

function createStage(view, refs) {
    const { board, fx } = refs;
    const center = (el) => {
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return null;
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    };
    // 盤面の SVG の座標を、画面の座標に直す
    const toScreen = (x, y) => {
        const m = board.getScreenCTM();
        return m ? { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f } : null;
    };
    const boardAt = (item) => () => toScreen(item.x * HEX_SIZE, item.y * HEX_SIZE);
    const isMe = (seat) => view.me && view.me.id === seat;

    // 席の行き先。kind: 資源の名前 / null（中身の見えないカード）/ 'dev'（発展カード）/ 'award:名前'
    // 描き直しで要素が替わるので、要素は使うときに探し直す
    const seatElement = (seat, kind) => {
        if (isMe(seat) && RESOURCES.includes(kind)) return refs.hand.querySelector(`.res-${kind}`);
        const row = refs.players.querySelector(`[data-seat="${seat}"]`);
        if (!row) return null;
        if (kind === 'dev') return row.querySelector('.stat.devs') ?? row;
        if (typeof kind === 'string' && kind.startsWith('award:')) {
            const name = kind.slice('award:'.length);
            // 称号は、その人の「道」「騎士」の欄（持っていると金色になる）へ
            return row.querySelector(name === AWARD_NAMES.longestRoad ? '.stat.roads' : '.stat.knights') ?? row.querySelector('.points') ?? row;
        }
        return row.querySelector('.stat.cards') ?? row;
    };

    const stage = {
        hexPoint: (hex) => ({ point: boardAt(GEOMETRY.hexes[hex]) }),
        vertexPoint: (vertex) => boardAt(GEOMETRY.vertices[vertex])(),
        edgePoint: (edge) => boardAt(GEOMETRY.edges[edge])(),
        // 銀行（盤面の中央）
        bank: () => ({ point: () => center(board) }),
        seat: (seat, kind) => ({ point: (k = kind) => center(seatElement(seat, k)), target: (k = kind) => seatElement(seat, k) }),

        // node を from から to へ弧を描いて飛ばす。遠いほど高く上げ、着いたら行き先を小さく弾ませる
        // options: { fadeOut: 着いたら消える, pop: 出発点で湧き出す, hold: 着いてから消えるまでの時間, endScale, kind: 行き先の種類 }
        fly(node, from, to, delay, options = {}) {
            const kind = options.kind;
            const a = from.point(kind);
            const b = to.point(kind);
            if (!a || !b) return;
            const hold = options.hold ?? 0;
            const total = FLIGHT_MS + hold;
            const flight = FLIGHT_MS / total;
            const dist = Math.hypot(b.x - a.x, b.y - a.y);
            // 遠いほど高く上げる。ただし画面の上にはみ出さない
            const lift = Math.max(0, Math.min(140, Math.max(24, dist * 0.35), Math.min(a.y, b.y) - 24));
            const endScale = options.endScale ?? 1;
            const frames = [];
            const steps = 12;
            for (let i = 0; i <= steps; i++) {
                const p = i / steps;
                const x = a.x + (b.x - a.x) * p;
                const y = a.y + (b.y - a.y) * p - lift * 4 * p * (1 - p);
                const scale = options.pop && p < 0.2 ? 0.5 + p * 2.5 : 1 + (endScale - 1) * p;
                frames.push({
                    offset: p * flight,
                    transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${scale.toFixed(3)})`,
                    opacity: p === 0 ? 0 : 1
                });
            }
            const last = frames[frames.length - 1];
            if (hold > 0) {
                frames.push({ offset: flight + (1 - flight) * 0.7, transform: last.transform, opacity: 1 });
                frames.push({ offset: 1, transform: last.transform, opacity: 0 });
            } else if (options.fadeOut) {
                last.opacity = 0;
            }
            node.style.opacity = '0';
            fx.append(node);
            const animation = node.animate(frames, { duration: total, delay, easing: 'cubic-bezier(0.45, 0, 0.35, 1)', fill: 'backwards' });
            const done = () => node.remove();
            animation.finished.then(() => {
                done();
                if (!options.fadeOut && !hold) bump(to.target?.(kind));
            }, done);
            // 裏のタブなどで終わりが届かなくても、必ず消す
            setTimeout(done, delay + total + 1000);
        },

        // 資源のカード（null は中身の見えないカード）を、少しずつずらして飛ばす
        flyCards(list, from, to, delay, options = {}) {
            list.slice(0, MAX_CARDS).forEach((resource, i) => {
                stage.fly(resourceCard(resource), from, to, delay + i * STAGGER_MS, { ...options, kind: resource ?? 'card' });
            });
        },

        // 振った人の色のサイコロを、盤面の中央へ投げ込む
        // 自分：手前（盤面の下）から、大きく見えている状態から奥へ遠ざかるように小さくなりながら
        // ほかの人：奥（盤面の上）から、小さい状態から近づくように大きくなりながら。奥のどこから来るかは人ごとに変える
        throwDice(player, values, delay) {
            const rect = board.getBoundingClientRect();
            if (!rect.width || !values) return;
            const mine = isMe(player);
            const others = view.players.map(p => p.id).filter(id => !isMe(id));
            const lane = others.length > 1 ? others.indexOf(player) / (others.length - 1) : 0.5;
            const start = mine
                ? { x: rect.left + rect.width * 0.5, y: rect.bottom + 30 }
                : { x: rect.left + rect.width * (0.25 + 0.5 * lane), y: rect.top - 30 };
            const end = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
            const total = THROW_MS + DICE_HOLD_MS;
            const landed = THROW_MS / total;
            values.forEach((value, i) => {
                const die = dieElement(value, player);
                const side = i === 0 ? -1 : 1;
                const a = { x: start.x + side * 14, y: start.y };
                const b = { x: end.x + side * 22, y: end.y + side * 4 };
                const turn = side * (mine ? 1 : -1);
                const frames = [];
                const steps = 10;
                for (let k = 0; k <= steps; k++) {
                    const p = k / steps;
                    const e = 1 - (1 - p) * (1 - p); // だんだん遅くなる
                    const x = a.x + (b.x - a.x) * e;
                    // 放物線で少し浮かせる
                    const y = a.y + (b.y - a.y) * e - 50 * 4 * e * (1 - e);
                    const scale = mine ? 1.8 - 0.8 * e : 0.55 + 0.45 * e;
                    frames.push({ offset: p * landed * 0.82, transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${(turn * 540 * (1 - e)).toFixed(0)}deg) scale(${scale.toFixed(3)})`, opacity: 1 });
                }
                // 着いたら小さくはねて止まる
                const rest = `translate(${b.x.toFixed(1)}px, ${b.y.toFixed(1)}px)`;
                frames.push({ offset: landed * 0.91, transform: `${rest} translateY(-8px) rotate(0deg) scale(1)`, opacity: 1 });
                frames.push({ offset: landed, transform: `${rest} rotate(0deg) scale(1)`, opacity: 1 });
                frames.push({ offset: landed + (1 - landed) * 0.75, transform: `${rest} rotate(0deg) scale(1)`, opacity: 1 });
                frames.push({ offset: 1, transform: `${rest} rotate(0deg) scale(1)`, opacity: 0 });
                die.style.opacity = '0';
                fx.append(die);
                const animation = die.animate(frames, { duration: total, delay: delay + i * 40, easing: 'linear', fill: 'backwards' });
                const done = () => die.remove();
                animation.finished.then(done, done);
                setTimeout(done, delay + total + 1000);
            });
            // 左下の欄のサイコロは、投げたサイコロが止まってから出す
            [...refs.dice.querySelectorAll('.die')].forEach((_, i) => {
                animateLasting(refs.dice, '.die', i, [{ opacity: 0 }, { opacity: 0, offset: 0.8 }, { opacity: 1 }],
                    { duration: THROW_MS + DICE_HOLD_MS * 0.6, delay, fill: 'backwards' });
            });
        },

        // 建物・道を上からストンと落とす（SVG の transform 属性はそのままに、translate を重ねる）
        dropPiece(piece, at, delay) {
            const selector = piece === 'road' ? `.road[data-edge="${at}"]` : `.building[data-vertex="${at}"]`;
            if (!board.querySelector(selector)) return;
            animateLasting(board, selector, 0, [
                { translate: '0 -70px', opacity: 0 },
                { opacity: 1, offset: 0.35 },
                { translate: '0 0', offset: 0.72, easing: 'ease-out' },
                { translate: '0 -7px', offset: 0.86, easing: 'ease-in' },
                { translate: '0 0' }
            ], { duration: DROP_MS, delay, easing: 'cubic-bezier(0.55, 0, 1, 0.45)', fill: 'backwards' });
        },

        // 盗賊を前のタイルから、弧を描いて跳ばす
        moveRobber(from, to, delay) {
            if (!board.querySelector('.robber') || from === to) return;
            const a = GEOMETRY.hexes[from];
            const b = GEOMETRY.hexes[to];
            const dx = (a.x - b.x) * HEX_SIZE;
            const dy = (a.y - b.y) * HEX_SIZE;
            const lift = Math.min(160, Math.max(40, Math.hypot(dx, dy) * 0.4));
            const frames = [];
            const steps = 10;
            for (let i = 0; i <= steps; i++) {
                const p = i / steps;
                const x = dx * (1 - p);
                const y = dy * (1 - p) - lift * 4 * p * (1 - p);
                frames.push({ offset: p * 0.85, translate: `${x.toFixed(1)}px ${y.toFixed(1)}px` });
            }
            frames.push({ offset: 0.92, translate: '0 -6px' });
            frames.push({ offset: 1, translate: '0 0' });
            animateLasting(board, '.robber', 0, frames, { duration: ROBBER_MS, delay, easing: 'ease-in-out', fill: 'backwards' });
        }
    };
    return stage;
}

// 振った人の色のサイコロ（左下の欄と同じ形）
function dieElement(value, owner) {
    const die = element('div', `die fx-die face-${value} owner-${owner}`);
    for (let i = 0; i < value; i++) die.append(document.createElement('i'));
    return die;
}

// 着いた先を小さく弾ませる
function bump(el) {
    if (!el?.isConnected) return;
    el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.18)' }, { transform: 'scale(1)' }], { duration: 200, easing: 'ease-out' });
}

// ===== 飛ばすもの =====

function element(tag, className, text) {
    const el = document.createElement(tag);
    el.className = className;
    if (text) el.textContent = text;
    return el;
}

function resourceCard(resource) {
    if (!resource) return element('div', 'fx-card back');
    const card = element('div', `fx-card res-${resource}`);
    card.append(resourceIcon(resource, 'fx-icon'));
    return card;
}

// 発展カード（種類が見えないときは裏向き）
function devCard(type) {
    return element('div', `fx-card dev${type ? '' : ' back'}`, type ? DEV_NAMES[type] : '');
}

// { wood: 1, brick: 2 } → ['wood', 'brick', 'brick']
const expand = (cards) => RESOURCES.flatMap(r => Array(cards?.[r] ?? 0).fill(r));
const cardsOf = (resource, count) => Array(count).fill(resource);
