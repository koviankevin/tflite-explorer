# 手動執行的部分 IO 保存（v1.4.1 候選）

目前正式站與固定下載仍為 v1.4.0；本修正尚未發布。編輯匯出保持靜態檢查，interpreter 仍須手動執行已開啟的 TFLite。既有大模型 RSS 正式關卡失敗保持原判，不因這項修正或獨立診斷通過便發布。

真正 LiteRT.js 2.6.0 CPU WASM 的不整除 legacy FC 會在執行後產生不符宣告的 output shape，並回傳無法用公開 `toTypedArray()` 取得的 padded tensor。原封存器讓這個例外中止整包 ZIP，連已可取得的 inputs 都遺失。候選改成逐 tensor 保存：單一資料讀取或長度檢查失敗時，保留其他可讀的 raw BIN、原本 slot 編號及明確原因。沒有嘗試解讀未公開的 strides／padding，也不填假值。

完整成功取得的 archive 保留 `model-lens-runtime-io` version 1 與原檔名。部分保存使用 version 2，維持 `inputs-N.bin／outputs-N.bin` 編號；缺少的 row 為 `status=not-saved`、`file=null`，含 shape、dtype、expectedBytes 及最多 512 字元的原因。可保存的 row 標記 `saved`；`capture` 列出 requested／saved、缺少的 side／index 與實際保存 bytes。run() 或 input 建立例外而尚未產生的 tensor 也保留宣告的介面 row，明列未提供資料。沒有資料的 tensor 不產生 BIN，也不把缺少 bytes 寫成已保存的零值。外部讀取器必須檢查 version 與 capture 狀態。

執行畫面仍顯示原失敗、原 shape／dtype 原因與 diagnostics，另提示「執行記錄部分保存」、第一個未保存 tensor 的原因及 manifest 位置。即使只有 metadata 可保存，也能下載明列缺漏的 manifest；保存 IO 不會把 runtime 失敗改列通過。全部 IO 的原 16 MiB 預算、17 MiB ZIP 上限、每側最多 128 個介面、單次手動執行／30 秒終止規則維持，並在讀 payload 前檢查整份 capture 的大小。

實際 CPU 回歸先重現「執行已失敗但三個輸入無法下載」，再確認同一負例仍失敗、三個 inputs bytes 保留、padded output 不偽造。canonical／legacy／編輯／切出四個合法 FC 的十個輸出值保持一致。73 項相關選測通過，另涵蓋多輸出中間 slot 缺失、失效長度、全部缺漏、錯誤字數界線、預算不被例外繞過、ZIP CRC，以及 transfer／下載／buffer 重用／釋放和完整 v1 相容性。最初新增測試曾誤以為同尺寸的可重用 buffer 也必須 detach；依既有 ownership 契約修正測試，原失敗紀錄保留，未修改該契約。

候選來源 `4a764049b62dfb1afc6d48462699759efea61cb3`／tree `b767fb247805e96d9c30b5220bb1bc3a49e4a457`、build `bc25d5ce7d3b5dc5`，325 個核心檔。Windows Chrome 156.0.8078.76／Edge 156.0.4314.50 各完成原生選檔、零值／亂數錯誤模型的部分 ZIP、正常完整 ZIP、1280×640／圖字 32px、六個 Worker 與八／十一個觀察到的程序正常退出。六份實際下載的 ZIP CRC、模型 SHA、輸入 BIN bytes 及可重播的亂數、正常十個零值輸出和缺少的 output 均已獨立核對；畫面錯誤原因可讀、下載按鈕可操作，無水平溢位。這是經完整性核對的原始 HTML 隔離 fixture，沒有正式 HTTPS 文件傳輸或實體 RSS 改善的主張。

第一輪 Chrome 的三個功能案例通過，但新 flow 誤把頁面常駐的 Netron 排版 Worker 算入「模型關閉即退出」，使原整輪失敗。修正 flow 僅觀察 model／runtime Worker；外層 driver 仍要求關閉 context 後六個 Worker 全部退出，沒有刪除程序退出檢查。另一次粗略的 PID 身分觀察曾誤列 Chrome root 仍存活，Win32 exit code 0、非零 exit time 與 signalled handle 確認其已退出；對已退出程序的終止嘗試回傳 false，沒有成功強制終止。原始錯誤、失敗和更正均保留，不把第一輪改列成功或補作原 10 秒退出證明。

[公開候選摘要](results/runtime-partial-io-candidate.json)保留來源、版本、驗收計數與結果；30 筆原始 metadata／失敗／畫面及讀取器的封存完整留在本機，摘要提供其 SHA-256。公開檔案不含本機原始日誌、截圖、路徑、程序身分或環境欄位。新情境接入後續正式 smoke 與桌面 driver；只有確定已發布的舊版本略過，未知／新版本不得省略。模型、原始 IO ZIP／BIN 和完整診斷留在本機。PR／main 必要關卡與正式交付仍待完成，原 RSS 失敗不由這項功能或診斷取代。

## 新來源的必要關卡

接續實際索引配置修正後，[四項主分支收據](results/model-index-allocation-main.json)已核對來源 `c0dd77c8` 的核心、實體大模型八輪、79 項發布契約及 HTTP 候選 38 項操作。部分 IO 在零值／亂數負例仍保留失敗，三個可讀 inputs 成功下載、padded output 明列缺少；合法完整案例仍為 v1。所有相關 Worker 已關閉。這是候選驗收，正式 HTTPS 與固定 Release 尚未發布；原 RSS 失敗和先前候選收據維持原結果。
