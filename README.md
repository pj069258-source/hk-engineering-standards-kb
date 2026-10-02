# 香港工程標準知識庫 / HK Engineering Standards Knowledge Base

> 136 條香港建築工程官方標準，涵蓋 **水務、電力、建築裝修、消防、職安健、滲水防水** 六大範疇。
> 每條附**官方出處、條文編號、效力等級與可點擊連結**——為工程業界管理層的 AI 應用培訓而建。
>
> 136 curated entries on Hong Kong construction & building-services standards (water, electrical, building/renovation, fire, OSH, water seepage), each with an official citation, authority level, and verifiable link. Built for AI-adoption training for engineering management.

---

## 這是什麼

一個**可核查**的知識庫：每條答案都能追溯到香港政府官方來源，並明確標示其**法律效力等級**。

| 效力等級 | 條目數 | 說明 |
|---|---|---|
| 法定條例 | 42 | 主體條例（如 Cap 123《建築物條例》、Cap 406《電力條例》） |
| 附屬法例 | 36 | 規例（如 Cap 123N 小型工程規例、Cap 406E 電力（線路）規例） |
| 官方指引 | 48 | 部門發出的指引、實務守則 |
| 官方實務守則 | 7 | 如《2011 年建築物消防安全守則》 |
| 業界標準 | 3 | 學會／機構標準（**非強制**，答案中已明示） |

**設計原則**：法定要求與業界慣例**必須分開標示**。政府沒有強制標準的範疇（例如防水施工做法），一律標為「業界標準」並在答案中說明其非強制性。

## 快速開始

```bash
# 檢索（純 Node，零依賴）
node search.mjs "固定電力裝置定期檢查"
node search.mjs "小型工程呈交時限" --top 3
node search.mjs "滲水投訴 濕度" --official-only      # 只保留官方來源
node search.mjs --list-cats                          # 列出分類
node search.mjs --id hk-bd-0002                      # 按 id 取單條
node search.mjs --help
```

輸出範例：

```
[1] 相關度 92.95 | 香港官方標準 | 【官方指引】電力工程 | id=hk-emsd-0013
Q: 一般住宅或商業處所的固定電力裝置，何時須每5年做一次定期檢測？
A: 機電工程署指出…允許負載量超逾100安培，必須每5年最少接受一次檢查…
出處: 機電工程署 EMSD｜固定電力裝置定期測試｜查證 2026-10-03
連結: https://www.emsd.gov.hk/tc/electricity_safety/periodic_test_for_fixed_electrical_installations/index.html
```

## 資料格式

[`hk-standards.json`](hk-standards.json) 為純 JSON 陣列，每條：

```json
{
  "id": "hk-emsd-0013",
  "jurisdiction": "HK",
  "authority": "機電工程署 EMSD",
  "authority_level": "官方指引",
  "category": "電力工程",
  "tags": ["定期檢測", "定期检测", "100安培", "WR2"],
  "question": "...",
  "answer": "…改寫自官方資料，含具體數值門檻與出處…",
  "source_type": "HK-OFFICIAL",
  "source_chapter": "機電工程署 電力安全 > 固定電力裝置定期測試",
  "source": "機電工程署",
  "url": "https://www.emsd.gov.hk/...",
  "quote": "≤30 字原文片段",
  "verified": "2026-10-03",
  "confidence": "high"
}
```

`tags` 同時包含繁體與簡體寫法，故以簡體查詢亦可命中。

## 我們如何驗證（重點）

| 驗證項 | 結果 |
|---|---|
| 所有 URL 實測 HTTP 並檢查回應有無實質內容 | **76 / 76 通過** |
| 引用條例的 `quote` 逐字回溯官方原文 | **45 / 45 命中（100%）** |
| 引用部門網頁的 `quote` 逐字回溯網頁快取 | 57 / 69 |
| 無法自動核對者 | 一律標記 `quote_unverified` 並註明原因（共 34 條） |

驗證方法與完整結果見 [`docs/VERIFICATION-LOG.md`](docs/VERIFICATION-LOG.md)。

