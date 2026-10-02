#!/usr/bin/env node
/**
 * 極簡 PDF 文字抽取（零依賴，只用 node:zlib）
 * ------------------------------------------------------------------
 * 用途：香港政府部門的技術要求 PDF 無法用 web_fetch 讀取（不支援 application/pdf），
 *       而這些 PDF 內含關鍵數字門檻（水壓、管徑等）。本工具示範用 zlib 解壓 + CMap 對照抽字。
 *
 * 方法（承認是啟發式，非完整 PDF 解析器）：
 *   1. 解壓所有 FlateDecode 流（含物件流）
 *   2. 從中找出所有 ToUnicode CMap 的 beginbfchar / beginbfrange，合併成一張 CID→Unicode 表
 *   3. 掃描內容流中的 <hex> Tj / [<hex> ...] TJ，逐個 CID 查表還原文字
 * 限制：多字型 CID 撞號時可能對錯字；僅供「找出數字與關鍵詞」，不可當作原文引用。
 *
 * ⚠️ 實測警告（2026-10-03，水務署《樓宇水管工程技術要求》2026-04 中文版）：
 *   本工具可抽出約 33,000 字可讀中文，**但會系統性漏掉阿拉伯數字**——
 *   例如原文「公稱直徑可以是 15 毫米或以上」被抽成「公稱直徑可以是毫米或以上」；
 *   33,000 字中僅 95 個數字。因此 **嚴禁用本工具抽取數值門檻（水壓、管徑、時限等）**。
 *   正確用法：用本工具**定位**某要求在哪一節，再由人手開啟 PDF 核對數字。
 *   要自動取得數字，需改用完整 PDF 解析庫（如 pdf.js、pdfium），本專案刻意不引入第三方依賴。
 *
 * 用法: node pdf-text.mjs <PDF_URL或本機路徑> [關鍵詞]
 */

import fs from 'node:fs';
import zlib from 'node:zlib';

const arg = process.argv[2];
const keyword = process.argv[3] || null;
if (!arg) { console.error('用法: node pdf-text.mjs <PDF_URL或路徑> [關鍵詞]'); process.exit(1); }

let buf;
if (/^https?:\/\//.test(arg)) {
    const r = await fetch(arg, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) { console.error('下載失敗 HTTP ' + r.status); process.exit(1); }
    buf = Buffer.from(await r.arrayBuffer());
    console.error(`[下載] ${(buf.length / 1024 / 1024).toFixed(2)} MB, ${r.headers.get('content-type')}`);
} else {
    buf = fs.readFileSync(arg);
}

// ---------- 1. 解壓所有流 ----------
const streams = [];
{
    const s = buf.toString('latin1');
    // 注意：必須用 /stream(\r\n|\r|\n)/ 且把遊標推過 "endstream"（9 字元），
    // 否則會匹配到 "endstream" 內含的 "stream" 子字串，導致後續全部切片錯誤。
    const re = /stream(\r\n|\r|\n)/g;
    let m;
    while ((m = re.exec(s))) {
        const start = m.index + m[0].length;
        const end = s.indexOf('endstream', start);
        if (end < 0) break;
        const raw = buf.slice(start, end);
        let txt = null;
        for (const fn of [zlib.inflateSync, zlib.inflateRawSync]) {
            try { txt = fn(raw).toString('latin1'); break; } catch { /* 換下一種 */ }
        }
        if (txt) streams.push(txt);
        re.lastIndex = end + 9;   // 推過 "endstream"
    }
}
console.error(`[解壓] ${streams.length} 個流`);

// ---------- 2. 收集 CMap ----------
const cmap = new Map();
let cmapCount = 0;
const hex2 = (h) => parseInt(h, 16);

for (const st of streams) {
    // bfchar: <src> <dst>
    for (const blk of st.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
        for (const pair of blk[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
            cmap.set(hex2(pair[1]), String.fromCharCode(...pair[2].match(/.{1,4}/g).map((x) => hex2(x))));
            cmapCount++;
        }
    }
    // bfrange: <lo> <hi> <dstStart>  或  <lo> <hi> [<d1> <d2> ...]
    for (const blk of st.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
        for (const line of blk[1].split(/[\r\n]+/)) {
            const m1 = line.match(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/);
            if (m1) {
                const lo = hex2(m1[1]), hi = hex2(m1[2]), dst = hex2(m1[3]);
                for (let c = lo; c <= hi && c - lo < 65536; c++) {
                    cmap.set(c, String.fromCharCode(dst + (c - lo)));
                    cmapCount++;
                }
            }
        }
    }
}
console.error(`[CMap] ${cmap.size} 個 CID→Unicode 對應（原始 ${cmapCount}）`);

// ---------- 3. 解內容流 ----------
function decodeHex(h) {
    let out = '';
    // 每 4 個 hex = 1 個 CID（2 bytes）
    for (let i = 0; i + 4 <= h.length; i += 4) {
        const cid = hex2(h.substr(i, 4));
        out += cmap.has(cid) ? cmap.get(cid) : '';
    }
    return out;
}

const pages = [];
for (const st of streams) {
    if (!/(Tj|TJ)/.test(st)) continue;
    let text = '';
    // 取 <hex> 字串（Tj 與 TJ 都用）
    for (const m of st.matchAll(/<([0-9A-Fa-f]{4,})>\s*(?:Tj|\]|>|\d)/g)) {
        text += decodeHex(m[1]);
    }
    // 換行標記
    text = text.replace(/\s{3,}/g, ' ');
    if (text.trim().length > 20) pages.push(text);
}
console.error(`[內容] ${pages.length} 段可讀文字`);

const full = pages.join('\n');

// --out <檔案>：把全文寫入檔案（便於後續全文檢索）；否則只印前 2000 字
const outIdx = process.argv.indexOf('--out');
if (outIdx > 0 && process.argv[outIdx + 1]) {
    fs.writeFileSync(process.argv[outIdx + 1], full, 'utf-8');
    console.error(`[輸出] 全文 ${full.length} 字 → ${process.argv[outIdx + 1]}`);
}

console.log(`=== 抽取結果：共 ${full.length} 字 ===`);
if (keyword) {
    console.log(`\n=== 關鍵詞「${keyword}」前後文 ===`);
    let idx = -1, hits = 0;
    while ((idx = full.indexOf(keyword, idx + 1)) >= 0 && hits < 12) {
        console.log('…' + full.slice(Math.max(0, idx - 120), idx + 200).replace(/\n/g, ' ') + '…\n');
        hits++;
    }
    if (hits === 0) console.log('（未找到）');
} else {
    console.log(full.slice(0, 2000));
}
