#!/usr/bin/env node
/**
 * Quote 正規化：讓每個 quote 不是「逐字可核對」就是「明確標記未核對」
 * ------------------------------------------------------------------
 * 背景：部分 quote 是研究員把原文「省略括號內容」後拼成的，並非嚴格逐字；
 *       部分來源頁面是 JS 動態載入，靜態快取無法核對。
 * 處理：
 *   1. 若 quote 不是逐字，但它的前綴（≥10 字）在證據中逐字存在 → 改成「該前綴＋…」
 *   2. 若完全找不到（PDF 字型編碼、JS 載入頁等）→ 加 quote_unverified 欄位並說明原因
 * 用法: node normalize-quotes.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DIR = import.meta.dirname;
const norm = (s) => String(s).replace(/[\s\u3000\u00a0]+/g, '');

// 載入條例證據
const evDir = path.join(DIR, 'evidence');
const evText = new Map();
for (const f of fs.readdirSync(evDir).filter((x) => x.endsWith('.txt'))) {
    evText.set(f.replace('.txt', ''), norm(fs.readFileSync(path.join(evDir, f), 'utf-8')));
}
// 載入網頁快取
const webDir = path.join(evDir, 'web');
const webCache = new Map();
for (const f of fs.readdirSync(webDir).filter((x) => x.endsWith('.txt'))) {
    webCache.set(f.replace('.txt', ''), norm(fs.readFileSync(path.join(webDir, f), 'utf-8')));
}

const longestPrefixIn = (hay, needle, min = 10) => {
    for (let len = needle.length; len >= min; len--) {
        if (hay.includes(needle.slice(0, len))) return len;
    }
    return 0;
};

const fixes = [], marks = [];
const rawDir = path.join(DIR, 'raw');
for (const file of fs.readdirSync(rawDir).filter((f) => f.endsWith('.json'))) {
    const p = path.join(rawDir, file);
    const arr = JSON.parse(fs.readFileSync(p, 'utf-8'));
    let changed = false;

    for (const e of arr) {
        if (!e.quote) continue;
        const isEleg = /elegislation\.gov\.hk/.test(e.url || '');
        let hay = '';
        let kind = '';
        if (isEleg) {
            const caps = [...String(`${e.url} ${e.source_chapter || ''}`).matchAll(/\b(cap\s?\d+[A-Za-z]*)/gi)]
                .map((m) => m[1].replace(/\s/g, '').toLowerCase());
            for (const c of caps) {
                if ((evText.get(c) || '').includes(norm(e.quote))) { hay = evText.get(c); kind = 'ordinance-zh'; break; }
                if ((evText.get(c + '_en') || '').includes(norm(e.quote))) { hay = evText.get(c + '_en'); kind = 'ordinance-en'; break; }
            }
            if (!hay) { for (const c of caps) { if (evText.has(c)) { hay = evText.get(c); kind = 'ordinance-miss'; break; } if (evText.has(c + '_en')) { hay = evText.get(c + '_en'); kind = 'ordinance-miss'; break; } } }
        } else {
            const key = crypto.createHash('sha1').update(e.url || '').digest('hex').slice(0, 12);
            hay = webCache.get(key) || '';
            kind = hay ? 'web' : 'web-miss';
        }
        if (hay.includes(norm(e.quote))) continue;   // 已逐字命中

        // 嘗試用「最長逐字前綴 + …」補救
        const plen = longestPrefixIn(hay, norm(e.quote), 10);
        if (plen >= 10) {
            const newQuote = e.quote.slice(0, plen) + '…';
            fixes.push(`${e.id} quote 改為逐字前綴（原 ${e.quote.length} 字 → ${newQuote.length} 字）`);
            e.quote = newQuote;
            e.quote_note = '已截為原文逐字前綴（原文該處有省略或跨段）';
            changed = true;
        } else {
            const reason = kind.startsWith('ordinance') ? 'PDF/RTF 未涵蓋或版本差異'
                : (/\.pdf/i.test(e.url || '') ? 'PDF 字型編碼，自動逐字核對不可行' : '來源頁面為 JS 動態載入或引文來自頁面其他部分');
            if (!e.quote_unverified) {
                e.quote_unverified = true;
                e.quote_unverified_reason = reason;
                marks.push(`${e.id} 標記 quote 未經自動逐字核對（${reason}）`);
                changed = true;
            }
        }
    }
    if (changed) fs.writeFileSync(p, JSON.stringify(arr, null, 2) + '\n', 'utf-8');
}

console.log('='.repeat(72));
console.log(`🔧 修正（改為逐字前綴）: ${fixes.length}`);
fixes.forEach((f) => console.log('   ' + f));
console.log(`🏷️  標記未核對: ${marks.length}`);
marks.forEach((m) => console.log('   ' + m));
console.log('='.repeat(72));
