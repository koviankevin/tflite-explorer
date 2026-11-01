# 手動執行的部分 IO 保存（v1.4.1 候選）

目前正式站與固定下載仍為 v1.4.0；本修正尚未發布。編輯匯出保持靜態檢查，interpreter 仍須手動執行已開啟的 TFLite。既有大模型 RSS 正式關卡失敗保持原判，不因這項修正或獨立診斷通過便發布。

真正 LiteRT.js 2.6.0 CPU WASM 的不整除 legacy FC 會在執行後產生不符宣告的 output shape，並回傳無法用公開 `toTypedArray()` 取得的 padded tensor。原封存器讓這個例外中止整包 ZIP，連已可取得的 inputs 都遺失。候選改成逐 tensor 保存：單一資料讀取或長度檢查失敗時，保留其他可讀的 raw BIN、原本 slot 編號及明確原因。沒有嘗試解讀未公開的 strides／padding，也不填假值。

完整成功取得的 archive 保留 `model-lens-runtime-io` version 1 與原檔名。部分保存使用 version 2，維持 `inputs-N.bin／outputs-N.bin` 編號；缺少的 row 為 `status=not-saved`、`file=null`，含 shape、dtype、expectedBytes 及最多 512 字元的原因。可保存的 row 標記 `saved`；`capture` 列出 requested／saved、缺少的 side／index 與實際保存 bytes。run() 或 input 建立例外而尚未產生的 tensor 也保留宣告的介面 row，明列未提供資料。沒有資料的 tensor 不產生 BIN，也不把缺少 bytes 寫成已保存的零值。外部讀取器必須檢查 version 與 capture 狀態。

執行畫面仍顯示原失敗、原 shape／dtype 原因與 diagnostics，另提示「執行記錄部分保存」、第一個未保存 tensor 的原因及 manifest 位置。即使只有 metadata 可保存，也能下載明列缺漏的 manifest；保存 IO 不會把 runtime 失敗改列通過。全部 IO 的原 16 MiB 預算、17 MiB ZIP 上限、每側最多 128 個介面、單次手動執行／30 秒終止規則維持，並在讀 payload 前檢查整份 capture 的大小。

實際 CPU 回歸先重現「執行已失敗但三個輸入無法下載」，再確認同一負例仍失敗、三個 inputs bytes 保留、padded output 不偽造。canonical／legacy／編輯／切出四個合法 FC 的十個輸出值保持一致。73 項相關選測通過，另涵蓋多輸出中間 slot 缺失、失效長度、全部缺漏、錯誤字數界線、預算不被例外繞過、ZIP CRC，以及 transfer／下載／buffer 重用／釋放和完整 v1 相容性。最初新增測試曾誤以為同尺寸的可重用 buffer 也必須 detach；依既有 ownership 契約修正測試，原失敗紀錄保留，未修改該契約。

Chrome／Edge 原生選檔、零值／亂數錯誤模型的部分 ZIP、正常完整 ZIP、1280×640／32px 畫面及 Worker／程序退出仍待本候選驗收。新情境接入後續正式 smoke 與桌面 driver；只有確定已發布的舊版本略過，未知／新版本不得省略。模型、BIN 和完整診斷仍留在本機，公開 evidence 只收白名單 metadata、日誌與畫面。
