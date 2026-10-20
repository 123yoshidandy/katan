/**
 * API Gateway（WebSocket）から呼ばれる Lambda の入口（部屋の処理は共通部品、ゲームの中身は game-definition.js）
 */

import { createHandler } from '../netplay/handler.js';
import game from './game-definition.js';

export const handler = createHandler(game);
