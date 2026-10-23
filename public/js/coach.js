/**
 * 作戦の表示：今、何を目指して遊べばいいか（目標・理由・足りない資源の出どころ・10点までの道のり）
 * ビューだけから決める（オンライン対戦でも、ブラウザの中で計算する）
 *
 * coachPlan（ビュー → 表示する内容のデータ）は DOM を使わない。renderCoach がそれを2行に描く
 */

import { RESOURCES, COSTS, PIECE_NAMES, HAND_LIMIT, countCards } from './game.js';
import { GEOMETRY, TERRAIN_NAMES, pips } from './board.js';
import { resourceIcon } from './board-view.js';

// 目標ごとの名前と理由（1行目に出す。667x375 の右列で「あと○点」と並べて切れない長さにする）
const GOALS = {
    city: { name: PIECE_NAMES.city, reason: '+1点・取れる資源が2倍' },
    settlement: { name: PIECE_NAMES.settlement, reason: '+1点・取れる資源が増える' },
    road: { name: PIECE_NAMES.road, reason: '開拓地を置ける場所へ' },
    devCard: { name: '発展カード', reason: '騎士・勝利点' }
};

// 資源の使いみち（初期配置で出す）
const USES = [
    { resources: ['wood', 'brick'], text: '道・開拓地' },
    { resources: ['wheat', 'ore'], text: '都市' },
    { resources: ['sheep'], text: '開拓地・発展' }
];

// 作戦の内容。隠すときは null
// 初期配置: { kind: 'setup', title, reason, uses }（数字の下の点が多いほど、その数字はよく出る）
// 手番中・相手の番: { kind: 'goal', piece, title, reason, remaining, ready, needs: [{ resource, count, sources: [{ number, blocked }] }], note }
export function coachPlan(view) {
    const me = view?.me;
    if (!me || view.phase === 'end' || !view.options) return null;
    if (view.phase === 'setup') {
        // setup.step は手番の人の段階。相手の番には、次に自分が置く開拓地の選び方を出す
        const road = view.isMyTurn && view.setup?.step === 'road';
        return {
            kind: 'setup',
            title: road ? PIECE_NAMES.road : PIECE_NAMES.settlement,
            reason: road ? '次の開拓地を置きたい方へ' : '点の多い数字・違う資源',
            uses: USES
        };
    }

    const goal = view.options.goal;
    const piece = goal ? goal.piece : 'devCard';
    // 建てる場所がない（駒を使い切った）ときは、発展カードを目標にする
    const missing = goal ? goal.missing : Object.fromEntries(RESOURCES.map(r => [r, Math.max(0, (COSTS.devCard[r] ?? 0) - (me.hand[r] ?? 0))]));
    const sources = resourceSources(view, me.id);
    const needs = RESOURCES.filter(r => missing[r] > 0).map(r => ({ resource: r, count: missing[r], sources: sources[r] }));
    return {
        kind: 'goal',
        piece,
        title: GOALS[piece].name,
        reason: GOALS[piece].reason,
        remaining: Math.max(0, view.winPoints - me.points),
        ready: needs.length === 0,
        needs,
        note: coachNote(view, me)
    };
}

// 資源ごとに、自分の建物が接するタイルの数字 { wood: [{ number, blocked }], ... }（出やすい順。盗賊がいるタイルは blocked）
export function resourceSources(view, playerId) {
    const hexIds = new Set();
    view.buildings.forEach((building, vertex) => {
        if (building?.owner === playerId) GEOMETRY.vertices[vertex].hexes.forEach(id => hexIds.add(id));
    });
    const result = Object.fromEntries(RESOURCES.map(r => [r, []]));
    [...hexIds].forEach(id => {
        const hex = view.board.hexes[id];
        if (!result[hex.terrain] || !hex.number) return;
        result[hex.terrain].push({ number: hex.number, blocked: id === view.robber });
    });
    RESOURCES.forEach(r => result[r].sort((a, b) => pips(b.number) - pips(a.number) || a.number - b.number));
    return result;
}

// 状況に応じた注意（1つだけ。優先度の高い順）。なければ null
// 理由の代わりに1行目に出すので、短くする（騎士があるときは地形を省く。どの資源かは2行目の斜線の札で分かる）
function coachNote(view, me) {
    const cards = countCards(me.hand);
    if (cards > HAND_LIMIT) return `手札${cards}枚、7で半減`;
    const robbed = view.board.hexes[view.robber];
    const blocking = view.buildings.some((b, v) => b?.owner === me.id && GEOMETRY.vertices[v].hexes.includes(view.robber));
    if (blocking && robbed.number) {
        const knight = me.devCards?.some(c => c.type === 'knight');
        return knight ? `${robbed.number}に盗賊、騎士で動かす` : `${robbed.number}の${TERRAIN_NAMES[robbed.terrain]}に盗賊`;
    }
    return null;
}

// ===== 描画 =====

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

// 盤面と同じ形の、数字の札（6 と 8 は赤。盗賊がいれば斜線）
function numberChip({ number, blocked }) {
    const chip = el('span', `coach-num${number === 6 || number === 8 ? ' red' : ''}${blocked ? ' blocked' : ''}`, String(number));
    if (blocked) chip.title = '盗賊がいて出ない';
    return chip;
}

// container: #coach / view: hydrateGameView したビュー / options: { assist }（アシストが OFF なら隠す）
export function renderCoach(container, view, { assist } = {}) {
    const plan = assist ? coachPlan(view) : null;
    container.classList.toggle('hidden', !plan);
    if (!plan) {
        container.replaceChildren();
        return;
    }

    // 1行目：目標と理由（注意があれば、理由の代わりに出す）・あと何点
    const head = el('div', 'coach-line');
    head.append(el('span', 'coach-tag', '目標'), el('span', 'coach-title', plan.title));
    head.append(plan.note ? el('span', 'coach-note', plan.note) : el('span', 'coach-reason', plan.reason));
    if (plan.kind === 'goal') head.append(el('span', 'coach-points', `あと${plan.remaining}点`));

    // 2行目：足りない資源と、その出どころ
    const body = el('div', 'coach-line coach-needs');
    if (plan.kind === 'setup') {
        plan.uses.forEach(use => {
            const item = el('span', 'coach-need');
            use.resources.forEach(r => item.append(resourceIcon(r, 'mini-icon')));
            item.append(el('span', 'coach-use', use.text));
            body.append(item);
        });
    } else if (plan.ready) {
        body.append(el('span', 'coach-ready', view.isMyTurn ? '揃っています。建てられます' : '揃っています。次の番で建てられます'));
    } else {
        body.append(el('span', 'coach-label', '足りない'));
        plan.needs.forEach(need => {
            const item = el('span', 'coach-need');
            item.append(resourceIcon(need.resource, 'mini-icon'));
            if (need.count > 1) item.append(el('span', 'coach-count', `×${need.count}`));
            if (need.sources.length) need.sources.forEach(source => item.append(numberChip(source)));
            else item.append(el('span', 'coach-trade', '交換で'));
            body.append(item);
        });
    }
    container.replaceChildren(head, body);
}
