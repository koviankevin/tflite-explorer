# 桌面瀏覽器相容性

既有正式關卡使用 Hosted Linux Chromium。`Desktop engine compatibility` 另以 lockfile 固定的 Playwright Firefox／WebKit，唯讀驗收已發布的完整 site ID 與 build ID。這是桌面引擎驗收，不代表 Windows Firefox、macOS Safari、公司實模、超過 1 GiB 或數小時負載已通過。畫面範圍為 14 吋筆電的 1366×640／1280×640，字級包含 32px，不測手機。

工作流程只有手動入口、`contents: read` 權限，僅允許此 repository 的 main／Hosted Linux runner。先逐檔核對正式站 SHA／MIME 及 root，再啟動獨立瀏覽器；結束時再次核對正式 site／core 身分，並保存 driver Git tree、實際引擎版本、原始操作報告及截圖。模型只有原始公開合成 fixtures，所有非 GET 或站外請求都拒絕。沒有部署、重跑正式發布或操作個人瀏覽器。

選檔、下載、點擊、拖曳及鍵盤透過瀏覽器 protocol 操作，頁面 evaluate 僅唯讀觀察 DOM，不呼叫 app 內部 API。沿用既有 TFLite 接線／自動 tensor／Undo／Redo、草稿保存與同大小錯誤原檔拒絕、IF／WHILE／custom OP 編輯匯出，以及 MLIR 分支／匯合／迴圈 Canvas 鍵盤驗收；重新解析實際下載的檔案並比對權重、custom options、SSA／dominance 及 pattern。每個模型 Worker 必須收到 close。

首次新增 workflow 的程式與來源檢查完成後，仍須實際 dispatch 並查看兩個引擎的原始結果；不能把工作流程存在、Node 測試成功或 Chromium 綠燈寫成 Firefox／WebKit 通過。實際驗收紀錄會在本頁補入，失敗亦保留。

實作使用 [Playwright 的固定瀏覽器安裝](https://playwright.dev/docs/browsers)、[file chooser](https://playwright.dev/docs/api/class-filechooser) 與 [download](https://playwright.dev/docs/api/class-download) 介面；Linux WebKit 驗收與實體 Safari 分開記錄。
