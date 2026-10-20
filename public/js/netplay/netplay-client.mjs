// netplay-kit 1.3.0（1158f9b）からコピーしたファイル。ここでは直さず、netplay-kit で直してから同期する
/**
 * ES モジュールから NetplayClient を使うための入口（中身は netplay-client.js）
 *   import NetplayClient from './netplay/netplay-client.mjs';
 */

import './netplay-client.js';

export const NetplayClient = globalThis.NetplayClient;
export default NetplayClient;
