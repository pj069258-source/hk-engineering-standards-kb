#!/usr/bin/env node
/**
 * 工程知識庫本地檢索 —— 零依賴，純 Node 標準庫
 * ------------------------------------------------------------------
 * 資料來源（可合併檢索）:
 *   1. 香港官方標準  ../hk-standards/hk-standards.json（水/電/裝修/防水/消防/職安健，附官方出處）
 *   2. 大陸業界知識庫 knowledge.json（29,788 條第三方資料，無官方出處）
 * 設計目標: 不執行任何第三方插件程式碼，只讀取純 JSON 資料做檢索。
 *
 * 用法:
 *   node search.mjs "防水怎麼做才不漏水"
 *   node search.mjs "小型工程呈交時限" --kb hk          # 只查香港官方標準
 *   node search.mjs "配電箱定期檢查" --official-only     # 只保留官方來源
 *   node search.mjs "半包價格" --cat 預算 --top 5
 *   node search.mjs "瓷磚空鼓" --full                   # 顯示完整答案
 *   node search.mjs --list-cats                        # 列出分類及條數
 *   node search.mjs --id hk-bd-0002                    # 按 id 精確取一條
 *   node search.mjs "水務驗收" --json                   # 機器可讀輸出
 *
 * 算法（可審）:
 *   1. 全欄位掃描（問題/標籤/分類/答案），查詢切 2~4 字滑窗
 *   2. IDF 加權：問題 ×3 / 標籤 ×2 / 分類 ×1.2 / 答案 ×0.6
 *   3. 香港官方標準按效力等級加成：法定條例 ×1.30 > 附屬法例 ×1.25 > 官方指引/守則 ×1.12
 *   4. 區分性詞覆蓋門檻 + 短語加成 + 長度歸一化
 */

import fs from 'node:fs';
import path from 'node:path';

const KB_SOURCES = [
    { id: 'hk', label: '香港官方標準', path: path.join(import.meta.dirname, 'hk-standards.json') },
    // 可選：放入自有的第三方知識庫 knowledge.json（本庫未附，因無 license）
    { id: 'mainland', label: '第三方知識庫（未隨庫發佈）', path: path.join(import.meta.dirname, 'knowledge.json') },
];

// 香港官方標準的效力等級加權（法定 > 附屬法例 > 官方指引/守則 > 業界標準）
const AUTH_BOOST = { '法定條例': 1.30, '附屬法例': 1.25, '官方指引': 1.12, '官方實務守則': 1.12, '業界標準': 1.0 };

