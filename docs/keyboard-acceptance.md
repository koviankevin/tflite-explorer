# 鍵盤操作與焦點驗收

候選 preview.9 補上搜尋分頁的鍵盤操作。Tab 進入目前啟用的分頁，左右方向鍵循環移動，Home／End 到第一／最後分頁；Enter 或 Space 才切換並搜尋。移焦點不啟動另一個搜尋，以免大型模型或跨 block pattern 的計算拖慢導覽。搜尋控制區以 tabpanel 與當前分頁互相標示；未啟用的 tabs 不各占一個 Tab 停留點。本文的候選驗收尚未表示正式站已更新。

對話框的 keydown／keyup 停在框內，不再傳給後方圖形的快捷鍵。Tab／Shift Tab 到達最後／第一個可操作控制項時，在框內循環；清單在每次 Tab 當下重新判斷，排除 disabled、inert、隱藏及收合內容，其餘保留原生按鈕、選單和 Escape 行為。原生關閉後回到開啟它的按鈕。Netron 圖形 register 僅在焦點原本屬於圖面或 body 時聚焦圖形；關閉 sidebar 也只在 sidebar／圖形原本持有焦點時返回圖形，避免重畫搶走搜尋欄、字級選單和對話框中的焦點。

`production-smoke.yml` 的 `scenario=keyboard` 可唯讀驗收正式站。兩個已發布的固定 preview.7／preview.8 build 保留原四項回退驗收；所有其他新 build 的 site／正式部署 smoke 都必須加跑鍵盤流程，不能因新版本尚未支援就略過。只在 hosted Linux CI、固定公開 repository／workflow 執行；顯式舊版 audit 另要求 main，模型只用公開範例，不操作個人瀏覽器。

腳本以真實 Tab、方向鍵、Enter、Space、Escape、Ctrl F／O，以及原生 file chooser／download 操作，CDP 只讀 DOM。涵蓋原生開檔、搜尋定位、16→32px 字級及重畫後焦點、手動啟用 tabs、modal 焦點／選取、鍵盤加入 layers／儲存並搜尋、pattern JSON 匯入匯出，以及 TFLite 子模型下載／重開和 Worker 終止。原生下拉選單在 Enter 確認後核對實際 value；選檔訂閱在導覽前啟用，避免把觀察器的非同步訂閱誤當作網站故障。

前置正式站 audit `40477509713` 等不到選檔事件，但後續 `40478529038` 的 Enter 未用任何替代鍵即成功，因此沒有宣稱網站 Enter 故障。修正原生 select 的提交方式後，[40479230063](https://github.com/koviankevin/tflite-explorer/actions/runs/40479230063) 仍無法連續完成 16→32px；Netron `Target.register()` 的無條件聚焦是修正目標。舊版尚未跑到 arrow tabs／modal 場景，不以這些前置失敗冒充其動態負例。候選實際瀏覽器、效能與正式部署驗收仍待完成；本文件不是全站無障礙或其他瀏覽器合格聲明。

[候選第一輪 40480861736](https://github.com/koviankevin/tflite-explorer/actions/runs/40480861736) 已通過六項隔離版本切換及原四項原生操作，也通過鍵盤開檔、Ctrl F、定位、16→32px 焦點與手動 tabs；之後在 modal Tab 邊界失敗，整個 site 關卡仍為 failed，見 [原始紀錄](results/keyboard-modal-boundary-failure-2026-10-27.json)。原版連續改字級失敗亦保留 [原始報告](results/keyboard-original-font-failure-2026-10-27.json)，不改寫為成功。

`dialog-keyboard.js` 補上即時焦點循環後，[main 40482153614](https://github.com/koviankevin/tflite-explorer/actions/runs/40482153614) 已完成 [六種切換](results/keyboard-main-site-2026-10-27.json) 與 [742 檔 HTTP／八項原生 UI](results/keyboard-main-ui-2026-10-27.json)。來源 `b2f6ac1b4ae6a45506ccb05048b18bc74527b0ac`，1366×768、Chromium 141.0.7390.37，實際按下 574 次 Tab；匯入、本機草稿、版本、診斷與最近匯出報告共五種 modal 驗證正反邊界、關閉後焦點、隱藏／disabled 控制項及匯入確認動態啟用。原選取 OP 保留，鍵盤加入另兩個 OP、儲存／搜尋四筆並匯出三節點兩連線的 pattern；原生 JSON 與三 OP TFLite 子模型下載重開後仍匹配一次。五個 model workers 均關閉。MLIR validation modal、MLIR／Canvas 的完整鍵盤流程及其他引擎仍未在這輪涵蓋。

[main 契約 40482149049](https://github.com/koviankevin/tflite-explorer/actions/runs/40482149049) 的 [74 項測試](results/keyboard-main-contract-2026-10-27.json) 通過、無略過／取消，受測來源未變。[85 個核心依賴指紋](results/keyboard-core-scope-2026-10-27.json) 與既有 main core `40438427440` 完全相同，正式 prepare 仍須重驗原始憑證。最終來源的 [1.25 GiB／21,005 OP 八輪瀏覽器關卡 40482578652](https://github.com/koviankevin/tflite-explorer/actions/runs/40482578652) 正在執行；只有完成來源／artifact／原始量測核對後才可選入交付索引。此前較早來源的成功大檔測試不冒充本次最終模組的驗收。

操作設計參考 [W3C APG tabs pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/) 的手動啟用與 [modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) 的焦點循環建議。