**技術要點**：`elegislation.gov.hk` 對非瀏覽器請求一律回傳 JS 載入頁。本專案以 **3 步 HTTP 握手**（`checkConfig → submitClientConfig.do → client-check`）取得條例 RTF 全文用於核實引文——**無需瀏覽器**，實作於 [`fetch-eleg-rtf.mjs`](fetch-eleg-rtf.mjs)。

> ⚠️ 本庫**不包含**法例全文（版權原因）。要重建核實用的證據檔，自行執行 `node fetch-eleg-rtf.mjs cap406 ...`。

## 工具鏈

| 檔案 | 用途 |
|---|---|
| `search.mjs` | 檢索器（零依賴，支援效力等級加權、分類／官方來源過濾） |
| `build.mjs` | 驗證＋合併：必填欄位、枚舉值、id 唯一、https、內容品質、法定與慣例區分、URL 勘誤表 |
| `check-urls.mjs` | URL 實測，能識破「HTTP 200 但實為反爬載入頁」 |
| `fetch-eleg-rtf.mjs` | e-Legislation 3 步握手 → 條例 RTF 全文 |
| `rtf.mjs` / `rtf2txt.mjs` | RTF→純文字（正確處理 `\ucN` 備用字元，否則中文大量漏字） |
| `verify-quotes.mjs` | 條例類 `quote` 逐字回溯 |
| `verify-quotes-web.mjs` | 網頁／PDF 類 `quote` 逐字回溯 |
| `normalize-quotes.mjs` | 無法逐字者：改為逐字前綴＋…，或標記未核對 |
| `pdf-text.mjs` | PDF 定位工具（⚠️ **會漏掉阿拉伯數字**，不可用於抽取數值門檻） |

```bash
node build.mjs             # 驗證 raw/*.json → hk-standards.json
node check-urls.mjs        # 實測所有連結
node verify-quotes.mjs     # 逐字回溯（需先建立 evidence/）
```

## 已知限制（誠實揭露）

1. **不包含法例全文**：版權原因。要引用條文，請到[電子版香港法例](https://www.elegislation.gov.hk)查閱**經核證文本 PDF**（唯一具法律地位的版本）。
2. **34 條 `quote` 未經自動逐字核對**：來源為 PDF（字型 CID 編碼會漏字）或 JS 動態載入頁，已逐條標記原因。
3. **`confidence: low` 的條目**（1 條）：來源為鏡像連結，**不可作為培訓教材依據**。
4. **未收錄的資料**（刻意留空，未編造）：水務署水壓／管徑具體數值（只在 PDF 內且抽取不可信）、水喉匠牌照固定有效年期（官方未明示）。
5. **法例會修訂**：每條有 `verified` 日期，建議每 6 個月重跑驗證。

## 法律與合規

- 本庫為**第三方整理**，**非香港特別行政區政府官方出版物**，**不構成法律意見**。
- 資料以政府公開資料為基礎**改寫**而成；知識產權屬香港特別行政區政府及有關機構所有（依 [data.gov.hk 使用條款](https://data.gov.hk/tc/terms-and-conditions) 要求註明來源）。
- 香港法例文本受**政府版權**保護（《版權條例》第 528 章第 16 條），故本庫**不收錄全文**，僅含改寫內容與 ≤30 字引文。
- 詳細說明見 [`NOTICE.md`](NOTICE.md) 與 [`docs/LEGAL-COMPLIANCE.md`](docs/LEGAL-COMPLIANCE.md)。**使用本庫（尤其用於培訓或商業用途）前請先讀這兩份文件。**

## 貢獻

新增條目：在 `raw/` 加入或編輯 `<domain>.json`（格式同上），執行 `node build.mjs`，再跑 `node check-urls.mjs` 確認連結有效。

**貢獻要求**：
- 每條必須有可抓取的官方 URL（`url` 必須是 https）
- `quote` ≤30 字原文；內容以**改寫**為主，勿複製法例全文
- 法定要求與業界慣例必須分開標示（`authority_level`）
- 具體數值門檻優先；查不到就不要寫模糊描述

## 授權

- **程式碼**：MIT（見 [`LICENSE`](LICENSE)）
- **資料**：政府資料衍生作品，依 [`NOTICE.md`](NOTICE.md) 的歸屬與免責條款使用
