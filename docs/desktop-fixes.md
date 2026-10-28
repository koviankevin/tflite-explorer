# 桌面引擎修正（preview.18 候選）

此頁為尚未發布的候選工作；實際正式站仍依版本對話框與固定 Release。14 吋範圍為 1366×640／1280×640、32px，不測手機，不操作個人瀏覽器。

未修正的 [candidate run 40655312920](https://github.com/koviankevin/tflite-explorer/actions/runs/40655312920)來自 `c26aee02cd9e2bb6e6b2a12790fbc8b9e30152ba`，public build `75a25d1e0c7f4095`，核心 273 檔及實際 HTTP root／SHA／MIME 已核對。[Firefox 原始失敗](results/desktop-candidate-original-firefox-2026-10-28.json)重現 native select 等待；[WebKit 原始失敗](results/desktop-candidate-original-webkit-2026-10-28.json)完整執行十三項操作後仍有兩筆 recovery Worker access-control 及兩筆 ResizeObserver 錯誤。[provider digest／CRC／job／來源核對](results/desktop-candidate-original-review-2026-10-28.json)保留 failure，證明可在發布前重現，並非只存在於 CDN。

## 生命週期

原 pagehide handler 呼叫 recovery session.flush，會同步擷取草稿並建立首次完整原模型核對 Worker；此時 document 可能已失去有效 browsing context。新的 pagehide handler 暫停準備與計時器，再取消尚未完成的指紋 Worker，不在失效頁面另啟 Worker。pageshow 恢復同一份未保存的 session；一般切換到背景分頁仍執行 visibilitychange flush。

沒有把未完成的準備標成已保存。瀏覽器永久關閉時，尚未成功交易的新修改仍可能遺失；重要工作應等本機保存完成或下載 JSON。此變更不宣稱 OS 斷電／儲存回收合格。既有 CAS、跨分頁衝突、手動 JSON、Undo／Redo 及權重不入 IndexedDB 的規則保留。

回歸測試使用真正的 recovery session 與 fingerprint controller，在生命週期接點模擬失效 document 的 Worker 建立拒絕。原 handler 的兩項測試先失敗：pagehide 新建 Worker、既有核對未取消；修正後驗證未虛報保存、頁面快取恢復、背景保存與晚到 visibilitychange，連同既有保存／衝突／指紋測試通過。

## 版面更新

header、capture toolbar 與編輯區 header 的 ResizeObserver 不再於通知回呼內寫入受布局影響的樣式。每個觀察者至多排一個動畫 frame，於 frame 讀取最新尺寸後更新；dispose 會取消未執行 frame，晚到通知不再接觸已釋放檢視。舊同步回呼的兩項回歸測試先失敗，修正後通過。真實 WebKit 是否不再發生 undelivered-notifications，仍須由相同模型流程驗證，不能只靠單元測試宣稱。

Firefox 的原生 select 驗收改用關閉選單狀態的 Home／ArrowDown，由 Gecko 原生事件提交；Chromium／WebKit 保留已驗證的 popup Home／ArrowDown／Enter。這是測試操作差異，沒有改成自製選單、直接設定 select 值或 app API。驗收保留每次 requested／actual value。

本機選測 14 項 recovery／fingerprint／生命週期／frame 案例通過；四項執行限制與 HTTP 身分正負例也通過。候選真實引擎、主分支必要關卡、固定封裝及正式站驗證仍待執行，尚未宣稱部署或商品等級完成。


## 候選與主分支驗收

修正後 WebKit [40656481041 的成功 job](https://github.com/koviankevin/tflite-explorer/actions/runs/40656481041/job/122708634276)通過十三項流程，原四筆錯誤降為零；原始 [報告](results/preview18-candidate-webkit-2026-10-28.json)與 [獨立核對](results/preview18-candidate-webkit-review-2026-10-28.json)保留 job 成功及整個 run 因當時 Firefox 尚未完成而 failure 的差別。Firefox 後續只補測 [40657306719](https://github.com/koviankevin/tflite-explorer/actions/runs/40657306719)，[十三項／21 模型 Worker close](results/preview18-candidate-firefox-2026-10-28.json)與 [provider 核對](results/preview18-candidate-firefox-review-2026-10-28.json)通過，沒有 pageerror。原 [匯出重開後的測試導覽失敗](results/preview18-firefox-reopen-failure-2026-10-28.json)及 [核對](results/preview18-firefox-reopen-review-2026-10-28.json)保留；每步選 Tab／Shift Tab 的改動只作用於 Firefox。

兩個候選的 275 檔 HTTP／root 已核對。[原始應用／建置／依賴相同的對照](results/preview18-desktop-source-comparison-2026-10-28.json)支援沿用 WebKit 結果；不同的 metadata／build IDs 未冒充相同產物。兩者均選取分支匯合七個 OP／四個 blocks、迴圈四個 OP／三個 blocks，16→32px、平移／縮放後保存 CFG pattern，下載局部 MLIR、Node SSA／dominance 檢查及原生重開，舊／新 patterns 各一筆。native modal 的 undefined SSA 在下載前阻擋，焦點返回、原選取及零下載均確認。21 個 model Worker 均收到 close，Netron layout worker 未收到的最後 close 事件維持原始 false；不由此推論其他引擎程序記憶體。[WebKit 1280×640／32px](results/preview18-candidate-webkit-2026-10-28.png)與 [Firefox 相同尺寸](results/preview18-candidate-firefox-2026-10-28.png)已視覺檢查。

主分支來源 `950d83f59290e3f89685763d63e00bb63fd8b39c`／tree `c0f5bb9e79ebba2997213f8297b7249af9f3f790` 的 [四關卡來源與 provider 核對](results/preview18-main-gates-2026-10-28.json)全部通過：core 40503475445 的 86 份相依 fingerprint 未變，沿用 [九筆量測](results/preview18-main-core-2026-10-28.json)；contract [40657631071](https://github.com/koviankevin/tflite-explorer/actions/runs/40657631071) 的 [76 項](results/preview18-main-contract-2026-10-28.json)無略過／取消；site [40657635679](https://github.com/koviankevin/tflite-explorer/actions/runs/40657635679)完成 [六種切換](results/preview18-main-site-2026-10-28.json)與 [29 項原生操作](results/preview18-main-ui-2026-10-28.json)，另有 [原始 artifact 核對](results/preview18-main-ui-review-2026-10-28.json)。32 個主模型 Worker、模型分頁的六個 Worker、兩個強制關閉／正常關閉的 owned process trees，以及八份編輯匯出收據皆通過；SIGKILL 的缺失事件仍用原 false 加實際 OS 終止證據，未偽改。

實體 [八輪 40657311396](https://github.com/koviankevin/tflite-explorer/actions/runs/40657311396) 的 [完整量測](results/preview18-main-browser-2026-10-28.json)與 [額外完整指紋／provider 核對](results/preview18-main-browser-review-2026-10-28.json)通過。原模型 1,349,965,216 bytes／21,005 OP；每次完整編輯輸出 1,350,445,736 bytes／21,006 OP，七段共 1,342,177,328 bytes 權重／custom options 串流比對、八次完整原檔指紋、pattern 正反例及重開均通過。扣除兩輪暖機的六輪，RSS drift 7,118,848 bytes、斜率 1047639.77 bytes／輪、main heap drift 126,892 bytes、取樣峰值 999,694,336 bytes，符合原 policy；24 個模型 Worker 與八個指紋 Worker 全終止，保留自然 60 秒 Blob URL 撤銷、未強制 GC。這是有限的 Chromium／hosted 環境證據，不代表其他引擎 1 GiB、公司模型、OS 斷電、固定硬體 SLA 或數小時不洩漏。

上述為準備發布所需證據；固定包、正式部署、正式站 Firefox／WebKit 仍待核對。公司模型／compiler／runtime 與完整商品等級目標保持未完成。
