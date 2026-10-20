/**
 * 盤面の描画（SVG）
 * 地形・資源の図柄は symbol にまとめ、盤面・手札・ダイアログ・タイトル画面で同じ描き方を使う
 */

import { GEOMETRY, pips, RESOURCES } from './board.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
export const HEX_SIZE = 60; // 六角形の半径（SVG の座標）

export const PLAYER_COLORS = ['#d8433b', '#2f6fd0', '#f4f1e8', '#ef8a17'];
export const TERRAIN_COLORS = {
    wood: '#3f7d3a', brick: '#c0623b', sheep: '#93c35b', wheat: '#e6bf3e', ore: '#8b919b', desert: '#dcc68f'
};

export function svg(tag, attrs = {}, children = []) {
    const node = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs).forEach(([key, value]) => {
        if (value !== null && value !== undefined) node.setAttribute(key, value);
    });
    children.forEach(child => node.append(child));
    return node;
}

// ===== 図柄（symbol） =====

// 地形と資源の図柄（40×40）。ページに一度だけ入れる
const SYMBOLS = {
    wood: `
        <path d="M13 5 L4 22 H9 L3 32 H23 L17 22 H22 Z" fill="#2e6b2c" stroke="#1d4a1c" stroke-width="1.2" stroke-linejoin="round"/>
        <rect x="11.5" y="31" width="3" height="5" fill="#6b4423"/>
        <path d="M28 9 L20 24 H24 L19 33 H37 L32 24 H36 Z" fill="#3c8a37" stroke="#1d4a1c" stroke-width="1.2" stroke-linejoin="round"/>
        <rect x="26.5" y="32" width="3" height="5" fill="#6b4423"/>`,
    brick: `
        <g fill="#b5502f" stroke="#7a2f18" stroke-width="1.2">
            <rect x="3" y="26" width="16" height="8" rx="1"/><rect x="21" y="26" width="16" height="8" rx="1"/>
            <rect x="11" y="17" width="16" height="8" rx="1"/><rect x="2" y="17" width="8" height="8" rx="1"/><rect x="28" y="17" width="10" height="8" rx="1"/>
            <rect x="6" y="8" width="16" height="8" rx="1"/><rect x="23" y="8" width="11" height="8" rx="1"/>
        </g>`,
    sheep: `
        <g fill="#fbfaf4" stroke="#6f6a5c" stroke-width="1.2">
            <circle cx="15" cy="20" r="7"/><circle cx="23" cy="18" r="7"/><circle cx="27" cy="25" r="6"/><circle cx="17" cy="27" r="6"/><circle cx="11" cy="25" r="5"/>
        </g>
        <ellipse cx="7" cy="19" rx="4.5" ry="3.6" fill="#3b3a36"/>
        <g stroke="#3b3a36" stroke-width="2.4" stroke-linecap="round"><path d="M14 32v4M24 31v4"/></g>`,
    wheat: `
        <g stroke="#9a7417" stroke-width="1.6" stroke-linecap="round" fill="none"><path d="M20 37V8M13 37L17 14M27 37L23 14"/></g>
        <g fill="#f0c53b" stroke="#9a7417" stroke-width="1">
            <ellipse cx="20" cy="9" rx="2.6" ry="4.2"/><ellipse cx="16.5" cy="15" rx="2.6" ry="4" transform="rotate(-30 16.5 15)"/><ellipse cx="23.5" cy="15" rx="2.6" ry="4" transform="rotate(30 23.5 15)"/>
            <ellipse cx="16.5" cy="22" rx="2.6" ry="4" transform="rotate(-30 16.5 22)"/><ellipse cx="23.5" cy="22" rx="2.6" ry="4" transform="rotate(30 23.5 22)"/>
            <ellipse cx="12" cy="17" rx="2.2" ry="3.6" transform="rotate(-20 12 17)"/><ellipse cx="28" cy="17" rx="2.2" ry="3.6" transform="rotate(20 28 17)"/>
        </g>`,
    ore: `
        <path d="M3 35 L15 12 L21 20 L27 9 L38 35 Z" fill="#6d737c" stroke="#3e4248" stroke-width="1.3" stroke-linejoin="round"/>
        <path d="M27 9 L31 18 L27 16 L24 21 L21 20 Z" fill="#e9edf2"/>
        <path d="M15 12 L18 18 L15 17 L12 20 Z" fill="#e9edf2"/>
        <path d="M10 35 L16 26 L22 35 Z" fill="#555b63"/>`,
    desert: `
        <path d="M20 36V12a3 3 0 0 1 6 0v24Z" fill="#5f9a4a" stroke="#3c6b2e" stroke-width="1.2"/>
        <path d="M20 24h-4a3 3 0 0 1-3-3v-5a2 2 0 0 1 4 0v4h3M26 21h4v-6a2 2 0 0 1 4 0v7a3 3 0 0 1-3 3h-5" fill="#5f9a4a" stroke="#3c6b2e" stroke-width="1.2"/>
        <path d="M4 37 Q 20 31 36 37 Z" fill="#c9ad6a"/>`
};

