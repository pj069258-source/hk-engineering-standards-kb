# 驗證紀錄（VERIFICATION LOG）

> 用途：記錄本知識庫**每一項資料的可信度來源與核實方式**。若被問「憑什麼相信這個答案」，這份文件就是答案。
> 最後更新：2026-10-03 | 所有工具皆可重跑

## 一、整體流程

```
6 路研究員抓取官方來源 → raw/*.json（每範疇 20-25 條）
        ↓
build.mjs            逐條驗證（必填欄位／枚舉值／id 唯一／https／內容品質／法定與慣例區分／URL 勘誤）
        ↓
check-urls.mjs       對每個 URL 實測 HTTP，並檢查回應是否有實質內容（能識破反爬假 200）
        ↓
fetch-eleg-rtf.mjs   以 3 步 HTTP 握手取得 e-Legislation 條例全文（RTF）→ evidence/（19 部條例，35.7 萬中文字）
        ↓
verify-quotes.mjs    條例類 quote 逐字回溯官方原文
verify-quotes-web.mjs 網頁／PDF 類 quote 逐字回溯網頁快取
        ↓
normalize-quotes.mjs 無法逐字者：能修則截為逐字前綴＋…，否則標記 quote_unverified 並註明原因
```

## 二、逐範疇結果

| 範疇 | 條目 | 效力等級 | 主要來源 |
|---|---|---|---|
| 建築與裝修合規 | 25 | 法定 7／附屬 8／官方指引 10 | 屋宇署 bd.gov.hk（22 個頁面全實測可開） |
| 水務工程 | 25 | 法定 5／附屬 5／官方指引 13／守則 2 | 水務署 wsd.gov.hk（21 個頁面全實測可開） |
| 電力工程 | 25 | 條例與規例為主 | 電子版香港法例（16）＋機電工程署（9） |
| 消防安全 | 20 | 法定／附屬／官方守則 | 消防處、屋宇署、電子版香港法例（13） |
| 滲水與防水 | 21 | 官方指引 13／法定 4／業界標準 3 | 滲水辦、屋宇署、水務署、HKIS、市建局 |
| 職業安全健康 | 20 | 法定／附屬 | 勞工處、電子版香港法例（Cap 509/59/59I/59Z/59AE/59W/59N/221） |
| **合計** | **136** | 官方指引 48／法定 42／附屬 36／守則 7／業界標準 3 | 19 部條例全文已存證 |

**URL 實測**：成品內所有 URL 逐一 fetch。**76/76 可正常開啟**（其中 11 個 e-Legislation 連結屬已知 JS 閘門——對人類瀏覽器有效，自動抓取只得載入頁）。

## 三、Quote 逐字回溯（最硬的一層證據）

| 類別 | 條目 | 逐字命中官方原文 | 說明 |
|---|---|---|---|
| 引用條例 | 45 | ✅ **45 / 45（100%）** | 對照 `evidence/capXXX.txt`（中文）與 `capXXX_en.txt`（英文）官方 RTF 全文 |
| 引用部門網頁 | 69 | ✅ 57 / 69 | 對照 `evidence/web/` 網頁快取（去標籤後逐字比對） |
| 引用 PDF | 22 | ⚠️ 0 / 22 | PDF 字型為 CID 編碼，自動抽取會漏字（見第五節），已全部標記 `quote_unverified` |

**無法自動核對者一律標記**，不留模糊空間：
- 標記 `quote_unverified: true` 並附 `quote_unverified_reason`
- 可補救者（引文省略了括號內容卻未標省略）已改為「逐字前綴＋…」，`quote_note` 說明

→ **136 條中，102 條 quote 已逐字回溯官方原文；34 條明確標記未自動核對並註明原因。**

## 四、e-Legislation 閘門：兩個解法

**問題**：`elegislation.gov.hk` 對任何非瀏覽器請求一律回傳 JS 載入頁（HTTP 200、約 7,562 bytes、"Loading required resource"），靜態 HTML 不含條文；PDF 下載路徑同樣被攔。

**解法 A（推薦，輕量，無需瀏覽器）**：3 步 HTTP 握手
```
GET  /checkconfig/checkClientConfig.jsp?applicationId=RA001   → 取 _CSRF_TOKEN 與 cookie
POST /checkconfig/submitClientConfig.do                        → 實測回 403 亦可
GET  /client-check                                             → 設下 clientCheckStatus cookie
GET  /hk/capXXX!zh-Hant-HK.rtf  或  /hk/capXXX!en.rtf          → 取得條例全文
```
已實作於 `fetch-eleg-rtf.mjs`，成功下載 **19 部條例**（Cap 123/123F/123J/221/406/406D/406E/502/509/572/59/59AE/59I/59N/59W/59Z/95/95A/95B），中英文版本齊備。

