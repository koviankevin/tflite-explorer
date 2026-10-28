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