export function injectSymbols() {
    if (document.getElementById('katan-symbols')) return;
    const defs = Object.entries(SYMBOLS).map(([key, body]) => `<symbol id="sym-${key}" viewBox="0 0 40 40">${body}</symbol>`).join('');
    const holder = document.createElement('div');
    holder.innerHTML = `<svg id="katan-symbols" width="0" height="0" style="position:absolute" aria-hidden="true"><defs>${defs}</defs></svg>`;
    document.body.prepend(holder.firstChild);
}

// 資源の図柄の小さな SVG（手札やボタンで使う）
export function resourceIcon(resource, className = 'res-icon') {
    return svg('svg', { class: className, viewBox: '0 0 40 40', 'aria-hidden': 'true' }, [svg('use', { href: `#sym-${resource}` })]);
}

// ===== 盤面 =====

const hexPoints = (cx, cy, size) => Array.from({ length: 6 }, (_, i) => {
    const angle = Math.PI / 180 * (60 * i - 90);
    return `${(cx + size * Math.cos(angle)).toFixed(1)},${(cy + size * Math.sin(angle)).toFixed(1)}`;
}).join(' ');

const at = ({ x, y }) => ({ x: x * HEX_SIZE, y: y * HEX_SIZE });

export const BOARD_VIEWBOX = '-312 -282 624 564';

// 盤面を描く
// state: { board, robber, buildings, roads }
// options: { spots: { vertices, edges, hexes }, onVertex, onEdge, onHex, recent: { vertex, edge } }
export function renderBoard(root, state, options = {}) {
    root.setAttribute('viewBox', BOARD_VIEWBOX);
    root.replaceChildren();

    // 海
    root.append(svg('polygon', { class: 'sea', points: hexPoints(0, 0, HEX_SIZE * 5.05).split(' ').map(p => {
        // 平らな辺が上になるよう30度回す
        const [x, y] = p.split(',').map(Number);
        const angle = Math.PI / 6;
        return `${(x * Math.cos(angle) - y * Math.sin(angle)).toFixed(1)},${(x * Math.sin(angle) + y * Math.cos(angle)).toFixed(1)}`;
    }).join(' ') }));

    // 港（タイルより先に描き、桟橋がタイルの下に隠れるようにする）
    state.board.harbors.forEach(harbor => root.append(renderHarbor(harbor)));

    // タイル
    GEOMETRY.hexes.forEach(hex => {
        const { terrain, number } = state.board.hexes[hex.id];
        const { x, y } = at(hex);
        const group = svg('g', { class: `hex terrain-${terrain}` });
        group.append(svg('polygon', { class: 'hex-tile', points: hexPoints(x, y, HEX_SIZE - 1.5), fill: TERRAIN_COLORS[terrain] }));
        group.append(svg('use', { href: `#sym-${terrain}`, x: x - 17, y: y - 47, width: 34, height: 34 }));
        if (number) group.append(numberToken(x, y + 8, number));
        root.append(group);
    });

    // 盗賊
    const robberHex = at(GEOMETRY.hexes[state.robber]);
    root.append(robberPiece(robberHex.x, robberHex.y - 28));

    // 道
    state.roads.forEach((owner, edgeId) => {
        if (owner === null) return;
        root.append(roadPiece(edgeId, owner, options.recent?.edge === edgeId));
    });

    // 建物
    state.buildings.forEach((building, vertexId) => {
        if (!building) return;
        root.append(buildingPiece(vertexId, building, options.recent?.vertex === vertexId));
    });

    // 候補（タップで選ぶ）
    const spots = options.spots ?? {};
    (spots.hexes ?? []).forEach(hexId => {
        const { x, y } = at(GEOMETRY.hexes[hexId]);
        const target = svg('polygon', { class: 'spot spot-hex', points: hexPoints(x, y, HEX_SIZE - 5), 'data-hex': hexId });
        target.addEventListener('click', () => options.onHex?.(hexId));
        root.append(target);
    });
    (spots.edges ?? []).forEach(edgeId => {
        const edge = GEOMETRY.edges[edgeId];
        const a = at(GEOMETRY.vertices[edge.a]);
        const b = at(GEOMETRY.vertices[edge.b]);
        const group = svg('g', { class: 'spot spot-edge', 'data-edge': edgeId });
        group.append(svg('line', { class: 'spot-line', x1: a.x, y1: a.y, x2: b.x, y2: b.y }));
        group.append(svg('circle', { class: 'spot-mark', cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, r: 8 }));
        group.append(svg('circle', { class: 'spot-hit', cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, r: 19 }));
        group.addEventListener('click', () => options.onEdge?.(edgeId));
        root.append(group);
    });
    (spots.vertices ?? []).forEach(vertexId => {
        const { x, y } = at(GEOMETRY.vertices[vertexId]);
        const group = svg('g', { class: 'spot spot-vertex', 'data-vertex': vertexId });
        group.append(svg('circle', { class: 'spot-mark', cx: x, cy: y, r: 11 }));
        group.append(svg('circle', { class: 'spot-hit', cx: x, cy: y, r: 22 }));
        group.addEventListener('click', () => options.onVertex?.(vertexId));
        root.append(group);
    });
}

