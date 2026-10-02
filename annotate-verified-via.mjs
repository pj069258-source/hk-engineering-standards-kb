#!/usr/bin/env node
/**
 * 一次性標註工具：為以 e-Legislation 為 url 的條目補上 verified_via 欄位
 * ------------------------------------------------------------------
 * 背景：e-Legislation 對普通 HTTP 只回 JS 載入頁。部分研究員改用 headless Chromium
 *      （Playwright）成功讀取條文原文。此欄位記錄「內容是怎麼核實的」，供審計追溯。
 * 用法: node annotate-verified-via.mjs <raw檔名> "<核實方式描述>"
 * 例:   node annotate-verified-via.mjs fire.json "headless Chromium (Playwright) 讀取 e-Legislation 條文原文"
 */

import fs from 'node:fs';
import path from 'node:path';

const [file, via] = process.argv.slice(2);
if (!file || !via) { console.error('用法: node annotate-verified-via.mjs <raw檔名> "<核實方式>"'); process.exit(1); }

const p = path.join(import.meta.dirname, 'raw', file);
const arr = JSON.parse(fs.readFileSync(p, 'utf-8'));
let n = 0;
for (const e of arr) {
    if (/elegislation\.gov\.hk/.test(e.url || '') && !e.verified_via) {
        e.verified_via = via;
        n++;
    }
}
fs.writeFileSync(p, JSON.stringify(arr, null, 2) + '\n', 'utf-8');
console.log(`${file}: 已為 ${n} 條補上 verified_via = "${via}"（共 ${arr.length} 條）`);
