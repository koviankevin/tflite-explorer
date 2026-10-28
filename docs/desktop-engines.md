# 桌面瀏覽器相容性

既有正式關卡使用 Hosted Linux Chromium。`Desktop engine compatibility` 另以 lockfile 固定的 Playwright Firefox／WebKit，唯讀驗收已發布的完整 site ID 與 build ID。兩個引擎目前仍未通過整輪驗收；後述成功步驟不代替最終失敗結果。這是桌面引擎驗收，不代表 Windows Firefox、macOS Safari、公司實模、超過 1 GiB 或數小時負載已通過。畫面範圍為 14 吋筆電的 1366×640／1280×640，字級包含 32px，不測手機。

工作流程只有手動入口、`contents: read` 權限，僅允許此 repository 的 main／Hosted Linux runner。先逐檔核對正式站 SHA／MIME 及 root，再啟動獨立瀏覽器；結束時再次核對正式 site／core 身分，並保存 driver Git tree、實際引擎版本、原始操作報告及截圖。模型只有原始公開合成 fixtures，所有非 GET 或站外請求都拒絕。沒有部署、重跑正式發布或操作個人瀏覽器。

選檔、下載、點擊、拖曳及鍵盤透過瀏覽器 protocol 操作，觀察器透過 [contentScript selector](https://playwright.dev/docs/api/class-selectors#selectors-register) 的隔離環境唯讀查看共同 DOM；JSON 結果使用未插入文件的 output 傳回，不改動網站 DOM、不呼叫 app 內部 API，也不解除 Netron 對 window.eval 的停用。沿用既有 TFLite 接線／自動 tensor／Undo／Redo、草稿保存與同大小錯誤原檔拒絕、IF／WHILE／custom OP 編輯匯出，以及 MLIR 分支／匯合／迴圈 Canvas 鍵盤驗收；重新解析實際下載的檔案並比對權重、custom options、SSA／dominance 及 pattern。每個模型 Worker 必須收到 close。

首次新增 workflow 的程式與來源檢查完成後，仍須實際 dispatch 並查看兩個引擎的原始結果；不能把工作流程存在、Node 測試成功或 Chromium 綠燈寫成 Firefox／WebKit 通過。實際驗收紀錄會在本頁補入，失敗亦保留。

實作使用 [Playwright 的固定瀏覽器安裝](https://playwright.dev/docs/browsers)、[file chooser](https://playwright.dev/docs/api/class-filechooser) 與 [download](https://playwright.dev/docs/api/class-download) 介面；Linux WebKit 驗收與實體 Safari 分開記錄。

第一輪 [40649465652](https://github.com/koviankevin/tflite-explorer/actions/runs/40649465652) 的兩個引擎已安裝，逐檔正式站驗證完成，之後在初始 DOM 觀察即遇到 Netron 停用 window.eval。這是觀察器衝突，尚未進入模型操作；[Firefox](results/desktop-firefox-observer-failure-2026-10-28.json)／[WebKit](results/desktop-webkit-observer-failure-2026-10-28.json) 及 [provider digest／CRC／來源核對](results/desktop-observer-failure-review-2026-10-28.json)保留失敗。改用隔離 selector 不改寫正式站，不以此推斷應用功能成功或失敗。

第二輪 [40650250150](https://github.com/koviankevin/tflite-explorer/actions/runs/40650250150) 的 [Firefox](results/desktop-firefox-chooser-failure-2026-10-28.json)已通過 demo／32px／搜尋定位，第一個原生選檔事件逾時；持續訂閱將提前到導覽前。WebKit [原始失敗](results/desktop-webkit-handler-failure-2026-10-28.json)停在 handler 型別等待：隔離環境不保證能查看網站 JavaScript 的 onclick／onchange。啟動等待改為實際的 disabled DOM 狀態，後續仍要完成原生操作，沒有以另一個成功旗標代替流程。[兩個 job 的獨立核對](results/desktop-second-review-2026-10-28.json)保留失敗；仍不宣稱相容性驗收完成。

第三輪 [40651280887](https://github.com/koviankevin/tflite-explorer/actions/runs/40651280887) 的 [Firefox](results/desktop-firefox-native-failure-2026-10-28.json)及 [WebKit](results/desktop-webkit-native-failure-2026-10-28.json)皆通過 demo／32px／搜尋定位，選檔仍逾時；[provider 核對](results/desktop-native-failure-review-2026-10-28.json)保留失敗。此結果否定提前訂閱即可解決的推測。

實際原因位於鎖定的 Playwright 1.56.1：Firefox／WebKit 將 chooser element 交給主環境，callback 的 `handle.evaluate(element => !!element.multiple)` 遇到 Netron 停用 eval 後靜默 return，未送出 chooser event；Chromium 已使用 utility world。Node 回歸測試在真正的 pinned callback 重現遺失事件，再採用原 native handle 的 `_adoptTo(utilityContext)` 後核對事件及 multiple 值。只在這個測試程序使用 adapter，並要求版本及原 callback SHA-256 完全相符，升級依賴時拒絕沿用。不修改 lockfile、app／Netron、CSP 或 window.eval；這不是網站的產品功能修正。真實引擎仍須先通過獨立空白頁「一般／停用 eval」兩種原生選檔對照，再跑正式站的完整所列流程。暫時 click 偵錯監聽已移除。

第四輪 [40652472716](https://github.com/koviankevin/tflite-explorer/actions/runs/40652472716) 的兩個引擎均通過一般／停用 eval 的 native chooser 對照，以及正式站的本機選檔、pattern JSON、TFLite 子模型重開、接線、自動 tensor、Undo／Redo、手動草稿、同大小錯誤原檔拒絕、IF／WHILE／custom 匯出與權重／options 比對。Firefox 142.0.1 [八項完成後失敗](results/desktop-firefox-keyboard-failure-2026-10-28.json)在 MLIR 純鍵盤導覽，焦點最後位於 sidebar-closebutton，尚不能判定完整鍵盤可用；原生 Tab 測試接著會依文件順序選擇前進或後退，避免假設所有引擎會從瀏覽器 chrome 自動繞回頁面。

WebKit 26.0 [十三項流程完成](results/desktop-webkit-checkout-failure-2026-10-28.json)，包含 undefined SSA 的 modal／零下載、1,608／1,605 OP Canvas 的分支匯合／迴圈跨 block 鍵盤選取、32px、pattern、局部 MLIR SSA／dominance／舊 pattern 各一筆及網站重開；但最終因測試把 worker 紀錄的字串誤當方法而失敗，另有兩筆 edit-recovery-worker access-control 與兩筆 ResizeObserver 通知錯誤。Worker 統計將修正，同時補上錯誤發生階段、stack、request failure 及當時 Worker 狀態，不忽略或改寫這四筆錯誤。[來源／provider／原始報告核對](results/desktop-fourth-review-2026-10-28.json)保留 failed。preview.17 的正式程式與固定 Release 未改動，也未宣稱相容性合格。
