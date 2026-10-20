/**
 * オンライン対戦のサーバーの URL
 * AWS にデプロイしたら、出力された WebSocketUrl を DEPLOYED_SERVER_URL に書く
 */

import NetplayClient from './netplay/netplay-client.mjs';

const DEPLOYED_SERVER_URL = 'wss://4bq36mhf28.execute-api.ap-northeast-1.amazonaws.com/prod';

// ?server=wss://... で接続先を変えられる。手元（localhost）で開いたときはテスト用サーバー（ws://localhost:8787）につなぐ
export function getServerUrl() {
    return NetplayClient.resolveServerUrl({ deployed: DEPLOYED_SERVER_URL });
}

// 接続先があるか（デプロイ前に GitHub Pages で開いたときは、オンライン対戦のボタンを出さない）
export const hasServer = () => Boolean(getServerUrl());
