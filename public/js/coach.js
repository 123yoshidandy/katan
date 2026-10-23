/**
 * 作戦の表示：ゲームの流れがわかるように、「目標 → そのために必要なもの → だから今すること」を3行で説明する
 * 例） 目標：都市で+1点・資源2倍／必要：小麦2・鉄3（鉄があと3枚）／だから：手番を終え、⑤が出るのを待つ
 * 横画面（667x375）の右の列で切れないよう、文は全角15字くらいまでにする
 * 「だから」の行は、★のおすすめの手（view.options.suggestion）と同じことを、理由と一緒に言う
 * ビューだけから決める（オンライン対戦でも、ブラウザの中で計算する）
 *
 * coachStory（ビュー → 3行の中身のデータ）は DOM を使わない。renderCoach がそれを描く
 */

import { RESOURCES, RESOURCE_NAMES, COSTS, PIECE_NAMES, DEV_NAMES, countCards } from './game.js';
import { GEOMETRY, pips } from './board.js';
import { resourceIcon } from './board-view.js';

// 目標ごとの説明（1行目）
const GOALS = {
    city: '都市で+1点・資源2倍',
    settlement: '開拓地で+1点・資源が増える',
    road: '道で開拓地の場所を作る',
    devCard: '発展カードで騎士・勝利点'
};

// だからの行で、発展カードを使う理由
const DEV_REASONS = {
    knight: '騎士で盗賊を動かす',
    roadBuilding: '街道建設で道を2本置く',
    yearOfPlenty: '収穫で足りない資源をもらう',
    monopoly: '独占で全員から集める'
};

// 3行の中身。隠すときは null
// { goal: 部品の列, points: あと何点（なければ null）, need: 部品の列, action: 部品の列 }
// 部品：文字列 / { icon: 資源, dim } / { chip: { number, blocked } } / { star: true }
// mode: 建てる場所を選んでいるもの（road / settlement / city。画面の状態）
export function coachStory(view, mode = null) {
    const me = view?.me;
    if (!me || view.phase === 'end' || !view.options) return null;
    const hint = view.options.suggestion?.command ?? null;
    const star = (parts) => (hint ? [...parts, { star: true }] : parts);
    const remaining = Math.max(0, view.winPoints - me.points);

    // 初期配置：資源の出る場所を取る
    if (view.phase === 'setup') {
        const step = view.isMyTurn ? view.setup.step : null;
        return {
            goal: ['資源の出る場所に開拓地を置く'],
            points: null,
            need: ['資源は、出た目のタイルに接すると出る'],
            action: step === 'settlement' ? star(['点の多い数字の近くに置く'])
                : step === 'road' ? star(['次の開拓地の方へ道を置く'])
                    : ['点の多い数字・違う資源の場所を探す']
        };
    }

    // 7 が出た：手札を捨てる
    if (view.discardCount > 0) {
        return {
            goal: ['7が出た。手札を半分捨てる'],
            points: remaining,
            need: ['8枚以上持っていると、半分捨てる'],
            action: [`目標に使わない資源から${view.discardCount}枚捨てる`]
        };
    }

    // 交換の申し出への返事
    if (view.tradeWaiting && hint?.type === 'respondTrade') {
        const trade = view.trade;
        return {
            goal: [`${view.players[trade.from].name}からの交換の申し出`],
            points: remaining,
            need: [...cardParts(trade.give), 'をもらい', ...cardParts(trade.get), 'を渡す'],
            action: star([hint.accept ? '目標に要る資源なので受ける' : '得にならないので断る'])
        };
    }

    // 盗賊を動かす（7 か騎士）
    if (view.isMyTurn && view.pending?.type === 'robber') {
        return {
            goal: ['盗賊で相手の資源を止める'],
            points: remaining,
            need: ['盗賊のタイルは資源が出なくなる'],
            action: star(['点の多い相手のタイルを止める'])
        };
    }

    // 街道建設
    if (view.isMyTurn && view.pending?.type === 'roadBuilding') {
        return {
            goal: [`道を無料で置ける（あと${view.pending.remaining}本）`],
            points: remaining,
            need: ['開拓地は自分の道の先にだけ建つ'],
            action: star(['開拓地を置ける場所の方へ伸ばす'])
        };
    }

    // ふだん：次に建てたいもの（なければ発展カード）を目標にする
    const goal = view.options.goal;
    const piece = goal?.piece ?? 'devCard';
    const cost = COSTS[piece];
    const sources = resourceSources(view, me.id);
    const missing = Object.fromEntries(RESOURCES.map(r => [r, Math.max(0, (cost[r] ?? 0) - me.hand[r])]));
    const lacking = RESOURCES.filter(r => missing[r] > 0);
    const lackCount = countCards(missing);

    // 必要：材料（足りないものは薄く）と、足りない枚数
    const need = [];
    RESOURCES.forEach(r => {
        for (let i = 0; i < (cost[r] ?? 0); i++) need.push({ icon: r, dim: i >= me.hand[r] });
    });
    need.push(lackCount === 0 ? '揃っている' : `${lacking.map(r => RESOURCE_NAMES[r]).join('・')}があと${lackCount}枚`);

    return { goal: [GOALS[piece]], points: remaining, need, action: turnAction(view, hint, { piece, lacking, sources, star, mode }) };
}

