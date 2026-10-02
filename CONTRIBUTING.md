# 貢獻指南（CONTRIBUTING）

感謝你有意完善這份香港工程標準知識庫。本庫的價值全在**可核查**，所以貢獻門檻圍繞這一點設計。

## 一、貢獻紅線（違反的 PR 不會被合併）

1. **不得張貼法例或官方文件的全文**。香港法例文本受政府版權保護（《版權條例》第 528 章第 16 條）。
   - `quote` 欄位**最多 30 字**原文片段
   - 其餘內容一律**改寫**，不得逐段複製
   - 不要在 PR 內附上任何 PDF 全文或網頁全文快照
2. **不得憑記憶或推測填寫條文內容**。每條的 `url` 必須是你**實際抓取成功**的官方頁面。
3. **不得把業界慣例寫成法定要求**。政府沒有強制標準的範疇，`authority_level` 必須填 `業界標準`，並在 `answer` 中明示其非強制性。
4. **不得只寫模糊描述**。查不到具體數值門檻（時限、金額、尺寸、週期）就不要寫「有一定要求」——寧缺勿濫。
5. 不得加入廣告、招生、推銷內容。

## 二、新增／修改條目

1. 編輯 `raw/<domain>.json`（現有：`building` / `water` / `electrical` / `fire` / `safety` / `seepage`）
2. 執行驗證與合併：
   ```bash
   node build.mjs        # 驗證並產生 hk-standards.json
   node check-urls.mjs   # 實測所有連結（有問題會以退出碼 1 結束）
   ```
3. 確認 `build.mjs` 沒有 ❌ 錯誤（有錯誤的條目會被剔除、不會寫入成品）
4. 提交 PR，說明你新增了什麼、資料來源為何

## 三、條目格式

```json
{
  "id": "hk-bd-0026",
  "jurisdiction": "HK",
  "authority": "屋宇署 Buildings Department",
  "authority_level": "法定條例",
  "category": "建築與裝修合規",
  "tags": ["繁體詞", "简体词", "英文或數字關鍵詞"],
  "question": "具體、可回答的問題",
  "answer": "2-4 句，含具體數值門檻，末句說明出處。改寫自官方資料。",
  "source_type": "HK-OFFICIAL",
  "source_chapter": "《建築物條例》(Cap. 123) 第 X 條 / 官方文件名稱",
  "source": "屋宇署 / 電子版香港法例",
  "url": "https://www.bd.gov.hk/...",
  "quote": "≤30 字原文片段",
  "verified": "2026-10-03",
  "confidence": "high"
}
```

### 欄位規則

| 欄位 | 規則 |
|---|---|
| `id` | `hk-<前綴>-0001` 格式，前綴：`bd`／`wsd`／`emsd`／`fsd`／`ld`／`seep`。**全庫唯一** |
| `authority_level` | 只能是：`法定條例` / `附屬法例` / `官方指引` / `官方實務守則` / `業界標準` |
| `url` | 必須 `https://`，且為你實測可開啟的頁面 |
| `quote` | ≤30 字原文；若無法取得逐字原文，可省略此欄位 |
| `verified` | 你查證的日期（YYYY-MM-DD） |
| `confidence` | `high` 或 `low`；`low` 表示內容未經一手文本核實，會顯示警告且不可作教材依據 |
| `tags` | 建議同時包含繁體與簡體寫法，讓簡體查詢也能命中 |

## 四、新增範疇

在 `raw/` 新增 `<domain>.json` 即可，`build.mjs` 會自動納入。請在 PR 說明該範疇的權威來源機構。

## 五、關於 e-Legislation 的引用

`elegislation.gov.hk` 對非瀏覽器請求只回傳 JS 載入頁，自動化無法核實內容。因此：

- 若 `url` 指向 e-Legislation，**必須**加 `verified_via` 欄位，說明你是如何核實條文內容的（例如「以 headless 瀏覽器讀取原文」）
- 或者改用實際可抓取的來源（部門頁面／官方 PDF）並在 `source_chapter` 寫明條號
- 倉庫附有 `fetch-eleg-rtf.mjs`（3 步 HTTP 握手取得條例 RTF 全文）。**請注意**：該工具僅供**個人核實引文**之用；取得的全文**不得**提交到本倉庫（版權原因，`.gitignore` 已排除 `evidence/`）

## 六、品質檢查清單

提交前請確認：

- [ ] `node build.mjs` 無 ❌ 錯誤
- [ ] `node check-urls.mjs` 全部通過
- [ ] 每條都有具體數值門檻（或明確說明官方未訂明）
- [ ] 法定 vs 業界慣例已正確區分
- [ ] 沒有貼上任何法例／文件全文
- [ ] `tags` 含繁簡兩種寫法

## 七、授權

貢獻即表示你同意：程式碼部分以 MIT 授權，資料部分依 [NOTICE.md](NOTICE.md) 的條款提供。
