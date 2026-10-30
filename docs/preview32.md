# preview.32 候選驗收與發布

本版重用已核對的公開 LiteRT `WebAssembly.Module`，每次執行仍建立獨立 Instance、memory 與 Worker；模型、權重和測試資料全程在本機處理，只有手動執行才載入 runtime。IO 匯出轉移及重用受限的自有 buffer，下載時用本機 `Response.blob()` 準備 Blob，並處理重複點擊、切換模型、取消及失敗重試。詳見 [runtime module 與 IO 修正](runtime-module-cache.md)。

## 固定候選證據

來源 `3ca2036198c146b2ba0c6757d2552a36482c5cd6`／tree `c1d4ab2f8a6b2b91f9280d7db3ffb4b8f9bcbf6d`／build `a5de3383cd23b3eb`，307 個核心檔。兩個獨立 reader 在固定乾淨 checkout 真正 exit 0，核對 provider digest、ZIP CRC、來源／job／attempt 與完整 dependency scopes；後續只更新文件和發布 run IDs，沿用相同應用與測試證據。

| 關卡 | 結果 |
| --- | --- |
| [核心效能 40885892195](https://github.com/koviankevin/tflite-explorer/actions/runs/40885892195) | 87 檔 dependency fingerprint 完全相同，重新核對 provider 原始資料後沿用 |
| [實體大檔 40988115970](https://github.com/koviankevin/tflite-explorer/actions/runs/40988115970) | 1,349,965,216 bytes／21,005 OP／非稀疏權重八輪通過；RSS slope 2,011,370.06 bytes／輪、drift 12,365,824 bytes；六個已觀察程序正常退出 |
| [Contract 40988119361](https://github.com/koviankevin/tflite-explorer/actions/runs/40988119361) | 完整發布合約成功 |
| [Chromium 40988325416](https://github.com/koviankevin/tflite-explorer/actions/runs/40988325416) | 六項版本切換、33 項原生操作、19 個執行情境、五組指南；86 model／44 runtime Workers close；兩種筆電 viewport 與 32px 通過 |

CPU／IO 八輪共 24 次執行、八份完整 IO bytes 比對，URL 自然約 60 秒釋放；RSS slope 9,854,507.89 bytes／輪、drift 4,788,224 bytes，六個已觀察程序正常退出。另核對實際 WHILE invoke 的取消／30 秒逾時／恢復、14 次一般與 24 次生命週期輸入清理；cold context 只取得一次 WASM，取消後能再次執行，三個 runtime／一個 model close；仍保有 native handle 的兩個測試輸入控制項在完成／取消後 FileList 清空。

搜尋定位、pattern 匯入／匯出、跨 block 圈選、TFLite 權重／custom options 和 MLIR SSA／控制流程匯出重開沿用原生案例核對。[完整原始 ZIP 與獨立 reader](results/preview32-candidate-evidence.zip)、[逐檔 SHA／實際退出紀錄](results/preview32-candidate-evidence.json)保留。

2026-10-30 依使用者指示，必要瀏覽器範圍只保留 Chrome／Edge；Firefox、Safari／WebKit 為選做，保留手動入口與歷史資料，不列部署阻擋。本次自動化實際使用 Hosted Linux Chromium，不代表 Windows 兩個廠牌本體各自通過。CPU／IO 小模型與 1.25 GiB 開檔／編輯／匯出是兩組不同負載；未執行兩小時長測、手機或公司環境，也不把 main V8 heap 稱作連續 Worker／WASM heap。原 RSS、URL 60 秒與 runtime 30 秒規則未放寬。

## 發布狀態

四項候選關卡已核對，準備以同一組來源範圍發布 preview.32。此紀錄尚不代表部署完成；正式站目前仍為 [preview.31](preview31.md#發布狀態)。正式準備、完整 site ID、固定 Release 及部署收據將在實際完成後補入。
