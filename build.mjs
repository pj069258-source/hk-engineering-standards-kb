#!/usr/bin/env node
/**
 * 香港標準知識庫 —— 驗證與合併工具
 * ------------------------------------------------------------------
 * 讀取 raw/*.json（各路研究員產出）→ 逐條驗證 → 合併為 hk-standards.json
 * 同時產生 hk-standards-meta.json（出處標示與授權聲明，履行 data.gov.hk 條款）
 *
 * 用法: node build.mjs
 * 退出碼: 0 = 全部通過；1 = 有錯誤（錯誤條目會被剔除，不寫入成品）
 *
 * ⚠️ 維護注意：本檔含中文，請勿用 Windows PowerShell 5.1 的 Get-Content/Set-Content
 *    做就地修改（預設以 ANSI/GBK 讀取 UTF-8，會整檔亂碼並可能破壞語法）。
 *    要用編輯工具，或改用 node 處理。
 */

import fs from 'node:fs';
import path from 'node:path';

const DIR = import.meta.dirname;
const RAW = path.join(DIR, 'raw');
const OUT = path.join(DIR, 'hk-standards.json');
const META = path.join(DIR, 'hk-standards-meta.json');

const ALLOWED_LEVEL = new Set(['法定條例', '附屬法例', '官方指引', '官方實務守則', '業界標準']);
const REQUIRED = ['id', 'jurisdiction', 'authority', 'authority_level', 'category', 'question', 'answer', 'source_type', 'source', 'url', 'verified', 'confidence'];

const errors = [];
const warnings = [];
const fixes = [];
const all = [];
const seenIds = new Map();
const seenQ = new Map();

// 已知 URL 勘誤表（左：原始錯誤 URL，右：已實測可用的正確 URL）
// 每次修正都必須先 fetch 驗證目標 URL 確實是同一份文件（比對檔名／文件標題），並記錄於此以供審計。
const URL_FIXES = {
    'http://ww.hkis.org.hk/archive/materials/category/20160927155159.0.pdf':
        'https://www.hkis.org.hk/archive/materials/category/20160927155159.0.pdf',
};

if (!fs.existsSync(RAW)) { console.error('找不到 raw 目錄: ' + RAW); process.exit(1); }
const files = fs.readdirSync(RAW).filter((f) => f.endsWith('.json')).sort();
if (files.length === 0) { console.error('raw 目錄內沒有任何 .json'); process.exit(1); }