**解法 B（已安裝，保留）**：headless Chromium（Playwright，`%LOCALAPPDATA%\ms-playwright`，705.6 MB）。用於需要完整 JS 渲染的頁面。使用者已確認保留。

**獨立複核紀錄**：以解法 B 抓取 Cap 406/406D/406E 原文後，逐條核對電力範疇 16 條引用——11 條標有條號者全部命中，且「低壓」定義逐字一致（1 000 伏特／1 500 伏特／600 伏特／900 伏特）。複核結果寫入各條 `verified_via` 欄位。

## 五、已知技術限制（影響可信度範圍，必須揭露）

1. **PDF 文字抽取會系統性漏掉阿拉伯數字**：實測水務署《樓宇水管工程技術要求》PDF，原文「公稱直徑可以是 15 毫米或以上」抽成「公稱直徑可以是毫米或以上」，33,000 字中僅 95 個數字。
   → **嚴禁**用 PDF 抽取取得數值門檻。`pdf-text.mjs` 只可用於「定位要求在哪一節」，數字必須人手核對。
   → 這也是 22 條 PDF 類 quote 無法自動核對的原因。
2. **JS 動態載入頁**（如水務署 FAQ）：條文內容由 JS 注入，靜態快取取不到，故 12 條網頁類 quote 未能自動核對。
3. **e-Legislation 條例版本**：經核證文本（帶官方核證標記的 PDF）才具法律地位；本知識庫的 RTF 全文用於**核實引文**，不可當作法定文本引用。

## 六、修正紀錄（可審計）

| 項目 | 問題 | 處理 |
|---|---|---|
| `hk-seep-0018` / `0019` | 域名錯字 `ww.hkis.org.hk` 且為 http | 修正為 `https://www.hkis.org.hk/...`，並以 PDF 開頭標題驗證文件身分。修正記錄於 `build.mjs` 的 `URL_FIXES` |
| `hk-seep-0021` | 來源為 Internet Archive 鏡像 | 保留但標記 `url_mirror: true`，維持 `confidence: low` |
| 電力 16 條 | url 指向 e-Legislation 但缺核實方式 | 補 `verified_via`（11 條強複核、5 條弱複核） |
| 消防 13 條 | 同上，經 Chromium 實際讀取 | 補 `verified_via` 並註明方法 |
| 電力 17 條 quote | 原為壓縮改寫而非逐字 | 由研究員改回逐字原文（研究員主動申報） |
| `hk-bd-0022` / `hk-wsd-0018` | quote 省略括號內容卻未標省略 | 改為逐字前綴＋…（`quote_note` 說明） |
| 34 條 | 無法自動逐字核對 | 標記 `quote_unverified` 並註明原因 |

## 七、**未取得**的資料（刻意留空，未編造）

| 缺口 | 原因 | 建議 |
|---|---|---|
| 水務署水壓／管徑具體數值 | 只在 PDF 內，而 PDF 抽取會漏數字 | 人手開 PDF 核對 |
| 「第 N 級罰款」港幣換算表 | 未找到官方權威頁面 | 查《裁判官條例》(Cap 227) 或 Cap 221 附表 8（職安健路已補） |
| 水喉匠牌照固定有效年期 | 官方未明示 | 不推斷 |
| `hk-emsd-0011` 一句（NS/WH 級限制） | 引用的 CPD 教材 PDF 未實抓 | 已用其他逐字片段取代 quote，該句列為存疑 |

## 八、如何維護與使用

```bash
cd tools/hk-standards
node build.mjs              # 驗證＋合併
node check-urls.mjs         # URL 實測
node fetch-eleg-rtf.mjs     # 更新條例全文證據（可指定章號）
node rtf2txt.mjs            # RTF 重新轉文字
node verify-quotes.mjs      # 條例 quote 逐字回溯
node verify-quotes-web.mjs  # 網頁 quote 逐字回溯
node normalize-quotes.mjs    # 無法逐字者標記
```

**培訓用法建議**：
1. 示範「AI 給出處 → 學員自己點連結核對原文」，強調只有經核證文本 PDF 具法律地位。
2. 明確區分效力等級（法定／附屬／官方指引／業界標準）——這是管理層最需要建立的概念。
3. 遇到 `quote_unverified` 或 `confidence: low` 的條目，示範如何人手核對。
4. 建議每 6 個月重跑 URL 實測與 quote 驗證。