function numberToken(x, y, number) {
    const red = number === 6 || number === 8;
    const group = svg('g', { class: `token${red ? ' red' : ''}` });
    group.append(svg('circle', { cx: x, cy: y, r: 19 }));
    const text = svg('text', { x, y: y + 4, 'text-anchor': 'middle' });
    text.textContent = String(number);
    group.append(text);
    const count = pips(number);
    for (let i = 0; i < count; i++) {
        group.append(svg('circle', { class: 'pip', cx: x + (i - (count - 1) / 2) * 4.6, cy: y + 11, r: 1.7 }));
    }
    return group;
}

function renderHarbor({ edge: edgeId, type }) {
    const edge = GEOMETRY.edges[edgeId];
    const hex = at(GEOMETRY.hexes[edge.hexes[0]]);
    const mid = at(edge);
    const dx = mid.x - hex.x;
    const dy = mid.y - hex.y;
    const length = Math.hypot(dx, dy);
    const px = mid.x + dx / length * HEX_SIZE * 0.62;
    const py = mid.y + dy / length * HEX_SIZE * 0.62;
    const group = svg('g', { class: 'harbor' });
    [edge.a, edge.b].forEach(v => {
        const p = at(GEOMETRY.vertices[v]);
        group.append(svg('line', { class: 'pier', x1: p.x, y1: p.y, x2: px, y2: py }));
    });
    group.append(svg('circle', { class: 'harbor-badge', cx: px, cy: py, r: 17 }));
    if (type === 'any') {
        const text = svg('text', { x: px, y: py + 5, 'text-anchor': 'middle' });
        text.textContent = '3:1';
        group.append(text);
    } else {
        group.append(svg('use', { href: `#sym-${type}`, x: px - 10, y: py - 15, width: 20, height: 20 }));
        const text = svg('text', { class: 'small', x: px, y: py + 13, 'text-anchor': 'middle' });
        text.textContent = '2:1';
        group.append(text);
    }
    return group;
}

function robberPiece(x, y) {
    return svg('g', { class: 'robber', transform: `translate(${x} ${y})` }, [
        svg('ellipse', { cx: 0, cy: 14, rx: 11, ry: 3.5, class: 'robber-shadow' }),
        svg('path', { d: 'M-9 14 C -9 2, -6 -2, -4 -4 A 7 7 0 1 1 4 -4 C 6 -2, 9 2, 9 14 Z' })
    ]);
}

function roadPiece(edgeId, owner, recent) {
    const edge = GEOMETRY.edges[edgeId];
    const a = at(GEOMETRY.vertices[edge.a]);
    const b = at(GEOMETRY.vertices[edge.b]);
    const shrink = 0.16;
    const x1 = a.x + (b.x - a.x) * shrink;
    const y1 = a.y + (b.y - a.y) * shrink;
    const x2 = b.x - (b.x - a.x) * shrink;
    const y2 = b.y - (b.y - a.y) * shrink;
    return svg('g', { class: `road${recent ? ' recent' : ''}`, 'data-edge': edgeId }, [
        svg('line', { class: 'road-outline', x1, y1, x2, y2 }),
        svg('line', { class: 'road-fill', x1, y1, x2, y2, stroke: PLAYER_COLORS[owner] })
    ]);
}

function buildingPiece(vertexId, { owner, type }, recent) {
    const { x, y } = at(GEOMETRY.vertices[vertexId]);
    const d = type === 'city'
        ? 'M-14 10 V-4 L-7 -11 L0 -4 V-2 H14 V10 Z'
        : 'M-9 9 V-2 L0 -11 L9 -2 V9 Z';
    return svg('path', {
        class: `building ${type}${recent ? ' recent' : ''}`, d, transform: `translate(${x} ${y})`,
        fill: PLAYER_COLORS[owner], 'data-vertex': vertexId
    });
}

// 建物と道の小さな見本（プレイヤーの色の確認や、ボタンに使う）
export function pieceIcon(piece, owner, className = 'piece-icon') {
    const root = svg('svg', { class: className, viewBox: '-16 -14 32 28', 'aria-hidden': 'true' });
    if (piece === 'road') {
        root.append(svg('line', { class: 'road-outline', x1: -11, y1: 7, x2: 11, y2: -7 }));
        root.append(svg('line', { class: 'road-fill', x1: -11, y1: 7, x2: 11, y2: -7, stroke: PLAYER_COLORS[owner] }));
    } else {
        root.append(svg('path', {
            class: `building ${piece}`, fill: PLAYER_COLORS[owner],
            d: piece === 'city' ? 'M-14 10 V-4 L-7 -11 L0 -4 V-2 H14 V10 Z' : 'M-9 9 V-2 L0 -11 L9 -2 V9 Z'
        }));
    }
    return root;
}

export { RESOURCES };