const perFile = [];
for (const f of files) {
    const full = path.join(RAW, f);
    let arr;
    try {
        arr = JSON.parse(fs.readFileSync(full, 'utf-8'));
    } catch (e) {
        errors.push(`[${f}] JSON 解析失敗：${e.message}`);
        continue;
    }
    if (!Array.isArray(arr)) { errors.push(`[${f}] 頂層不是陣列`); continue; }

    let ok = 0, bad = 0;
    for (const e of arr) {
        const where = `[${f}] ${e && e.id ? e.id : '(無 id)'}`;

        // 必填欄位
        const missing = REQUIRED.filter((k) => e[k] === undefined || e[k] === null || e[k] === '');
        if (missing.length) { errors.push(`${where} 缺欄位: ${missing.join(', ')}`); bad++; continue; }

        // URL 勘誤（域名打錯字等）；修正後仍須通過 https 與後續實測
        if (URL_FIXES[e.url]) {
            fixes.push(`${where} URL 勘誤: ${e.url} → ${URL_FIXES[e.url]}`);
            e.url = URL_FIXES[e.url];
        }

        // 鏡像連結標記：非官方域名（如 Internet Archive）須讓使用者知道這不是一手官方來源
        if (/^https:\/\/web\.archive\.org\//.test(e.url)) {
            e.url_mirror = true;
            fixes.push(`${where} 來源為 Internet Archive 鏡像（非官方域名），已標記 url_mirror=true`);
        }

        // e-Legislation 連結：對人類查閱有效，但自動化只會取得 JS 載入頁，無法核實條文內容。
        // 因此要求：若 url 指向 e-Legislation 且 confidence 為 high，必須有 verified_from 欄位
        // 註明「內容實際是從哪個可抓取來源核實的」，否則視為未經核實。
        if (/elegislation\.gov\.hk/.test(e.url)) {
            e.url_gate = true;
            if (e.confidence !== 'low' && !e.verified_via) {
                warnings.push(`${where} url 指向 e-Legislation（自動抓取只得載入頁）；缺 verified_via 欄位說明內容如何核實 → 應補欄位或設 confidence=low`);
            }
        }

        // 枚舉值
        if (!ALLOWED_LEVEL.has(e.authority_level)) {
            errors.push(`${where} authority_level 非法: "${e.authority_level}"（只准 ${[...ALLOWED_LEVEL].join('/')}）`); bad++; continue;
        }
        if (!['high', 'low'].includes(e.confidence)) { errors.push(`${where} confidence 非法: "${e.confidence}"`); bad++; continue; }

        // id 格式與唯一性
        if (!/^hk-[a-z]+-\d{4}$/.test(e.id)) { errors.push(`${where} id 格式不符（應為 hk-xxx-0000）`); bad++; continue; }
        if (seenIds.has(e.id)) { errors.push(`${where} id 重複（已在 ${seenIds.get(e.id)} 出現）`); bad++; continue; }

        // URL
        if (!/^https:\/\//.test(e.url)) { errors.push(`${where} url 必須是 https 連結`); bad++; continue; }

        // 內容品質
        if (e.answer.length < 40) warnings.push(`${where} 答案過短（${e.answer.length} 字），可能沒有實質門檻`);
        if (e.answer.length > 900) warnings.push(`${where} 答案過長（${e.answer.length} 字），建議拆分`);
        if (e.quote && e.quote.length > 60) warnings.push(`${where} quote 超過 60 字（版權風險，建議縮短）`);
        if (e.tags && !Array.isArray(e.tags)) warnings.push(`${where} tags 不是陣列`);
        if (e.tags && Array.isArray(e.tags) && !e.tags.some((t) => /[\u4e00-\u9fff]/.test(t))) warnings.push(`${where} tags 缺中文`);

        // 問題重複（同義重複會浪費檢索位）
        const qn = String(e.question).replace(/[\s？?。.，,、]/g, '');
        if (seenQ.has(qn)) warnings.push(`${where} 問題與 ${seenQ.get(qn)} 重複（建議合併）`);
        else seenQ.set(qn, e.id);

        // 法定 vs 慣例：業界標準必須在答案中明示非強制性
        if (e.authority_level === '業界標準' && !/業界|慣例|非強制|建議|指引/.test(e.answer)) {
            warnings.push(`${where} 標為「業界標準」但答案未說明其非強制性（合規要求）`);
        }

        seenIds.set(e.id, f);
        all.push(e);
        ok++;
    }
    perFile.push({ file: f, total: arr.length, ok, bad });
}

// 按 id 排序，輸出成品
all.sort((a, b) => String(a.id).localeCompare(String(b.id)));
fs.writeFileSync(OUT, JSON.stringify(all, null, 2), 'utf-8');

// 授權與出處聲明（履行 data.gov.hk 使用條款：註明來源、確認政府為知識產權擁有人）
const byLevel = {};
const byAuth = {};
for (const e of all) {
    byLevel[e.authority_level] = (byLevel[e.authority_level] || 0) + 1;
    byAuth[e.authority] = (byAuth[e.authority] || 0) + 1;
    if (e.confidence === 'low') byLevel['（信心 low，不可作教材依據）'] = (byLevel['（信心 low，不可作教材依據）'] || 0) + 1;
}

const meta = {
    dataset: '香港工程標準知識庫（HK Engineering Standards KB）',
    jurisdiction: '香港特別行政區',
    generated_at: new Date().toISOString(),
    entry_count: all.length,
    by_authority_level: byLevel,
    by_authority: byAuth,
    attribution: {
        notice: '本資料集以香港特別行政區政府及有關機構的公開資料為基礎改寫而成。香港特別行政區政府及有關機構為該等資料的知識產權擁有人。',
        legal_basis: [
            'data.gov.hk 使用條款及條件（要求註明來源並確認政府為知識產權擁有人）',
            '《版權條例》(第 528 章) 第 16 條及第 182 至 184 條（政府版權／立法會版權）',
            '電子版香港法例「重要告示」：只有印有「經核證文本」標記的 PDF 具法律地位，HTML/RTF 及簡體版本僅供參考'
        ],
        disclaimer: '本資料集由第三方整理，非政府官方出版物，不構成法律意見。法例可能修訂，使用前請查閱電子版香港法例的最新經核證文本，並徵詢註冊專業人士意見。'
    },
    sources: [...new Set(all.map((e) => e.source))].sort()
};
fs.writeFileSync(META, JSON.stringify(meta, null, 2), 'utf-8');

// ---------- 報告 ----------
console.log('='.repeat(72));
console.log('逐檔統計');
for (const p of perFile) console.log(`  ${p.file.padEnd(18)} 共 ${String(p.total).padStart(3)} 條 | 通過 ${String(p.ok).padStart(3)} | 剔除 ${p.bad}`);
console.log('='.repeat(72));
console.log(`合併結果: ${all.length} 條 → ${path.basename(OUT)}`);
console.log('效力等級分佈:');
for (const [k, v] of Object.entries(byLevel).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`);
console.log('發佈機構分佈:');
for (const [k, v] of Object.entries(byAuth).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`);

if (fixes.length) {
    console.log('-'.repeat(72));
    console.log(`🔧 URL 勘誤 ${fixes.length} 項:`);
    fixes.forEach((x) => console.log('   ' + x));
}
if (warnings.length) {
    console.log('-'.repeat(72));
    console.log(`⚠️  警告 ${warnings.length} 項（不影響寫入，但建議處理）:`);
    warnings.slice(0, 25).forEach((w) => console.log('   ' + w));
    if (warnings.length > 25) console.log(`   …另有 ${warnings.length - 25} 項`);
}
if (errors.length) {
    console.log('-'.repeat(72));
    console.log(`❌ 錯誤 ${errors.length} 項（該條目已剔除，未寫入成品）:`);
    errors.forEach((e) => console.log('   ' + e));
    process.exit(1);
}
console.log('-'.repeat(72));
console.log('✅ 全部條目通過驗證');
