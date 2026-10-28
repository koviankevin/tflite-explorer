# TFLite 手動執行檢查

開檔、編輯、一般匯出不會載入 interpreter，也不會自動跑推論。編輯工作區另提供「檢查能否執行（選用）」：沒有變更時檢查目前原模型，有變更時先建立並重新解析候選模型。按鈕準備完成後才列出 model inputs，再按「以這組輸入執行一次」啟動本機 LiteRT.js 2.6.0 CPU WASM。

每個 input 分別選零值、帶 seed／範圍的亂數或 raw `.bin`。面板顯示名稱、shape、dtype、所需 bytes；多輸入需逐項對應。raw 資料採 little-endian，byte 數須完全一致，沒有自動 dtype 轉換。boolean 限 0／1；量化資料使用原始整數值。零值指儲存值 0，不推測各 channel 的數學零點。索引、mask、token IDs 等有語意限制的輸入需由使用者提供有效資料，亂數不保證合法。

模型、測試資料、結果與診斷均留在本機；runtime JS／WASM 與網站一起封裝，無 CDN 或遠端模型服務。每次檢查使用獨立 Worker，完成、失敗、取消及 30 秒逾時均終止。可取消而保留草稿，取消不啟動下載。支援模型上限 128 MiB，保守估算 `3 × 檔案 + 2 × tensor bytes + 64 MiB` 限 512 MiB，輸入／輸出合計限 16 MiB。這是提前配置估算，**不是 kernel scratch 或整個瀏覽器 RSS 的硬上限**；大型模型仍可探索、編輯及匯出，應交給 native runtime 驗證。

結果分為通過、失敗、未能驗證。載入／編譯與執行分別記錄；有些 kernel 在第一次執行才配置／prepare，不能把成功載入當成成功執行。缺少 custom kernel、動態／未知 shape、不支援 dtype、資源超額、初始化失敗、取消或逾時不算通過。檢查涵蓋主 subgraph 與一組輸入，不宣稱所有 signatures、分支、迴圈路徑、精度或與原模型等價；失敗也須結合 runtime／輸入語意判讀。

「下載測試 input／output」保存 ZIP：`inputs-N.bin`、實際存在的 `outputs-N.bin`、`manifest.json`，含 dtype／shape、little-endian、資料來源／seed、執行狀態與候選模型標準 SHA-256（無 WebCrypto 時明確為 null）。執行失敗但已有 inputs 時可以保存部分記錄，沒有 outputs 會保持空清單。ZIP 不含模型或權重；每次只保留最近一次，改草稿、換 signature 選項或關閉模型後釋放。下載須由使用者按鈕操作。

同一份未變更的已檢查候選可直接匯出，報告包含該次實際狀態；一般匯出未跑 runtime 時保留未驗證，不把舊草稿的成功套用到新草稿。Runtime 失敗不禁止結構匯出，方便帶到公司 runtime 處理，報告仍保留失敗。

輸出 shape 推導目前涵蓋部分逐元素 unary、ADD／MUL／SUB／DIV 等 broadcast、SQUEEZE、單輸入且 options 固定的 RESHAPE。dtype／量化仍由參考 tensor 明確指定；未知、動態、per-axis 量化維度衝突或未實作的 OP 保留參考並顯示原因。舊 v1 編輯草稿未帶 `inferOutputs` 時維持原行為。

LiteRT 來源、精確 npm integrity、原始檔 hashes、Apache-2.0 LICENSE 與 NOTICE 保留於 `vendor/litert/2.6.0/`。公開 runtime 不包含公司的 custom kernels。此功能與公司 runtime 相容性、任意 builtin 組合皆可執行及整體商品等級完成是不同的驗收範圍。

本機實際 CPU WASM 已驗證 ADD 的 `[1,2] + [3,4] = [4,6]`、raw 多輸入、ZIP bytes，以及不合法 broadcast／output shape 的失敗。Hosted 原生選檔／下載、14 吋 32px、取消與正式部署證據尚待本次 CI；未完成前不列為已交付。

首次候選 [40697650768](https://github.com/koviankevin/tflite-explorer/actions/runs/40697650768) 的既有 29 項操作通過，但新 runtime 初始化失敗：部署來源格式白名單未複製 `.wasm`，請求取得 404 文字。保留失敗，不以 Node 原始碼成功代替打包後的瀏覽器成功。新增實際打包回歸在修正前以 ENOENT 失敗、修正後通過；產物 verifier 另拒絕刪去 WASM 後重新製作的完整 manifest。版本子路徑下的實際 Worker／官方 loader 也在 Node VM 以打包檔重現失敗，修正後成功執行；瀏覽器重測仍需取得後續證據。
