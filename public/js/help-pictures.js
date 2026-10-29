/**
 * 遊び方の図：盤面と同じ部品（タイル・数字の札・建物・道・盗賊）で、小さな場面を描く
 * index.html の [data-pic] の中に描く
 *   場面：resources / production / odds / setup / trade / harbor / longest / robber / assist
 *   文中の図柄：piece:道や建物 / res:資源 / cost:建物（材料の図柄） / dev:発展カード
 */

import {
    svg, hexPoints, numberToken, robberPiece, starPoints, resourceIcon, pieceIcon,
    BUILDING_PATHS, TERRAIN_COLORS, PLAYER_COLORS, HEX_SIZE
} from './board-view.js';
import { RESOURCES, RESOURCE_NAMES, COSTS } from './game.js';

const ME = 0; // 図の中の自分（赤）
const OTHER = 1; // 図の中の相手（青）

// 六角形の中心 (cx, cy) の頂点 i（0 が真上、時計回り）
const corner = (cx, cy, i) => {
    const angle = Math.PI / 180 * (60 * i - 90);
    return { x: cx + HEX_SIZE * Math.cos(angle), y: cy + HEX_SIZE * Math.sin(angle) };
};

function el(tag, className, children = []) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    children.forEach(child => node.append(child));
    return node;
}

// 盤面の一部を描く SVG
const scene = (viewBox, children, className = 'pic-scene') => svg('svg', { class: className, viewBox, 'aria-hidden': 'true' }, children);

// タイル（数字があれば、盤面と同じく図柄を上に寄せて札を置く。terrain が null なら、図柄のない薄いタイル）
function tile(x, y, terrain, number = null, rolled = false) {
    const group = svg('g');
    group.append(svg('polygon', { class: 'hex-tile', points: hexPoints(x, y, HEX_SIZE - 1.5), fill: terrain ? TERRAIN_COLORS[terrain] : '#e9dfc4' }));
    if (!terrain) return group;
    if (number) {
        group.append(svg('use', { href: `#sym-${terrain}`, x: x - 17, y: y - 47, width: 34, height: 34 }));
        group.append(numberToken(x, y + 8, number, rolled));
    } else {
        group.append(svg('use', { href: `#sym-${terrain}`, x: x - 24, y: y - 24, width: 48, height: 48 }));
    }
    return group;
}

const building = ({ x, y }, type, owner) => svg('path', {
    class: `building ${type}`, d: BUILDING_PATHS[type], transform: `translate(${x} ${y})`, fill: PLAYER_COLORS[owner]
});

// 道（盤面と同じく、両端を少し縮める）
function road(a, b, owner) {
    const shrink = 0.16;
    const x1 = a.x + (b.x - a.x) * shrink;
    const y1 = a.y + (b.y - a.y) * shrink;
    const x2 = b.x - (b.x - a.x) * shrink;
    const y2 = b.y - (b.y - a.y) * shrink;
    return svg('g', { class: 'road' }, [
        svg('line', { class: 'road-outline', x1, y1, x2, y2 }),
        svg('line', { class: 'road-fill', x1, y1, x2, y2, stroke: PLAYER_COLORS[owner] })
    ]);
}

function label(x, y, text, className = 'pic-label') {
    const node = svg('text', { class: className, x, y, 'text-anchor': 'middle', 'dominant-baseline': 'central' });
    node.textContent = text;
    return node;
}

const res = (resource) => resourceIcon(resource, 'mini-icon');
const resources = (resource, n) => Array.from({ length: n }, () => res(resource));
const robberIcon = () => scene('-12 -12 24 29', [robberPiece(0, 0)], 'pic-robber');
const arrow = () => el('span', 'pic-arrow', ['→']);
// 図の横に並べる説明の行
const caption = (lines) => el('div', 'pic-caption', lines.map(parts => el('div', '', parts)));

// 港の札（盤面と同じ形）
function harborBadge(type) {
    const children = [svg('circle', { class: 'harbor-badge', cx: 0, cy: 0, r: 17 })];
    if (type === 'any') children.push(label(0, 1, '3:1', ''));
    else {
        children.push(svg('use', { href: `#sym-${type}`, x: -10, y: -15, width: 20, height: 20 }));
        children.push(label(0, 10, '2:1', 'small'));
    }
    return scene('-19 -19 38 38', [svg('g', { class: 'harbor' }, children)], 'pic-badge');
}

