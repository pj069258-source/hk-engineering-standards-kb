#!/usr/bin/env node
/**
 * 連結實測工具 —— 確認每條知識庫的 url 真的可以開啟
 * 用法: node check-urls.mjs [raw/building.json ...]   不帶參數則檢查 hk-standards.json
 * 輸出: 每條 URL 的 HTTP 狀態；非 2xx 會被標記
 */

import fs from 'node:fs';
import path from 'node:path';

const DIR = import.meta.dirname;
const args = process.argv.slice(2);
const targets = args.length ? args.map((a) => path.resolve(a)) : [path.join(DIR, 'hk-standards.json')];

const urls = new Map();  // url -> [ids]
for (const t of targets) {
    if (!fs.existsSync(t)) { console.error('找不到檔案: ' + t); continue; }
    const arr = JSON.parse(fs.readFileSync(t, 'utf-8'));
    for (const e of arr) {
        if (!e.url) continue;
        if (!urls.has(e.url)) urls.set(e.url, []);
        urls.get(e.url).push(e.id);
    }
}

console.log(`待檢查 URL：${urls.size} 個（來自 ${targets.length} 個檔案）\n`);

const results = [];
let i = 0;
for (const [url, ids] of urls) {
    i++;
    let status = 'FETCH_ERROR', note = '';
    try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 20000);
        const r = await fetch(url, {
            redirect: 'follow',
            signal: ctrl.signal,
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DSH-KB-validator/1.0)' },
        });
        clearTimeout(timer);
        status = r.status;
        const ct = r.headers.get('content-type') || '';
        const body = await r.text();
        // 偵測「JS 檢查頁」型反爬（例如 e-Legislation 會回 200 但內容是載入中）
        if (/Loading required resource|checkClientConfig/i.test(body)) {
            note = /elegislation\.gov\.hk/.test(url)
                ? 'e-Legislation JS 閘門（已知且預期：人類瀏覽器可正常開啟，自動抓取只能取得載入頁）'
                : '反爬跳轉頁（內容需瀏覽器）';
        } else if (body.length < 500) note = '內容極短，需人工確認';
        else if (/text\/html/.test(ct) && /找不到|not found|404/i.test(body.slice(0, 4000))) note = '頁面含「找不到」字樣';
    } catch (e) {
        note = e.name === 'AbortError' ? '逾時 20s' : e.message.slice(0, 60);
    }
    // e-Legislation 的閘門屬已知限制，不算失敗（其原文已另以 headless Chromium 複核，見 VERIFICATION-LOG.md）
    const expected = /elegislation\.gov\.hk/.test(url) && /JS 閘門/.test(note);
    const ok = status === 200 && (!note || expected);
    results.push({ url, ids, status, note, ok, expected });
    console.log(`${ok ? '✅' : '⚠️ '} ${String(status).padEnd(6)} ${url}${note ? '   ← ' + note : ''}`);
}

const good = results.filter((r) => r.ok).length;
const exp  = results.filter((r) => r.expected).length;
console.log(`\n總結：可正常開啟 ${good} / ${results.length}（其中 ${exp} 個為 e-Legislation 已知閘門，連結對人類有效）`);
const problems = results.filter((r) => !r.ok);
if (problems.length) {
    console.log('\n需人工處理的連結：');
    for (const p of problems) console.log(`  [${p.status}] ${p.note}  影響條目: ${p.ids.join(', ')}\n      ${p.url}`);
}

// 退出碼供 CI 判斷：有問題回 1，全部正常回 0
process.exit(problems.length ? 1 : 0);
