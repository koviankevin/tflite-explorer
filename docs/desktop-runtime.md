# 現行正式版的跨引擎執行與指南驗收

本輪補齊 Firefox／WebKit 對固定 preview.30 的功能驗收，目標 build `f3ff13b75b83ee57`、site ID `ff1f2e3d7bafb505f8f0bf1037977746625f4c1e4c98e84779bbd301df76d956`。沿用現有 Hosted Linux `desktop-engines.yml`，只擴充測試 driver，不修改應用、workflow、安全設定或固定發布檔，也不重新部署。先前十三項跨引擎歷史結果保留在[桌面驗收](desktop-fixes.md)。

測試重用 Chromium 的原生操作流程：實際 chooser、滑鼠／鍵盤、BIN／草稿／模型下載與重開，以及對實際 CPU／IO bytes 的斷言。DOM 觀察使用既有隔離 selector world，不操作 app API、改 CSP 或啟用網站的 eval。檔案皆為公開合成樣本，網路只允許同源 GET 靜態資源。

新增範圍：

- 正式示範檔的原模型與編輯結果先匯出、重開，再分別使用全 0／亂數執行四次；不以另一個測試 fixture 代替網站示範檔。
- 獨立執行區的十九種情境：原始檔／編輯／組合／子模型、raw 多輸入、四種分佈與 const、實際 CPU／IO ZIP、v3 草稿／Redo／相同 bytes、shape／精度負例、取消／切頁，以及 custom／signature 明確未驗證。
- 五組指南流程：F1／manual tabs／Escape、原生選檔後焦點、忙碌與 MLIR 格式防護、示範新分頁、草稿管理、手動 CPU／IO 及 1280×640／1366×640 的 32px 背景圖。

保留原本十三項探索、pattern、TFLite 接線／權重／custom options／草稿，以及 MLIR SSA／跨 block Canvas／匯出重開的斷言。新流程預期每個引擎合計十六項原生檢查、六十個模型與十六個 runtime Workers 關閉；這些數字是驗收要求，尚不是執行結果。舊固定版沒有獨立 Run／指南模組時保留其原有範圍；preview.30 的獨立核對會要求兩個新範圍確實執行，不能以略過代替通過。

目前只完成七項 Hosted 執行界線、chooser／DOM 觀察與 HTTP 身分政策的 Node 檢查。兩引擎實際結果、原始 provider ZIP／SHA／CRC、受測來源、靜態檔清單、Worker 關閉與截圖仍待 CI 完成後核對。不把此短流程當成其他 OS、固定硬體 SLA、數小時 interpreter、完整螢幕閱讀器或公司 kernels 驗收。