// ---------- 参数解析 ----------
const argv = process.argv.slice(2);
const opts = { top: 3, cat: null, tag: null, full: false, json: false, listCats: false, id: null, all: false, explain: false, kb: 'all', officialOnly: false };
const queryParts = [];
for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--top') opts.top = parseInt(argv[++i], 10) || 3;
    else if (a === '--cat') opts.cat = argv[++i];
    else if (a === '--tag') opts.tag = argv[++i];
    else if (a === '--id') opts.id = argv[++i];
    else if (a === '--full') opts.full = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--list-cats') opts.listCats = true;
    else if (a === '--all') opts.all = true;          // 包含非施工类（营销/谈单等）条目
    else if (a === '--kb') opts.kb = argv[++i];        // hk | mainland | all（默认 all）
    else if (a === '--official-only') opts.officialOnly = true;  // 只保留香港官方来源条目
    else if (a === '--explain') opts.explain = true;  // 显示命中的区分性词
    else if (a === '-h' || a === '--help') {
        console.log(fs.readFileSync(new URL(import.meta.url), 'utf-8').split('*/')[0].replace(/^#!.*\n/, ''));
        process.exit(0);
    } else queryParts.push(a);
}
const query = queryParts.join(' ').trim();

// ---------- 加载数据（支持多库合并：香港官方标准 + 大陆第三方库） ----------
const t0 = Date.now();
const docs = [];
const loaded = [];
for (const src of KB_SOURCES) {
    if (opts.kb !== 'all' && opts.kb !== src.id) continue;
    if (!fs.existsSync(src.path)) { loaded.push(`${src.label}: 檔案不存在，略過`); continue; }
    let arr;
    try { arr = JSON.parse(fs.readFileSync(src.path, 'utf-8')); }
    catch (e) { console.error(`知識庫解析失敗 ${src.path}: ${e.message}`); process.exit(2); }
    if (!Array.isArray(arr)) { console.error(`知識庫格式異常（頂層非陣列）: ${src.path}`); process.exit(2); }
    for (const d of arr) { d._kb = src.id; d._kbLabel = src.label; docs.push(d); }
    loaded.push(`${src.label}: ${arr.length} 條`);
}
if (docs.length === 0) { console.error('沒有任何知識庫被載入（可用 --kb hk|mainland 指定）'); process.exit(2); }
const tLoad = Date.now() - t0;
const N = docs.length;

// ---------- 停用词二元组（问句里的高频虚词，避免拉高噪声） ----------
const STOP = new Set([
    '怎么', '么办', '如何', '什么', '哪些', '哪个', '可以', '需要', '应该', '一般', '是否', '不是',
    '这个', '那个', '的话', '进行', '以及', '或者', '但是', '因为', '所以', '如果', '就是', '还是',
    '多少', '为什', '什幺', '怎样', '咋办', '请问', '一下', '有没有', '会不会', '能不能', '要注意',
    '注意', '问题', '情况', '时候', '办法', '方法', '有人', '知道', '告诉', '帮我', '想要',
    // 追加：无主题信息的虚词片段（实测会导致「怎么做才不X」类误命中）
    '么做', '做才', '才不', '不会', '要不', '么样', '这样', '那样', '这家', '那家', '求推荐', '推荐'
]);

// ---------- 工具函数 ----------
function norm(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }

function grams(text) {
    const s = norm(text);
    const out = [];
    for (let i = 0; i < s.length - 1; i++) {
        const g = s.substr(i, 2);
        if (STOP.has(g)) continue;
        if (/^[\s\p{P}]+$/u.test(g)) continue;  // 纯标点/空白跳过
        out.push(g);
        // 同时加入三元组，提高长词精度
        if (i + 3 <= s.length) {
            const g3 = s.substr(i, 3);
            if (!/^[\s\p{P}]+$/u.test(g3)) out.push(g3);
        }
    }
    return out;
}

// ---------- 预处理 ----------
// 不做倒排索引：改为全字段按需扫描。原因（实测教训）：只索引问题/标签/分类时，
// 「只在答案里出现的词」无法成为候选，导致最佳答案被漏掉。29,788 条全扫代价可接受。
const docText = new Array(N);
for (let i = 0; i < N; i++) {
    const d = docs[i] || {};
    const q = norm(d.question);
    const tags = Array.isArray(d.tags) ? d.tags.join(' ') : norm(d.tags);
    const cat = norm(d.category);
    const a = norm(d.answer || d.content);
    docText[i] = { q, tags, cat, a, all: q + ' ' + tags + ' ' + cat + ' ' + a };
}

// ---------- 列出分类 ----------
if (opts.listCats) {
    const cats = new Map();
    for (const d of docs) { const c = norm(d.category) || '(未分类)'; cats.set(c, (cats.get(c) || 0) + 1); }
    const sorted = [...cats.entries()].sort((a, b) => b[1] - a[1]);
    console.log(`知识库共 ${N} 条，${sorted.length} 个分类：`);
    for (const [c, n] of sorted) console.log(String(n).padStart(6) + '  ' + c);
    process.exit(0);
}

// ---------- 按 id 取 ----------
if (opts.id != null) {
    const hit = docs.find((d) => String(d.id) === String(opts.id));
    if (!hit) { console.error('未找到 id=' + opts.id); process.exit(1); }
    console.log(JSON.stringify(hit, null, 2));
    process.exit(0);
}

if (!query) { console.error('请提供查询词，例如: node search.mjs "防水怎么做才不漏水"（--help 看用法）'); process.exit(1); }

// ---------- 检索 ----------
const qGrams = [...new Set(grams(query))];
if (qGrams.length === 0) { console.error('查询词过短或全是停用词'); process.exit(1); }

// 文档频率与 IDF（全字段统计；「装修」占 87.7%、「怎么」16.2% 这类词会被 IDF 自动压成接近 0）
const qDf = new Map();
for (const g of qGrams) {
    let c = 0;
    for (let i = 0; i < N; i++) if (docText[i].all.includes(g)) c++;
    qDf.set(g, c);
}
const idfQ = new Map([...qDf].map(([g, df]) => [g, Math.log(N / (1 + df))]));

// 阶段 1：全字段加权打分（问题 ×3 / 标签 ×2 / 分类 ×1.2 / 答案 ×0.6）
const score1 = new Map();
for (let i = 0; i < N; i++) {
    const t = docText[i];
    let s = 0;
    for (const g of qGrams) {
        const w = idfQ.get(g);
        if (!w || w <= 0) continue;
        if (t.q.includes(g)) s += w * 3;
        else if (t.tags.includes(g)) s += w * 2;
        else if (t.cat.includes(g)) s += w * 1.2;
        else if (t.a.includes(g)) s += w * 0.6;
    }
    if (s > 0) score1.set(i, s);
}

// 分类/标签硬过滤
// 默认排除与施工无关的分类（营销/谈单等），--all 可包含
const OFFTOPIC = new Set(['新媒体运营', 'AI营销', '谈单心理', '谈单话术', '设计师IP运营', '互联网装修运营']);
function passFilter(d) {
    if (!opts.all && d._kb === 'mainland' && OFFTOPIC.has(norm(d.category))) return false;
    if (opts.officialOnly && norm(d.source_type) !== 'HK-OFFICIAL') return false;
    if (opts.cat && !norm(d.category).includes(opts.cat)) return false;
    if (opts.tag) {
        const tg = Array.isArray(d.tags) ? d.tags.join(' ') : norm(d.tags);
        if (!tg.includes(opts.tag)) return false;
    }
    return true;
}

const qNorm = norm(query).replace(/\s+/g, '');

// 区分性词：出现率 < 8% 的 gram 才有主题信息量（实测「装修」占 87.7%、「怎么」占 16.2%，无区分度）
const DF_LIMIT = N * 0.08;
const distinctive = qGrams.filter((g) => (qDf.get(g) || 0) > 0 && (qDf.get(g) || 0) < DF_LIMIT);

const candidates = [...score1.entries()]
    .filter(([i]) => passFilter(docs[i]))
    // 覆盖度门槛：查询含 >=2 个区分性词时，候选必须命中其中 >=2 个，否则判为噪声匹配
    .filter(([i]) => {
        if (distinctive.length < 2) return true;
        const t = docText[i];
        let hit = 0;
        for (const g of distinctive) {
            if (t.q.includes(g) || t.tags.includes(g) || t.cat.includes(g) || t.a.includes(g)) hit++;
        }
        return hit >= 2;
    })
    .sort((a, b) => b[1] - a[1])
    .slice(0, 300);

// 阶段 2：候选集二次打分（答案正文 + 短语加成 + 长度归一化）
const scored = candidates.map(([i, s1]) => {
    const t = docText[i];
    let s = s1;
    for (const g of qGrams) {
        const w = idfQ.get(g);
        if (!w || w <= 0) continue;
        const c = t.a.split(g).length - 1;
        if (c > 0) s += w * 0.4 * Math.min(c, 3);
    }
    if (t.q.replace(/\s+/g, '').includes(qNorm)) s *= 3;       // 问题字段整串命中
    else if (t.a.replace(/\s+/g, '').includes(qNorm)) s *= 1.5; // 答案里整串命中
    // 权威性加成：T0 来源、或正文引用了国标/行业标准条文的条目，施工问题里更可信
    const d = docs[i] || {};
    if (norm(d.source_type).toUpperCase() === 'T0') s *= 1.15;
    if (/(GB|JGJ|GB\/T)\s?\d{3,}/.test(t.a)) s *= 1.10;
    // 香港官方標準按效力等級加成
    if (d.authority_level && AUTH_BOOST[d.authority_level]) s *= AUTH_BOOST[d.authority_level];
    // 长度归一化（放缓：长答案往往含规范条文，不该被重罚）
    const len = 1 + t.a.length / 600 + t.q.length / 100;
    return { i, score: s / Math.sqrt(len) };
}).sort((a, b) => b.score - a.score).slice(0, opts.top);

// ---------- 输出 ----------
const out = scored.map(({ i, score }) => {
    const d = docs[i];
    return {
        score: Math.round(score * 100) / 100,
        id: d.id,
        category: d.category,
        question: d.question,
        answer: opts.full ? (d.answer || d.content) : String(d.answer || d.content || '').slice(0, 400) + (String(d.answer || d.content || '').length > 400 ? ' …' : ''),
        tags: d.tags,
        source: [d.source_type, d.source_chapter, d.source].filter(Boolean).join(' / '),
        sourceChapter: d.source_chapter || null,
        authority: d.authority || null,
        authorityLevel: d.authority_level || null,
        verified: d.verified || null,
        confidence: d.confidence || null,
        kb: d._kb || null,
        kbLabel: d._kbLabel || null,
        url: d.url || null,
        matched: opts.explain
            ? distinctive.filter((g) => { const t = docText[i]; return t.q.includes(g) || t.tags.includes(g) || t.cat.includes(g) || t.a.includes(g); }).slice(0, 8)
            : undefined,
    };
});

if (opts.json) {
    console.log(JSON.stringify({ query, total: N, loadMs: tLoad, hits: out }, null, 2));
} else {
    console.log(`知識庫: ${N} 條 (${loaded.join(' | ')}) | 查詢: "${query}"${opts.cat ? ` | 分類過濾: ${opts.cat}` : ''}${opts.officialOnly ? ' | 僅官方來源' : ''} | 命中前 ${out.length} 條 (載入 ${tLoad}ms)\n`);
    out.forEach((h, n) => {
        console.log('─'.repeat(72));
        const badge = h.authorityLevel ? `【${h.authorityLevel}】` : '';
        console.log(`[${n + 1}] 相關度 ${h.score} | ${h.kbLabel || ''} | ${badge}${h.category || '未分類'} | id=${h.id}`);
        if (h.matched && h.matched.length) console.log('命中區分詞: ' + h.matched.join(', '));
        console.log('Q: ' + h.question);
        console.log('A: ' + h.answer);
        if (h.tags) console.log('標籤: ' + (Array.isArray(h.tags) ? h.tags.join(', ') : h.tags));
        if (h.authority) {
            console.log(`出處: ${h.authority}｜${h.sourceChapter || ''}${h.verified ? `｜查證 ${h.verified}` : ''}${h.confidence === 'low' ? '｜⚠️ 信心低，不可作教材依據' : ''}`);
        } else if (h.source) console.log('來源: ' + h.source);
        if (h.url) {
            const flags = [];
            if (h.urlGate) flags.push('e-Legislation 連結需瀏覽器開啟，自動抓取只得載入頁');
            if (h.urlMirror) flags.push('此為鏡像連結，非官方域名');
            console.log('連結: ' + h.url + (flags.length ? `   ⚠️ ${flags.join('；')}` : ''));
        }
    });
    console.log('─'.repeat(72));
    if (out.some((h) => h.kb === 'hk')) {
        console.log('【香港官方標準】知識產權屬香港特別行政區政府及有關機構所有（以政府公開資料為基礎改寫）。');
        console.log('法例可能修訂；只有「電子版香港法例」上印有「經核證文本」標記的 PDF 具法律地位，HTML 及簡體版本僅供參考。');
        console.log('本工具非政府官方出版物，不構成法律意見；作決定前請查閱官方原文並徵詢註冊專業人士（AP/RSE/註冊電業承辦商/持牌水喉匠等）。');
    }
    if (out.some((h) => h.kb === 'mainland')) {
        console.log('【大陸第三方庫】無 license，僅供施工參考，具體標準請以當地規範與合同為準。');
    }
}
