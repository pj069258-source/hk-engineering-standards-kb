#!/usr/bin/env node
/**
 * 把 evidence/*.rtf 重新轉成 .txt（用修正後的轉換器）
 * 用法: node rtf2txt.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { rtfToText } from './rtf.mjs';

const EV = path.join(import.meta.dirname, 'evidence');
const rtfs = fs.readdirSync(EV).filter((f) => f.endsWith('.rtf'));
let total = 0;
for (const f of rtfs) {
    const rtf = fs.readFileSync(path.join(EV, f), 'latin1');
    const txt = rtfToText(rtf);
    fs.writeFileSync(path.join(EV, f.replace(/\.rtf$/, '.txt')), txt, 'utf-8');
    const cjk = (txt.match(/[\u4e00-\u9fff]/g) || []).length;
    console.log(`${f.padEnd(14)} → ${String(txt.length).padStart(7)} 字（中文 ${cjk}）`);
    total += cjk;
}
console.log(`\n共 ${rtfs.length} 個檔，中文總字數 ${total}`);