const SCENES = {
    // タイルの図柄と、出る資源
    resources: () => el('div', 'pic-names', [
        ...RESOURCES.map(r => el('span', '', [res(r), RESOURCE_NAMES[r]])),
        el('span', '', [res('desert'), '砂漠（何も出ない）'])
    ]),

    // 8 が出ると、開拓地は1枚・都市は2枚もらえる
    production: () => el('div', 'pic-row', [
        scene('-72 -72 144 144', [tile(0, 0, 'ore', 8), building(corner(0, 0, 5), 'settlement', ME), building(corner(0, 0, 2), 'city', ME)]),
        caption([
            ['サイコロで 8 が出ると'],
            [pieceIcon('settlement', ME), '開拓地', arrow(), res('ore'), '1枚'],
            [pieceIcon('city', ME), '都市', arrow(), ...resources('ore', 2), '2枚']
        ])
    ]),

    // 数字の札：7 に近いほど大きい
    odds: () => el('div', 'pic-odds', [
        scene('0 -22 420 44', [2, 3, 4, 5, 6, 8, 9, 10, 11, 12].map((number, i) => numberToken(21 + i * 42, 0, number)), 'pic-scene pic-wide'),
        el('div', 'pic-odds-note', [el('span', '', ['出にくい']), el('span', '', ['出やすい']), el('span', '', ['出にくい'])])
    ]),

    // 初期配置の順番：1つ目は順に、2つ目は逆の順に
    // 1行に並べて、最後の人（緑）が続けて置くことが見えるようにする
    setup: () => {
        const turn = (owner) => el('span', 'pic-pair', [pieceIcon('settlement', owner), pieceIcon('road', owner)]);
        const round = (owners, name) => el('div', 'pic-round', [el('div', '', owners.map(turn)), el('div', 'pic-note', [name])]);
        return el('div', 'pic-setup', [round([0, 1, 2], '1つ目'), arrow(), round([2, 1, 0], '2つ目（逆の順）')]);
    },

    // 4:1・港での交換
    trade: () => caption([
        [el('span', 'pic-tag', ['いつでも']), ...resources('sheep', 4), arrow(), res('ore')]
    ]),

    // 港：海辺の札から線がつながった2つの角。そこに建物があれば有利に換えられる
    harbor: () => el('div', 'pic-row', [
        harborScene(),
        caption([
            [harborBadge('any'), ...resources('sheep', 3), arrow(), res('ore'), 'どの資源でも'],
            [harborBadge('sheep'), ...resources('sheep', 2), arrow(), res('ore'), '描かれた資源だけ']
        ])
    ]),

    // 5本つながった道（枝分かれの道は数えない）
    longest: () => {
        const left = { x: -HEX_SIZE * Math.sqrt(3) / 2, y: 0 };
        const right = { x: HEX_SIZE * Math.sqrt(3) / 2, y: 0 };
        const path = [corner(left.x, 0, 5), corner(left.x, 0, 0), corner(left.x, 0, 1), corner(right.x, 0, 0), corner(right.x, 0, 1), corner(right.x, 0, 2)];
        const roads = path.slice(1).map((b, i) => road(path[i], b, ME));
        const numbers = path.slice(1).map((b, i) => {
            const a = path[i];
            const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            // 道の外側（上か右）に番号を置く
            return label(i === 4 ? mid.x + 18 : mid.x, i === 4 ? mid.y : mid.y - 18, String(i + 1));
        });
        // 開拓地は道の途中に置き、そこから番号のない枝分かれの道を1本出す（一続きの長さで数えることを見せる）
        const branch = road(path[2], corner(left.x, 0, 2), ME);
        return scene('-122 -86 258 156', [tile(left.x, 0, null), tile(right.x, 0, null), ...roads, branch, building(path[2], 'settlement', ME), ...numbers], 'pic-scene pic-mid');
    },

    // 盗賊のいるタイル：資源が出ず、そこに建物を持つ人から1枚奪う
    assist: () => el('div', 'pic-row', [
        assistScene(),
        caption([
            [el('strong', '', ['光る数字']), '：出た目のタイル'],
            [el('strong', '', ['場所の数字']), '：開拓地を置ける場所の、周りの出やすさの合計'],
            [el('span', 'pic-star', ['★']), '：おすすめの場所']
        ])
    ]),

    robber: () => el('div', 'pic-row', [
        scene('-72 -72 144 144', [
            tile(0, 0, 'wheat', 6),
            svg('line', { class: 'pic-block', x1: -14, y1: 22, x2: 14, y2: -6 }),
            robberPiece(0, -28),
            building(corner(0, 0, 1), 'settlement', OTHER),
            building(corner(0, 0, 4), 'settlement', OTHER)
        ]),
        caption([
            [robberIcon(), 'のタイルは、資源が出ない'],
            [pieceIcon('settlement', OTHER), 'の人から、1枚奪う']
        ])
    ])
};