// だから：今すること
function turnAction(view, hint, { piece, lacking, sources, star, mode }) {
    const waitFor = () => {
        const chips = lacking.flatMap(r => sources[r]).filter(s => !s.blocked);
        if (lacking.length === 0) return null;
        if (chips.length === 0) return null;
        return uniqueChips(chips).map(chip => ({ chip }));
    };

    // 相手の番：待っている間に何が起きればよいか
    if (!view.isMyTurn) {
        if (lacking.length === 0) return ['揃った。次の番で建てる'];
        const chips = waitFor();
        return chips ? [...chips, 'が出れば手に入る'] : ['自分の番に交換で手に入れる'];
    }
    if (view.trade) return ['相手の返事を待つ'];
    if (mode) {
        const text = `光っている場所に${PIECE_NAMES[mode]}を建てる`;
        return hint?.type === 'build' && hint.piece === mode ? star([text]) : [text];
    }
    if (!hint) return [];
    switch (hint.type) {
        case 'roll': return ['まずサイコロを振り、資源をもらう'];
        case 'build':
            return star([hint.piece === piece ? `材料が揃ったので${PIECE_NAMES[hint.piece]}を建てる` : `${PIECE_NAMES[hint.piece]}を建てる`]);
        case 'bankTrade': {
            const ratio = view.options.tradeRatios[hint.give];
            return star(['余った', { icon: hint.give }, `${ratio}枚を`, { icon: hint.get }, 'に交換']);
        }
        case 'buyDevCard': return star(['余った資源で発展カードを買う']);
        case 'playDev': return star([DEV_REASONS[hint.card] ?? `${DEV_NAMES[hint.card]}を使う`]);
        case 'endTurn': {
            const chips = waitFor();
            return star(chips ? ['手番を終え、', ...chips, 'を待つ'] : ['手番を終える。次は交換を狙う']);
        }
        default: return [];
    }
}

const cardParts = (cards) => RESOURCES.flatMap(r => Array(cards[r] ?? 0).fill({ icon: r }));

// 同じ数字の札は1つにまとめる（出やすい順のまま、最大3つ）
function uniqueChips(chips) {
    const seen = new Set();
    return chips
        .sort((a, b) => pips(b.number) - pips(a.number))
        .filter(c => (seen.has(c.number) ? false : seen.add(c.number)))
        .slice(0, 3);
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

function renderParts(line, parts) {
    parts.forEach(part => {
        if (typeof part === 'string') line.append(el('span', 'coach-text', part));
        else if (part.icon) {
            const icon = resourceIcon(part.icon, 'mini-icon');
            if (part.dim) icon.classList.add('lack');
            line.append(icon);
        } else if (part.chip) line.append(numberChip(part.chip));
        else if (part.star) line.append(el('span', 'coach-star', '★'));
    });
}

// container: #coach / view: hydrateGameView したビュー / options: { assist（OFF なら隠す）, mode }
// 出したら true を返す（出している間は、上の1行の案内を隠す）
export function renderCoach(container, view, { assist, mode = null } = {}) {
    const story = assist ? coachStory(view, mode) : null;
    container.classList.toggle('hidden', !story);
    if (!story) {
        container.replaceChildren();
        return false;
    }
    const line = (tag, parts, className = '') => {
        const row = el('div', `coach-line ${className}`.trim());
        row.append(el('span', 'coach-tag', tag));
        const body = el('span', 'coach-body');
        renderParts(body, parts);
        row.append(body);
        return row;
    };
    const goal = line('目標', story.goal, 'coach-goal');
    if (story.points !== null) goal.append(el('span', 'coach-points', `あと${story.points}点`));
    container.replaceChildren(goal, line('必要', story.need), line('だから', story.action, 'coach-action'));
    return true;
}
