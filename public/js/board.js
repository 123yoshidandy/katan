/**
 * 盤面の形（タイル・頂点・辺のつながり）と、地形・数字・港の配置
 * DOMに依存しないので、ブラウザとサーバーの両方で使う
 *
 * - タイルは六角形19枚（中心から半径2）。頂点は尖った方が上（pointy-top）
 * - 形は固定で、地形・数字・港の種類だけをシード付きの乱数で配る
 * - 座標は六角形の半径を1とした値（画面ではこれを拡大して描く）
 */

import { shuffle } from './random.js';

export const RESOURCES = ['wood', 'brick', 'sheep', 'wheat', 'ore'];

export const RESOURCE_NAMES = { wood: '木材', brick: 'レンガ', sheep: '羊毛', wheat: '小麦', ore: '鉄' };
export const TERRAIN_NAMES = { wood: '森', brick: '丘陵', sheep: '牧草地', wheat: '畑', ore: '山地', desert: '砂漠' };

const TERRAINS = [
    ...Array(4).fill('wood'), ...Array(3).fill('brick'), ...Array(4).fill('sheep'),
    ...Array(4).fill('wheat'), ...Array(3).fill('ore'), 'desert'
];
const NUMBERS = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];
// 港の種類（'any' は 3:1、資源名はその資源の 2:1）
const HARBOR_TYPES = ['any', 'any', 'any', 'any', 'wood', 'brick', 'sheep', 'wheat', 'ore'];
// 海沿いの辺30本を一周する順に並べたとき、港を置く辺の間隔（隣の港と頂点を共有しない）
const HARBOR_GAPS = [3, 3, 4, 3, 3, 4, 3, 3, 4];

const SQRT3 = Math.sqrt(3);
const round = (value) => Math.round(value * 1000) / 1000;

// ===== 形（固定） =====

function buildGeometry() {
    const hexes = [];
    for (let r = -2; r <= 2; r++) {
        for (let q = -2; q <= 2; q++) {
            if (Math.abs(q + r) > 2) continue;
            hexes.push({ id: hexes.length, q, r, x: round(SQRT3 * (q + r / 2)), y: round(1.5 * r), vertices: [], edges: [] });
        }
    }

    const vertices = [];
    const vertexByKey = new Map();
    const vertexAt = (x, y) => {
        const key = `${round(x)},${round(y)}`;
        if (!vertexByKey.has(key)) {
            vertexByKey.set(key, vertices.length);
            vertices.push({ id: vertices.length, x: round(x), y: round(y), hexes: [], neighbors: [], edges: [] });
        }
        return vertexByKey.get(key);
    };
    hexes.forEach(hex => {
        for (let i = 0; i < 6; i++) {
            const angle = Math.PI / 180 * (60 * i - 90); // 0 が真上、時計回り
            const id = vertexAt(hex.x + Math.cos(angle), hex.y + Math.sin(angle));
            hex.vertices.push(id);
            vertices[id].hexes.push(hex.id);
        }
    });

    const edges = [];
    const edgeByKey = new Map();
    hexes.forEach(hex => {
        for (let i = 0; i < 6; i++) {
            const a = hex.vertices[i];
            const b = hex.vertices[(i + 1) % 6];
            const key = a < b ? `${a}-${b}` : `${b}-${a}`;
            if (!edgeByKey.has(key)) {
                edgeByKey.set(key, edges.length);
                edges.push({
                    id: edges.length, a: Math.min(a, b), b: Math.max(a, b),
                    x: round((vertices[a].x + vertices[b].x) / 2), y: round((vertices[a].y + vertices[b].y) / 2), hexes: []
                });
            }
            const id = edgeByKey.get(key);
            hex.edges.push(id);
            edges[id].hexes.push(hex.id);
        }
    });
    edges.forEach(edge => {
        vertices[edge.a].edges.push(edge.id);
        vertices[edge.b].edges.push(edge.id);
        vertices[edge.a].neighbors.push(edge.b);
        vertices[edge.b].neighbors.push(edge.a);
    });

    // 海沿いの辺を、盤の中心から見た角度の順（真上から時計回り）に並べる
    const coast = edges
        .filter(edge => edge.hexes.length === 1)
        .sort((e1, e2) => angleOf(e1) - angleOf(e2))
        .map(edge => edge.id);

    // 隣のタイル（数字の6と8を隣に置かないため）
    hexes.forEach(hex => {
        hex.neighbors = hexes
            .filter(other => other !== hex && other.vertices.filter(v => hex.vertices.includes(v)).length === 2)
            .map(other => other.id);
    });

    return { hexes, vertices, edges, coast };
}

const angleOf = ({ x, y }) => (Math.atan2(x, -y) + 2 * Math.PI) % (2 * Math.PI);

export const GEOMETRY = buildGeometry();
export const HEX_COUNT = GEOMETRY.hexes.length;       // 19
export const VERTEX_COUNT = GEOMETRY.vertices.length; // 54
export const EDGE_COUNT = GEOMETRY.edges.length;      // 72

export const otherEnd = (edgeId, vertexId) => {
    const edge = GEOMETRY.edges[edgeId];
    return edge.a === vertexId ? edge.b : edge.a;
};

// サイコロの目が出る確率の目安（点の数）。2・12 は1、6・8 は5
export const pips = (number) => (number ? 6 - Math.abs(7 - number) : 0);

// ===== 配置（ゲームごとに変わる） =====

// 地形・数字・港を配る。返す値は JSON にできる形（ビューにそのまま載せる）
// hexes: [{ terrain, number }]（id 順）/ harbors: [{ edge, type }]
export function generateBoard(random) {
    const terrains = shuffle([...TERRAINS], random);
    let numbers;
    // 6 と 8 が隣り合わない並びになるまで配り直す（たいてい数回で決まる）
    for (let attempt = 0; attempt < 1000; attempt++) {
        numbers = placeNumbers(terrains, shuffle([...NUMBERS], random));
        if (redNumbersApart(numbers)) break;
    }
    const hexes = terrains.map((terrain, id) => ({ terrain, number: numbers[id] }));

    const types = shuffle([...HARBOR_TYPES], random);
    const start = Math.floor(random() * GEOMETRY.coast.length);
    const harbors = [];
    let index = start;
    HARBOR_GAPS.forEach((gap, i) => {
        harbors.push({ edge: GEOMETRY.coast[index % GEOMETRY.coast.length], type: types[i] });
        index += gap;
    });
    return { hexes, harbors };
}

function placeNumbers(terrains, numbers) {
    let next = 0;
    return terrains.map(terrain => (terrain === 'desert' ? null : numbers[next++]));
}

function redNumbersApart(numbers) {
    const red = (n) => n === 6 || n === 8;
    return GEOMETRY.hexes.every(hex => !red(numbers[hex.id]) || hex.neighbors.every(id => !red(numbers[id])));
}

// 頂点ごとの港の種類（港がなければ null）
export function harborAtVertices(board) {
    const result = Array(VERTEX_COUNT).fill(null);
    board.harbors.forEach(({ edge, type }) => {
        const { a, b } = GEOMETRY.edges[edge];
        result[a] = type;
        result[b] = type;
    });
    return result;
}
