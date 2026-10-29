/**
 * 遊び方の図：盤面と同じ部品（タイル・数字の札・建物・道・盗賊）で、小さな場面を描く
 * index.html の [data-pic] の中に描く
 *   場面：resources / production / odds / setup / trade / longest / robber
 *   文中の図柄：piece:道や建物 / res:資源 / cost:建物（材料の図柄） / dev:発展カード
 */

import {
    svg, hexPoints, numberToken, robberPiece, resourceIcon, pieceIcon,
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

// タイル（数字があれば、盤面と同じく図柄を上に寄せて札を置く）
function tile(x, y, terrain, number = null) {
    const group = svg('g');
    group.append(svg('polygon', { class: 'hex-tile', points: hexPoints(x, y, HEX_SIZE - 1.5), fill: TERRAIN_COLORS[terrain] }));
    if (number) {
        group.append(svg('use', { href: `#sym-${terrain}`, x: x - 17, y: y - 47, width: 34, height: 34 }));
        group.append(numberToken(x, y + 8, number));
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
    // 資源の出るタイル
    resources: () => el('div', 'pic-tiles', [...RESOURCES, 'desert'].map(terrain => el('figure', '', [
        scene('-54 -62 108 124', [tile(0, 0, terrain)]),
        el('figcaption', '', [terrain === 'desert' ? 'なし' : RESOURCE_NAMES[terrain]])
    ]))),

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
    setup: () => {
        const turn = (owner) => el('span', 'pic-pair', [pieceIcon('settlement', owner), pieceIcon('road', owner)]);
        return caption([
            ['1つ目', arrow(), turn(0), turn(1), turn(2)],
            ['2つ目', arrow(), turn(2), turn(1), turn(0), '（逆の順）']
        ]);
    },

    // 銀行・港との交換
    trade: () => caption([
        [el('span', 'pic-tag', ['銀行']), ...resources('sheep', 4), arrow(), res('ore')],
        [harborBadge('any'), ...resources('sheep', 3), arrow(), res('ore')],
        [harborBadge('sheep'), ...resources('sheep', 2), arrow(), res('ore')]
    ]),

    // 5本つながった道
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
        return scene('-122 -86 258 156', [tile(left.x, 0, 'wood'), tile(right.x, 0, 'wheat'), ...roads, building(path[0], 'settlement', ME), ...numbers], 'pic-scene pic-mid');
    },

    // 盗賊のいるタイル：資源が出ず、そこに建物を持つ人から1枚奪う
    robber: () => el('div', 'pic-row', [
        scene('-72 -72 144 144', [
            tile(0, 0, 'wheat', 6),
            svg('line', { class: 'pic-block', x1: -14, y1: 22, x2: 14, y2: -6 }),
            robberPiece(0, -28),
            building(corner(0, 0, 1), 'settlement', OTHER),
            building(corner(0, 0, 4), 'settlement', OTHER)
        ]),
        caption([
            [robberIcon(), 'のタイルは、6 が出ても資源が出ない'],
            [pieceIcon('settlement', OTHER), 'の人から、1枚奪う']
        ])
    ])
};

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
