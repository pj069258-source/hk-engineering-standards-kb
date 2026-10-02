#!/usr/bin/env node
/**
 * 部門網頁／PDF 的 quote 逐字驗證
 * ------------------------------------------------------------------
 * 條例的 quote 已由 verify-quotes.mjs 對官方 RTF 全文驗證（45/45）。
 * 本工具處理其餘引用部門網頁／PDF 的條目：
 *   1. 抓取所有唯一 URL，存入 evidence/web/（HTML 去標籤、PDF 記為二進位）
 *   2. HTML：把 quote 拿去快取文字中逐字比對
 *   3. PDF：嘗試用 zlib 解壓內容流後搜尋（數字可能因字型編碼而搜不到，屬已知限制）
 * 用法: node verify-quotes-web.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const DIR = import.meta.dirname;
const WEBDIR = path.join(DIR, 'evidence', 'web');
fs.mkdirSync(WEBDIR, { recursive: true });

const entries = JSON.parse(fs.readFileSync(path.join(DIR, 'hk-standards.json'), 'utf-8'));
const norm = (s) => String(s).replace(/[\s\u3000\u00a0]+/g, '');

const stripHtml = (h) => h
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d));

// PDF：解壓所有流後串成可搜尋文字（數字可能缺漏，屬已知限制）
function pdfText(buf) {
    const s = buf.toString('latin1');
    let out = '';
    const re = /stream(\r\n|\r|\n)/g;
    let m;
    while ((m = re.exec(s))) {
        const start = m.index + m[0].length;
        const end = s.indexOf('endstream', start);
        if (end < 0) break;
        try { out += zlib.inflateSync(buf.slice(start, end)).toString('latin1'); } catch { /* 非 Flate */ }
        re.lastIndex = end + 9;
    }
    return out;
}

const urls = [...new Set(entries.map((e) => e.url))].filter((u) => u && !/elegislation\.gov\.hk/.test(u));
console.log(`待抓取 URL: ${urls.length} 個`);

const cache = new Map();     // url -> { text, kind }
let i = 0;
for (const u of urls) {
    i++;
    const key = crypto.createHash('sha1').update(u).digest('hex').slice(0, 12);
    try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 25000);
        const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: ctrl.signal, redirect: 'follow' });
        clearTimeout(t);
        const ct = r.headers.get('content-type') || '';
        if (/pdf/i.test(ct) || /\.pdf(\?|$)/i.test(u)) {
            const buf = Buffer.from(await r.arrayBuffer());
            fs.writeFileSync(path.join(WEBDIR, key + '.pdf'), buf);
            cache.set(u, { text: pdfText(buf), kind: 'pdf' });
        } else {
            const html = await r.text();
            const text = stripHtml(html);
            fs.writeFileSync(path.join(WEBDIR, key + '.txt'), text, 'utf-8');
            cache.set(u, { text, kind: 'html' });
        }
        process.stdout.write(`\r  [${i}/${urls.length}] ${r.status} ${cache.get(u).kind}  ${u.slice(0, 60)}          `);
    } catch (e) {
        cache.set(u, { text: '', kind: 'error:' + (e.name === 'AbortError' ? 'timeout' : e.message.slice(0, 20)) });
    }
}
console.log('\n');

const stats = { html: 0, pdf: 0, err: 0, hitHtml: 0, hitPdf: 0, miss: [] };
for (const e of entries) {
    if (!e.quote) continue;
    if (/elegislation\.gov\.hk/.test(e.url || '')) continue;   // 已由條例全文驗證
    const c = cache.get(e.url) || { text: '', kind: 'error:no-url' };
    if (c.kind === 'html') stats.html++;
    else if (c.kind === 'pdf') stats.pdf++;
    else stats.err++;
    const nq = norm(e.quote);
    const ascii = /^[\x20-\x7e]+$/.test(e.quote);
    const found = ascii
        ? c.text.replace(/\s+/g, '').toLowerCase().includes(nq.toLowerCase())
        : norm(c.text).includes(nq);
    if (found) { if (c.kind === 'html') stats.hitHtml++; else if (c.kind === 'pdf') stats.hitPdf++; }
    else stats.miss.push({ id: e.id, kind: c.kind, quote: e.quote });
}

console.log('='.repeat(72));
console.log(`非條例來源的條目: ${stats.html + stats.pdf + stats.err}（HTML ${stats.html} / PDF ${stats.pdf} / 抓取失敗 ${stats.err}）`);
console.log(`✅ 逐字命中: HTML ${stats.hitHtml} / ${stats.html}　PDF ${stats.hitPdf} / ${stats.pdf}`);
console.log(`⚠️ 未命中: ${stats.miss.length}`);
console.log('='.repeat(72));
if (stats.miss.length) {
    console.log('\n未命中明細（PDF 未命中多因字型編碼漏字，屬已知限制；HTML 未命中需人工核對）：');
    for (const m of stats.miss) console.log(`  [${m.id}] ${m.kind}  "${m.quote}"`);
}
