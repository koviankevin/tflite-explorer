# 大模型兩小時負載驗收

這是新增的手動 CI，尚未執行成功時不能寫成長時間驗收完成。`.github/workflows/browser-soak.yml` 只允許此 repository 的 main／workflow_dispatch、Ubuntu 24.04 hosted runner，權限只有 contents: read。它不部署網站、不操作個人瀏覽器，也不接受公司模型、外部 URL、較小 fixture、縮短時間或放寬記憶體的輸入。

沿用 [八輪生命週期](browser-lifecycle-gate.md)的實際 1,349,965,216 bytes／21,005 OP TFLite，完整非零權重寫入、fsync 與讀回 SHA；同一個 Chromium、context 和頁面持續至少兩小時。每輪都以原生選檔開啟、搜尋 prefix／分支匯合 pattern、實際編輯原始 OP、匯出完整模型與 >1 GiB 子模型、重開、比對權重及 custom options、驗證 pattern 正反例，再關閉模型。每輪重新完整核對原模型指紋。已下載的當輪檔案在使用後刪除，只有目前測試產生的隔離暫存檔會清理。

兩小時採單調時鐘，從第一輪開始計算，不能靠測試結束後空等湊滿。至少 64 輪、完整八輪批次，最多 128 輪／150 分鐘；每輪至多五分鐘，輪間至多五秒。達到時間但未完成八輪批次時會繼續該批次。保留應用自然 60 秒 Blob URL 撤銷與五筆關閉後樣本，不強制 GC、不重新啟動瀏覽器、不重載頁面清空快取。

固定 viewport 為 1280×640，探索圖與編輯區每輪都檢查實際 32px 選項值；不測手機。這是既有 14 吋功能驗收之外的負載範圍，不代替所有畫面的視覺檢查。

## 事先固定的判定

原有 `MODEL_EDIT_LIFECYCLE_POLICY` 與八輪發布關卡完全保留。每批八輪仍逐項套用原有 768 MiB 峰值成長、128 MiB 關閉 RSS 漂移、32 MiB main heap 漂移、16 MiB／輪斜率、512 MiB Worker V8／backing storage、讀取上限、實際 Worker 終止及匯出要求。整個兩小時再額外檢查：

- 最初兩輪暖機後，以實際時間計算的關閉 RSS 線性斜率最多 16 MiB／小時。
- 所有後續關閉樣本的三筆滾動中位數，相對最初暖機基準，RSS 最多增加 128 MiB、main heap 最多增加 32 MiB；不能在新批次重設基準來隱藏累積，也不能以最後恢復掩蓋中途增加。
- 沿用每 500ms 的整個 owned Chromium 程序樹 RSS 及 main heap 取樣；實際平均間距最多 1,000ms、任一缺口最多 10,000ms，開始／結束也必須有樣本覆蓋。原始間距、相位和數值均保存，未取到的峰值不宣稱已測得。
- 任一輪缺少完整權重／options、原檔指紋、三個模型 Worker 檢查點、下載重開或清理證據，都使整輪失敗。除應用 terminate 呼叫紀錄之外，另收集原生 Worker close；每輪的三個模型 Worker 與一個完整指紋 Worker 都必須收到真正的 close，未收到的其他 Worker 事件保留原 false。中途 crash、未完成、超時、source dirty／改動、晚期失敗及關閉失敗均不可算通過。

每八輪原子保存一次數值 checkpoint，結束另存最終報告；只有報告上傳，不上傳模型。報告記錄 source commit/tree、實際 build／引擎版本、runner 硬體、每輪與取樣數據、失敗原因及 cleanup。獨立核對時仍須確認 workflow/job/attempt、provider artifact digest／CRC、受測來源與原始所有數據，不能只看 passed 字串或仍為 running 的 checkpoint。

## 證據界線

新增門檻的 Node 正負例檢查短時、空等、跳時、低頻取樣、晚期損壞匯出／未釋放 Worker、放寬 policy、跨批次累積，以及八輪能放過的緩慢長期 RSS 成長。這些證明判定器可拒絕不合格證據，不代表真實瀏覽器已通過。初次實際結果將另記錄，保留失敗而不改動原門檻。

此報告不能代替公司實模／私有 runtime、MLIR 數小時負載、Firefox／WebKit 的 >1 GiB 程序記憶體、固定實體硬體 SLA、OS 斷電或無限期不洩漏。正式網站與固定 Release 仍是已驗收的 preview.18；本輪只有測試與文件，未更新應用程式。


## 共用 runner 的原八輪模式

[40664660763](https://github.com/koviankevin/tflite-explorer/actions/runs/40664660763) 已成功；來源 `da70c88a9be134ea035bc728bbc56604420aa5a6`、tree `bf6c80ffcaed98926590625046e014780ed58f66`。原始 [八輪報告](results/soak-shared-eight-cycles-2026-10-28.json)與 [provider／來源相依核對](results/soak-shared-eight-review-2026-10-28.json)通過；24 個模型 Worker、八次完整原模型指紋、權重／custom options、完整模型及子模型重開皆核對。RSS drift 8,658,944 bytes、斜率 1,422,833.37 bytes／輪、取樣峰值 1,010,462,720 bytes，符合原門檻。這確認新增 soak 分支沒有破壞原模式；兩小時 run `40664650666` 仍在執行，不能把八輪成功當成兩小時成功。
