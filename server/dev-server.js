/**
 * 手元でオンライン対戦を試すための WebSocket サーバー（AWS と同じ部屋の処理を、保存先をメモリにして動かす）
 * 使い方: npm run dev:server  （画面は別に python3 -m http.server などで public/ を配信する）
 */

import { startDevServer } from './netplay/dev-server.js';
import game from './src/game-definition.js';

startDevServer(game);
