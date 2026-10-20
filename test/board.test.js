import { describe, it, expect } from 'vitest';
import { GEOMETRY, HEX_COUNT, VERTEX_COUNT, EDGE_COUNT, generateBoard, harborAtVertices } from '../public/js/board.js';
import { createRandom } from '../public/js/random.js';

describe('盤面', () => {
    it('タイル19枚・頂点54・辺72で、海沿いの辺は30本', () => {
        expect(HEX_COUNT).toBe(19);
        expect(VERTEX_COUNT).toBe(54);
        expect(EDGE_COUNT).toBe(72);
        expect(GEOMETRY.coast).toHaveLength(30);
        GEOMETRY.vertices.forEach(v => {
            expect(v.neighbors.length).toBeGreaterThanOrEqual(2);
            expect(v.neighbors.length).toBeLessThanOrEqual(3);
        });
    });

    it('地形と数字の数が基本セットどおりで、砂漠には数字がない', () => {
        const board = generateBoard(createRandom(42));
        const count = (terrain) => board.hexes.filter(h => h.terrain === terrain).length;
        expect([count('wood'), count('brick'), count('sheep'), count('wheat'), count('ore'), count('desert')]).toEqual([4, 3, 4, 4, 3, 1]);
        expect(board.hexes.find(h => h.terrain === 'desert').number).toBeNull();
        expect(board.hexes.filter(h => h.number !== null).map(h => h.number).sort((a, b) => a - b))
            .toEqual([2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12]);
    });

    it('6 と 8 は隣り合わない', () => {
        for (let seed = 1; seed <= 100; seed++) {
            const board = generateBoard(createRandom(seed));
            const red = (id) => [6, 8].includes(board.hexes[id].number);
            GEOMETRY.hexes.forEach(hex => {
                if (red(hex.id)) expect(hex.neighbors.some(red)).toBe(false);
            });
        }
    });

    it('港は9つで、隣の港と頂点を共有しない', () => {
        const board = generateBoard(createRandom(7));
        expect(board.harbors).toHaveLength(9);
        expect(board.harbors.filter(h => h.type === 'any')).toHaveLength(4);
        expect(harborAtVertices(board).filter(Boolean)).toHaveLength(18);
    });

    it('同じシードからは同じ盤面になる', () => {
        expect(generateBoard(createRandom(5))).toEqual(generateBoard(createRandom(5)));
    });
});