// 港の場面：海辺のタイルの辺の外に札を置き、辺の両端の角へ線を引く（盤面の renderHarbor と同じ形）
// 線の先の2つの角が港。上の角に開拓地を置き、もう1つの角は金色の輪で示す
function harborScene() {
    const a = corner(0, 0, 5);
    const b = corner(0, 0, 0);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const length = Math.hypot(mid.x, mid.y);
    const badge = { x: mid.x + mid.x / length * HEX_SIZE * 0.62, y: mid.y + mid.y / length * HEX_SIZE * 0.62 };
    const harbor = svg('g', { class: 'harbor' }, [
        ...[a, b].map(p => svg('line', { class: 'pier', x1: p.x, y1: p.y, x2: badge.x, y2: badge.y })),
        svg('circle', { class: 'harbor-badge', cx: badge.x, cy: badge.y, r: 17 }),
        label(badge.x, badge.y + 1, '3:1', '')
    ]);
    return scene('-76 -100 144 166', [
        svg('rect', { class: 'pic-sea', x: -76, y: -100, width: 144, height: 166, rx: 10 }),
        harbor,
        tile(0, 0, null),
        svg('circle', { class: 'pic-corner', cx: a.x, cy: a.y, r: 8 }),
        building(b, 'settlement', ME)
    ], 'pic-scene pic-harbor');
}

// 盤面のアシストの印：光る数字・場所の数字・★
function assistScene() {
    const spot = (point, text, best = false) => {
        const group = svg('g', { class: `spot spot-vertex${best ? ' best' : ''}` }, [svg('circle', { class: 'spot-mark', cx: point.x, cy: point.y, r: 11 })]);
        if (text) group.append(label(point.x, point.y + 1, text, 'spot-label'));
        if (best) group.append(svg('polygon', { class: 'best-star', points: starPoints(point.x + 13, point.y - 13, 11) }));
        return group;
    };
    return scene('-72 -76 150 148', [
        tile(0, 0, 'wheat', 6, true),
        spot(corner(0, 0, 5), '11'),
        spot(corner(0, 0, 1), '13', true)
    ], 'pic-scene pic-assist');
}

// 文中の小さな図柄
const DEV_ICONS = {
    knight: () => [robberIcon()],
    roadBuilding: () => [pieceIcon('road', ME), pieceIcon('road', ME)],
    yearOfPlenty: () => [res('wheat'), res('ore')],
    monopoly: () => resources('sheep', 3),
    victoryPoint: () => [el('span', 'pic-star', ['★'])]
};

function inline(kind, arg) {
    switch (kind) {
        case 'piece': return [pieceIcon(arg, ME)];
        case 'res': return [res(arg)];
        case 'cost': return RESOURCES.flatMap(r => resources(r, COSTS[arg][r] ?? 0));
        case 'dev': return DEV_ICONS[arg]();
        default: return [];
    }
}

// root の中の [data-pic] に図を描く
export function renderHelpPictures(root) {
    root.querySelectorAll('[data-pic]').forEach(node => {
        const [kind, arg] = node.dataset.pic.split(':');
        node.replaceChildren(...(SCENES[kind] ? [SCENES[kind]()] : inline(kind, arg)));
    });
}
