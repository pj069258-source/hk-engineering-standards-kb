#!/usr/bin/env node
/**
 * e-Legislation 條例全文下載器（3 步 HTTP 握手，無需瀏覽器）
 * ------------------------------------------------------------------
 * 背景：e-Legislation 對普通 HTTP 請求回傳 JS 載入頁。其 client-check 閘門可用
 *       3 步握手繞過，之後 .rtf / .pdf 全文可直接下載。
 *       流程：GET checkconfig（取 _CSRF_TOKEN 與 cookie）→ POST submitClientConfig.do
 *             → GET /client-check → 下載 capXXX!zh-Hant-HK.rtf
 *
 * 用途：為知識庫建立「證據檔」，讓每條 quote 可逐字回溯到官方原文。
 * 用法: node fetch-eleg-rtf.mjs <章號...>     例如 node fetch-eleg-rtf.mjs cap406 cap406E
 * 輸出: evidence/<cap>.rtf 與 evidence/<cap>.txt
 *
 * ⚠️ 版權：只作個人核實用途，勿再分發全文（見 LEGAL-COMPLIANCE.md）。
 */

import fs from 'node:fs';
import path from 'node:path';

const BASE = 'https://www.elegislation.gov.hk';
const jars = new Map();
const OUTDIR = path.join(import.meta.dirname, 'evidence');
fs.mkdirSync(OUTDIR, { recursive: true });

// 必須帶瀏覽器樣式標頭，否則連線會被 reset
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const H = {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-HK,zh;q=0.9,en;q=0.8',
};

function setCookies(res) {
    const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    for (const c of list) {
        const kv = c.split(';')[0];
        const i = kv.indexOf('=');
        if (i > 0) jars.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim());
    }
}
const cookieHeader = () => [...jars].map(([k, v]) => `${k}=${v}`).join('; ');

// 站點偶發 ECONNRESET，加簡單重試
async function fetchRetry(url, opts = {}, tries = 3) {
    let lastErr;
    for (let i = 0; i < tries; i++) {
        try { return await fetch(url, opts); }
        catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, 800 * (i + 1))); }
    }
    throw lastErr;
}

async function handshake() {
    // 1. 取 token 與 cookie
    const r1 = await fetchRetry(`${BASE}/checkconfig/checkClientConfig.jsp?applicationId=RA001`, { headers: H, redirect: 'follow' });
    setCookies(r1);
    const html = await r1.text();
    const token = (html.match(/name="_CSRF_TOKEN"\s+value="([^"]+)"/) || [])[1];
    if (!token) throw new Error('取不到 _CSRF_TOKEN');

    // 2. 提交 client config（實測此步回 403 亦可，關鍵是後續會設下 clientCheckStatus cookie）
    jars.set('cookieEnabled', 'true');
    const body = new URLSearchParams({
        applicationId: 'RA001', branchCode: '00', jvmVendor: '', jvmVersion: '',
        javascriptEnabled: 'true', cookieEnabled: 'true', appletLoadFailed: '',
        isIpv4Verified: '', isIpv6Verified: '', language: '', country: '', _CSRF_TOKEN: token,
    });
    const r2 = await fetchRetry(`${BASE}/checkconfig/submitClientConfig.do`, {
        method: 'POST',
        headers: {
            ...H,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Cookie': cookieHeader(),
            'Referer': `${BASE}/checkconfig/checkClientConfig.jsp?applicationId=RA001`,
        },
        body: body.toString(), redirect: 'follow',
    });
    setCookies(r2);

    // 3. 確認通過（此步會設下 clientCheckStatus cookie，之後即可下載全文）
    const r3 = await fetchRetry(`${BASE}/client-check`, { headers: { ...H, 'Cookie': cookieHeader() }, redirect: 'follow' });
    setCookies(r3);
    console.error(`[握手] token=${token.slice(0, 6)}… | submit=${r2.status} | client-check=${r3.status} | clientCheckStatus=${jars.get('clientCheckStatus') || '(無)'}`);
}

// RTF 轉純文字（改用共用模組，正確處理 \ucN 備用字元跳過）
import { rtfToText } from './rtf.mjs';

const chapters = process.argv.slice(2);
if (chapters.length === 0) { console.error('用法: node fetch-eleg-rtf.mjs <章號...>  例: cap406 cap406E'); process.exit(1); }

await handshake();
for (const cap of chapters) {
    // 同時取中文與英文版本：知識庫的 quote 有的引中文、有的引英文原文
    for (const [lang, suffix] of [['zh-Hant-HK', ''], ['en', '_en']]) {
        const url = `${BASE}/hk/${cap}!${lang}.rtf`;
        try {
            const r = await fetchRetry(url, { headers: { ...H, 'Cookie': cookieHeader(), 'Referer': `${BASE}/hk/${cap}!${lang}` } });
            const buf = Buffer.from(await r.arrayBuffer());
            const isRtf = buf.slice(0, 5).toString('latin1') === '{\\rtf';
            if (!isRtf) { console.log(`${cap}${suffix}: HTTP ${r.status} | 非 RTF，略過`); continue; }
            fs.writeFileSync(path.join(OUTDIR, `${cap}${suffix}.rtf`), buf);
            const txt = rtfToText(buf.toString('latin1'));
            fs.writeFileSync(path.join(OUTDIR, `${cap}${suffix}.txt`), txt, 'utf-8');
            console.log(`${cap}${suffix}: ${(buf.length / 1024).toFixed(0)}KB → ${txt.length} 字`);
        } catch (e) { console.log(`${cap}${suffix}: ERR ${e.message}`); }
    }
}
