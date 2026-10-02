#!/usr/bin/env node
/**
 * Quote 逐字回溯驗證
 * ------------------------------------------------------------------
 * 對每一條知識庫條目，把它的 quote（≤30 字原文片段）拿去官方條例全文中逐字比對，
 * 確認「引號裡的字真的出現在官方文本裡」。這是本知識庫最硬的一層證據。
 *
 * 證據來源：evidence/capXXX.txt（由 fetch-eleg-rtf.mjs 以 3 步握手從 e-Legislation 下載的 RTF 轉出）
 * 用法: node verify-quotes.mjs [--json]
 * 退出碼: 0 = 全部命中；1 = 有未命中（需人工處理）
 */

import fs from 'node:fs';
import path from 'node:path';

const DIR = import.meta.dirname;
const EV = path.join(DIR, 'evidence');
const KB = path.join(DIR, 'hk-standards.json');

const entries = JSON.parse(fs.readFileSync(KB, 'utf-8'));
const evFiles = fs.existsSync(EV) ? fs.readdirSync(EV).filter((f) => f.endsWith('.txt')) : [];

if (evFiles.length === 0) {
    console.error('⚠️  找不到 evidence/ 目錄（法例全文因版權原因未隨庫發佈）。');
    console.error('    本工具需要條例官方全文作逐字比對。請先建立證據檔，例如：');
    console.error('      node fetch-eleg-rtf.mjs cap406 cap406E cap509 cap59i');
    console.error('    再重新執行本驗證。');
    process.exit(0);
}

// 預載並正規化（移除所有空白，避免 RTF 換行造成誤判）
const norm = (s) => String(s).replace(/[\s\u3000]+/g, '');
const evText = new Map();
for (const f of evFiles) evText.set(f.replace('.txt', ''), norm(fs.readFileSync(path.join(EV, f), 'utf-8')));

// 從條目推斷它引用哪一部條例
function candidateCaps(e) {
    const hay = `${e.url || ''} ${e.source_chapter || ''} ${e.source || ''}`;
    const caps = new Set();
    for (const m of hay.matchAll(/\b(cap\s?\d+[A-Za-z]*)/gi)) caps.add(m[1].replace(/\s/g, '').toLowerCase());
    return [...caps].filter((c) => evText.has(c));
}

const results = { total: entries.length, withQuote: 0, legalCited: 0, hit: 0, miss: [], noEvidence: [], deptOnly: 0 };

for (const e of entries) {
    if (!e.quote) continue;
    results.withQuote++;
    const caps = candidateCaps(e);
    if (caps.length === 0) { results.deptOnly++; continue; }   // 引用部門網頁／PDF，非條例，另論
    results.legalCited++;
    const q = norm(e.quote);
    // 同時比對該條例的中文與英文版本（quote 有的引中文原文、有的引英文原文）
    const found = caps.find((c) => (evText.get(c) || '').includes(q) || (evText.get(c + '_en') || '').includes(q));
    if (found) results.hit++;
    else results.miss.push({ id: e.id, caps: caps.join('/'), quote: e.quote });
}

console.log('='.repeat(72));
console.log(`知識庫條目: ${results.total}`);
console.log(`有 quote 的條目: ${results.withQuote}`);
console.log(`  其中引用條例（有本地證據檔）: ${results.legalCited}`);
console.log(`  ✅ 逐字命中官方原文: ${results.hit} / ${results.legalCited}`);
console.log(`  ⚠️ 未命中: ${results.miss.length}`);
console.log(`  引用部門網頁/PDF（非條例，需另以網頁快取驗證）: ${results.deptOnly}`);
console.log('='.repeat(72));
if (results.miss.length) {
    console.log('\n未命中明細（可能是 RTF 轉換差異、引文跨版本，或非逐字引用）：');
    for (const m of results.miss) console.log(`  [${m.id}] cap=${m.caps}\n      "${m.quote}"`);
}
if (process.argv.includes('--json')) console.log('\n' + JSON.stringify(results, null, 2));
process.exit(results.miss.length ? 1 : 0);
