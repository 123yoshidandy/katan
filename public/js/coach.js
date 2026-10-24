/**
 * 作戦の表示：ゲームの流れがわかるように、今の状況を短い文章で説明する
 * 「なぜそれを目指すか → 何が足りないか → だから今どうするか」がつながるように、場面ごとに文を組み立てる
 * 例） 都市にすると1点増え、資源も2倍です。[小麦小麦鉄鉄鉄]のうち、鉄があと3枚足りません。⑤⑨で出るので、手番を終えて待ちます★
 * 横の小さい画面（667x375）でも4行に収まるよう、前の文で言ったこと（足りない資源の名前など）はくり返さない
 * 最後の文（今すること）は太字にし、★のおすすめの手（view.options.suggestion）と同じ手を言う
 * ビューだけから決める（オンライン対戦でも、ブラウザの中で計算する）
 *
 * coachStory（ビュー → 文の列のデータ）は DOM を使わない。renderCoach がそれを描く
 */

import { RESOURCES, RESOURCE_NAMES, COSTS, PIECE_NAMES, countCards } from './game.js';
import { GEOMETRY, pips } from './board.js';
import { resourceIcon } from './board-view.js';

// 目指すものと、その理由（最初の文）
const WHY = {
    city: '都市にすると1点増え、資源も2倍です。',
    settlement: '開拓地を建てると1点増え、資源も増えます。',
    road: '開拓地を置ける場所がないので、道を伸ばします。',
    devCard: '建てる物がないので、発展カードを集めます。'
};

// 文の列。隠すときは null
// [{ parts: 部品の列, strong }]（strong の文は太字。今すること）
// 部品：文字列 / { icon: 資源, dim } / { chip: { number, blocked } } / { star: true }
// mode: 建てる場所を選んでいるもの（road / settlement / city。画面の状態）
export function coachStory(view, mode = null) {
    const me = view?.me;
    if (!me || view.phase === 'end' || !view.options) return null;
    const hint = view.options.suggestion?.command ?? null;
    const say = (...parts) => ({ parts });
    const act = (...parts) => ({ parts: hint ? [...parts, { star: true }] : parts, strong: true });

    // 初期配置：資源の出る場所を取る
    if (view.phase === 'setup') {
        const step = view.isMyTurn ? view.setup.step : null;
        if (step === 'road') return [say('開拓地は、道の先にしか建てられません。'), act('次に開拓地を置きたい方へ、道を伸ばします')];
        return [
            say('資源は、サイコロで出た数字のタイルに接する開拓地に入ります。'),
            step === 'settlement' ? act('7に近い数字（6・8は赤）の近くに置くと、よく集まります') : say('7に近い数字の近くが狙い目です。')
        ];
    }

    // 7 が出た：手札を捨てる
    if (view.discardCount > 0) {
        return [say('7が出たとき、手札が8枚以上あると半分を捨てます。'), { parts: [`次に建てたい物に使わない資源から、${view.discardCount}枚捨てます`], strong: true }];
    }

    // 交換の申し出への返事
    if (view.tradeWaiting && hint?.type === 'respondTrade') {
        const trade = view.trade;
        return [
            say(`${view.players[trade.from].name}が、`, ...cardParts(trade.give), 'を渡すので', ...cardParts(trade.get), 'がほしいそうです。'),
            hint.accept ? act('欲しい資源が手に入るので、受けます') : act('得にならないので、断ります')
        ];
    }

    // 盗賊を動かす（7 か騎士）
    if (view.isMyTurn && view.pending?.type === 'robber') {
        return [say('盗賊を置いたタイルは資源が出なくなり、そこに建物を持つ人から1枚奪えます。'), act('得点の多い相手のタイルを狙います')];
    }

    // 街道建設
    if (view.isMyTurn && view.pending?.type === 'roadBuilding') {
        return [say(`街道建設で、道をあと${view.pending.remaining}本無料で置けます。`), act('開拓地を置けそうな場所へ伸ばします')];
    }

    // ふだん：次に建てたいもの（なければ発展カード）を目指す
    const piece = view.options.goal?.piece ?? 'devCard';
    const cost = COSTS[piece];
    const missing = Object.fromEntries(RESOURCES.map(r => [r, Math.max(0, (cost[r] ?? 0) - me.hand[r])]));
    const lacking = RESOURCES.filter(r => missing[r] > 0);
    const names = lacking.map(r => RESOURCE_NAMES[r]).join('と');

    // 材料（足りないものは薄く）と、足りない枚数
    const icons = [];
    RESOURCES.forEach(r => {
        for (let i = 0; i < (cost[r] ?? 0); i++) icons.push({ icon: r, dim: i >= me.hand[r] });
    });
    const need = lacking.length === 0 ? say('材料は揃っています。') : say(...icons, `のうち、${names}があと${countCards(missing)}枚足りません。`);

    // 足りない資源が出る自分の数字（盗賊のいるタイルは除く）
    const sources = resourceSources(view, me.id);
    const chips = uniqueChips(lacking.flatMap(r => sources[r]).filter(x => !x.blocked)).map(chip => ({ chip }));

    return [say(WHY[piece]), need, nextStep(view, hint, { lacking, chips, act, mode })].filter(Boolean);
}

// 今すること（最後の文）
function nextStep(view, hint, { lacking, chips, act, mode }) {
    // 相手の番：待っている間に何が起きればよいか
    if (!view.isMyTurn) {
        if (lacking.length === 0) return { parts: ['次の自分の番で建てられます'], strong: true };
        if (chips.length) return { parts: [...chips, 'が出れば手に入ります'], strong: true };
        return { parts: ['出るタイルがないので、自分の番に交換します'], strong: true };
    }
    if (view.trade) return { parts: ['持ちかけた交換の返事を待っています'], strong: true };
    if (mode) {
        const text = `光っている場所から、${PIECE_NAMES[mode]}を建てる場所を選びます`;
        return hint?.type === 'build' && hint.piece === mode ? act(text) : { parts: [text], strong: true };
    }
    if (!hint) return null;
    switch (hint.type) {
        case 'roll': return { parts: ['まずサイコロを振って、資源を集めます'], strong: true };
        case 'build': return act(`なので、${PIECE_NAMES[hint.piece]}を建てます`);
        case 'bankTrade': {
            const ratio = view.options.tradeRatios[hint.give];
            return act('余っている', { icon: hint.give }, `${ratio}枚を、銀行で`, { icon: hint.get }, 'に換えれば揃います');
        }
        case 'buyDevCard': return act('余った資源で、発展カードを買っておきます');
        case 'playDev':
            return act({
                knight: '騎士を使い、自分のタイルの盗賊を追い払います',
                roadBuilding: '街道建設で、道を2本無料で置けます',
                yearOfPlenty: '収穫で、足りない資源を2枚もらえます',
                monopoly: '独占で、みんなの資源をまとめてもらえます'
            }[hint.card]);
        case 'endTurn':
            if (lacking.length === 0) return act('今は建てる場所がないので、手番を終えます');
            if (chips.length) return act(...chips, 'で出るので、手番を終えて待ちます');
            return act('出るタイルがないので、交換で手に入れます。今は手番を終えます');
        default: return null;
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
        if (typeof part === 'string') line.append(part);
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
    const text = el('p', 'coach-text');
    story.forEach(sentence => {
        const span = el('span', sentence.strong ? 'coach-act' : '');
        renderParts(span, sentence.parts);
        text.append(span);
    });
    container.replaceChildren(text);
    return true;
}
