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

[40664660763](https://github.com/koviankevin/tflite-explorer/actions/runs/40664660763) 已成功；來源 `da70c88a9be134ea035bc728bbc56604420aa5a6`、tree `bf6c80ffcaed98926590625046e014780ed58f66`。原始 [八輪報告](results/soak-shared-eight-cycles-2026-10-28.json)與 [provider／來源相依核對](results/soak-shared-eight-review-2026-10-28.json)通過；24 個模型 Worker、八次完整原模型指紋、權重／custom options、完整模型及子模型重開皆核對。RSS drift 8,658,944 bytes、斜率 1,422,833.37 bytes／輪、取樣峰值 1,010,462,720 bytes，符合原門檻。這確認新增 soak 分支沒有破壞原模式；兩小時 run `40664650666` 的首次失敗另列如下，不能把八輪成功當成兩小時成功。


## 首次長測失敗：第二十一份草稿

[40664650666](https://github.com/koviankevin/tflite-explorer/actions/runs/40664650666) 已在第二十一輪等待自動保存時失敗，未達兩小時。原始 [失敗報告](results/soak-first-failure-2026-10-28.json)及 [provider digest／CRC／來源核對](results/soak-first-failure-review-2026-10-28.json)保留 failed。二十輪完整模型／子模型已下載、比對及重開；21 個完整原檔指紋都成功並終止，讀取保護無違規，故不能把這次失敗寫成指紋未完成或記憶體門檻失敗。最後一個模型 Worker 的 terminate 呼叫旗標維持原 false，實際關閉／cleanup 事件另存，未改寫。

根因是長測每次建立新草稿，卻未處理網站既有的 20 份保留上限。以實際 editRecoverySession／nextEditRecovery 的快速案例重現：前 20 份保存成功，第 21 份回報上限、未虛報已保存、既有歷史不變；下載可解析備份、移除指定舊稿後明確 retry，可保存新稿並保留另外十九份。回歸案例在 `test/edit-recovery.test.mjs`，不依賴大型模型或增加 timeout。

後續長測走真正 UI 的備份、移除已備份且屬於本次測試的舊稿、重試流程，保持 20 份保護與原有所有時間／記憶體門檻，不直接清空 IndexedDB、重啟瀏覽器或把二十輪當成兩小時。完整新 run 尚待取得成功結果；商品等級目標仍未完成。

## v2 長測的草稿容量流程

`soak-recovery.mjs` 只透過網站的草稿清單、下載、確認移除及重試按鈕操作，不直接讀寫 IndexedDB。每輪關閉模型並驗證權重／options 後，下載該輪最終草稿，重新解析 portable JSON，核對原檔大小／完整指紋、clone／expose 命令、32px 及 canonical SHA-256；Node ledger 只保留最多 20 筆 key／雜湊等 metadata，不持有 File、Blob 或 Worker。備份下載仍走原本 60 秒 URL 撤銷，納入當輪的自然釋放等待。

前 20 輪正常保留全部草稿；之後只有實際收到既有容量錯誤時，才從清單找出本次已核對的最舊 key，再下載一次核對內容未改變。確認另外十九份 key／revision 未變後，明確勾選移除該份，再按重試並確認新稿已提交。未知 key、內容改變、其他保存錯誤、刪錯或重試失敗一律使測試失敗，不能順便移除其他記錄。報告逐輪保留備份摘要、移除前／後 keys 與重試後 keys；判定器從頭重建 retention 歷史，拒絕漏證據、過早刪除及已移除草稿復活。歷史 v1 原始失敗報告保留，不能充當 v2 通過結果。

正式長測前先用公開小型 custom fixture、另一個隔離瀏覽器執行 22 次原生選檔、編輯、保存、關閉與備份，實際觸發兩次容量管理，並確認模型／指紋 Worker close 及 owned 程序樹完全結束。這是快速功能 preflight，報告單獨標示，不計入兩小時或 64 輪。隨後的實體大檔長測另開空白 context，從第一輪起持續使用同一個瀏覽器，不在測量中重啟或清空。

32 項相關 Node 檢查已通過，涵蓋原八輪門檻、草稿保存／CAS、容量管理正負例、物理 fixture、custom 匯出及清單刷新競態；這不代表上述真實瀏覽器 preflight 或兩小時負載已通過。應用／Netron 及正式網站仍維持 preview.18。

## v2 首次前測：清單刷新競態

[40679379293](https://github.com/koviankevin/tflite-explorer/actions/runs/40679379293) 在 22 次保存的快速前測中失敗，兩小時測量尚未開始。實際移除第 21 輪的舊稿時，UI 正常將 20 個 option 刷新為 19 個；觀察器分別 await `count`／`nth`／attribute，因而等待已消失的第二十項逾時。錯誤紀錄為 `locator('#edit-recovery-list option').nth(19)`，不是原檔指紋或保存逾時。

原始 [failed 報告](results/soak-capacity-list-failure-2026-10-28.json)及 [provider digest／CRC／來源核對](results/soak-capacity-list-review-2026-10-28.json)已保存：前 20 份最終備份已下載，開始第 21 次；21 個模型及 21 個指紋 Worker 全部 close，owned 程序全數正常結束，沒有 page error。測量區間為零輪／零時間，不能宣稱任何兩小時結果。

從實際 `rows` 抽出的相同逐筆讀取，在會於讀取中移除最後一項的快速 Node 案例先重現失敗；改為一次同步 DOM snapshot，再於 Node 核對 keys／revision，案例通過，下一次 snapshot 能正常觀察到 19 項。只使用既有 Chromium CDP 的唯讀 DOM 觀察，不呼叫應用 API、不更動模型或繞過確認移除。原始失敗仍保留；修正後需取得新的真實前測／兩小時結果，不能因單元案例通過就重標舊 run。

## v2 重測：第二十五輪保存狀態觀察

[40680745057](https://github.com/koviankevin/tflite-explorer/actions/runs/40680745057) 於 12:13 UTC 提前失敗，未滿兩小時。GitHub 日誌顯示 22 次快速前測通過，24 輪完整大檔操作完成；第二十五輪保存狀態把稍早的「背景核對原模型 100%」文字，與稍後更新的 error 旗標混在一起。當時 `textContent` 與 `getAttribute` 是分別 await 的兩次觀察，不能作為單一保存狀態。

完整 [原始 provider ZIP](results/soak-status-race-2026-10-28.zip)、[digest／CRC／來源核對](results/soak-status-race-review-2026-10-28.json)及 [完整輪數／保存與清理分析](results/soak-status-race-analysis-2026-10-28.json)已保存。24 輪約 38.6 分鐘，三個完整八輪批次通過原門檻；20 份保留、已核對舊稿下載／移除／retry 的四次實際流程完成。25 次原檔指紋全部完成；原生 73 模型／25 指紋 Worker 全部 close，browserClosed 為 true，errors 為空。最後一個模型的 terminate 呼叫旗標仍保留原 false，不能拿 context cleanup 改寫它。核對收據的 `measuredCycles: 25` 是已開始項目數，補充分析明確區分完成 24 與未完成 25；以上不代表兩小時、最終 sourceUnchanged 或未量到範圍已驗收。

抽出實際相同讀取後，快速測試先重現回傳舊進度文字的失敗；改為一次同步 DOM snapshot 取得文字與旗標，再於 Node 分類。舊進度／非錯誤會繼續等，完整容量錯誤才允許既有備份／移除／retry，其他錯誤仍失敗；缺少旗標或「已保存」同時帶錯誤也直接拒絕。36 項相關 Node 檢查通過，不增加 timeout、不改保存內容或放寬兩小時門檻。修正後仍需新的真實長測，原失敗不改標。

原八輪模式 [40679388661](https://github.com/koviankevin/tflite-explorer/actions/runs/40679388661) 已通過 provider／依賴 scope／原始量測核對；來源 `7ca9d748a931c7c4c8f8d7e6b0b4fd64806b1417`，見 [原始報告](results/retention-shared-eight-cycles-2026-10-28.json)與 [核對收據](results/retention-shared-eight-review-2026-10-28.json)。RSS 漂移 28,155,904 bytes、斜率 1,271,632.46 bytes／輪、峰值成長 479,506,432 bytes；24 模型／八完整指紋 Worker、權重／options 與匯出重開完成。這是該來源八輪成功，不能當作任何未完成的兩小時或後續修改來源的發布憑證。

兩小時長測是獨立手動 CI，沒有加入 GitHub Pages 部署前置。一般更新依受影響功能選測，未變的來源相依結果可沿用；記憶體／快取／Worker 的長期穩定性驗收另計，不要求每次排版或文字部署都等待兩小時。
