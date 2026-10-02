#!/usr/bin/env node
/**
 * RTF → 純文字（供條例全文逐字比對用）
 * ------------------------------------------------------------------
 * 關鍵：RTF 標頭會宣告 \ucN，代表每個 \uN 轉義後面有 N 個「備用字元」必須跳過。
 *       e-Legislation 的 RTF 是 \uc2，若只跳 1 個會導致中文字元錯位、大量漏字。
 * 本模組只求「文字內容完整、可用於子字串比對」，不求版面還原。
 */

export function rtfToText(rtf) {
    let ucSkip = 1;
    let out = '';
    let i = 0;
    const n = rtf.length;

    while (i < n) {
        const c = rtf[i];

        if (c === '{' || c === '}') { i++; continue; }

        if (c === '\\') {
            // 控制字（\word[-N][空格]）
            const m = /^\\([a-zA-Z]+)(-?\d+)?[ ]?/.exec(rtf.slice(i, i + 32));
            if (m) {
                const word = m[1];
                const num = m[2];
                if (word === 'uc') {
                    ucSkip = num === undefined ? 1 : parseInt(num, 10);
                } else if (word === 'u') {
                    const code = parseInt(num || '0', 10);
                    out += String.fromCharCode(((code % 65536) + 65536) % 65536);
                    i += m[0].length;
                    // 跳過 ucSkip 個備用字元（可能是 \'hh 或普通字元）
                    let skipped = 0;
                    while (skipped < ucSkip && i < n && rtf[i] !== '{' && rtf[i] !== '}') {
                        const hm = /^\\'([0-9a-fA-F]{2})/.exec(rtf.slice(i, i + 4));
                        if (hm) { i += 4; } else if (rtf[i] === '\\') { const cm = /^\\([a-zA-Z]+)(-?\d+)?[ ]?/.exec(rtf.slice(i, i + 32)); i += cm ? cm[0].length : 1; } else { i++; }
                        skipped++;
                    }
                    continue;
                } else if (word === 'par' || word === 'line') {
                    out += '\n';
                } else if (word === 'tab') {
                    out += '\t';
                }
                i += m[0].length;
                continue;
            }
            // 十六進位轉義 \'hh
            const hex = /^\\'([0-9a-fA-F]{2})/.exec(rtf.slice(i, i + 4));
            if (hex) {
                const b = parseInt(hex[1], 16);
                if (b >= 0x20) out += String.fromCharCode(b);
                i += 4;
                continue;
            }
            i++;   // 其他跳脫（\\ \{ \} 等）
            continue;
        }

        out += c;
        i++;
    }

    return out
        .replace(/\r/g, '')
        .replace(/[ \t\u00a0]{2,}/g, ' ')
        .replace(/\n{2,}/g, '\n')
        .trim();
}
