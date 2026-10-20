/**
 * シード付きの乱数
 * 同じシードからは同じ順で同じ値が出るので、操作の記録からゲームを再現できる
 */

// 0以上2^32未満のランダムなシード
export const createSeed = () => Math.floor(Math.random() * 2 ** 32);

// [0, 1) の乱数を返す関数を作る（mulberry32）
export function createRandom(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6D2B79F5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// 配列をその場でシャッフルする（Fisher-Yates）
export function shuffle(array, random) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}
