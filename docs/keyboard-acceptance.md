# 鍵盤操作與焦點驗收

自 `0.2.0-preview.9` 起，搜尋分頁支援鍵盤操作。Tab 進入目前啟用的分頁，左右方向鍵循環移動，Home／End 到第一／最後分頁；Enter 或 Space 才切換並搜尋。移焦點不啟動另一個搜尋，以免大型模型或跨 block pattern 的計算拖慢導覽。搜尋控制區以 tabpanel 與當前分頁互相標示；未啟用的 tabs 不各占一個 Tab 停留點。本頁保留 preview.9 的鍵盤驗收原始證據；最新正式站為 preview.10，新增 pattern／模型編輯操作及正式交付見 [最新驗收](model-editing-delivery.md)。

對話框的 keydown／keyup 停在框內，不再傳給後方圖形的快捷鍵。Tab／Shift Tab 到達最後／第一個可操作控制項時，在框內循環；清單在每次 Tab 當下重新判斷，排除 disabled、inert、隱藏及收合內容，其餘保留原生按鈕、選單和 Escape 行為。原生關閉後回到開啟它的按鈕。Netron 圖形 register 僅在焦點原本屬於圖面或 body 時聚焦圖形；關閉 sidebar 也只在 sidebar／圖形原本持有焦點時返回圖形，避免重畫搶走搜尋欄、字級選單和對話框中的焦點。

`production-smoke.yml` 的 `scenario=keyboard` 可唯讀驗收正式站。兩個已發布的固定 preview.7／preview.8 build 保留原四項回退驗收；所有其他新 build 的 site／正式部署 smoke 都必須加跑鍵盤流程，不能因新版本尚未支援就略過。只在 hosted Linux CI、固定公開 repository／workflow 執行；顯式舊版 audit 另要求 main，模型只用公開範例，不操作個人瀏覽器。

腳本以真實 Tab、方向鍵、Enter、Space、Escape、Ctrl F／O，以及原生 file chooser／download 操作，CDP 只讀 DOM。涵蓋原生開檔、搜尋定位、16→32px 字級及重畫後焦點、手動啟用 tabs、modal 焦點／選取、鍵盤加入 layers／儲存並搜尋、pattern JSON 匯入匯出，以及 TFLite 子模型下載／重開和 Worker 終止。原生下拉選單在 Enter 確認後核對實際 value；選檔訂閱在導覽前啟用，避免把觀察器的非同步訂閱誤當作網站故障。

前置正式站 audit `40477509713` 等不到選檔事件，但後續 `40478529038` 的 Enter 未用任何替代鍵即成功，因此沒有宣稱網站 Enter 故障。修正原生 select 的提交方式後，[40479230063](https://github.com/koviankevin/tflite-explorer/actions/runs/40479230063) 仍無法連續完成 16→32px；Netron `Target.register()` 與 sidebar closure 的無條件聚焦是修正目標。舊版尚未跑到 arrow tabs／modal 場景，不以這些前置失敗冒充其動態負例。本文件不是全站無障礙或其他瀏覽器合格聲明。

[候選第一輪 40480861736](https://github.com/koviankevin/tflite-explorer/actions/runs/40480861736) 已通過六項隔離版本切換及原四項原生操作，也通過鍵盤開檔、Ctrl F、定位、16→32px 焦點與手動 tabs；之後在 modal Tab 邊界失敗，整個 site 關卡仍為 failed，見 [原始紀錄](results/keyboard-modal-boundary-failure-2026-10-27.json)。原版連續改字級失敗亦保留 [原始報告](results/keyboard-original-font-failure-2026-10-27.json)，不改寫為成功。

`dialog-keyboard.js` 補上即時焦點循環後，[main 40482153614](https://github.com/koviankevin/tflite-explorer/actions/runs/40482153614) 已完成 [六種切換](results/keyboard-main-site-2026-10-27.json) 與 [742 檔 HTTP／八項原生 UI](results/keyboard-main-ui-2026-10-27.json)。來源 `b2f6ac1b4ae6a45506ccb05048b18bc74527b0ac`，1366×768、Chromium 141.0.7390.37，實際按下 574 次 Tab；匯入、本機草稿、版本、診斷與最近匯出報告共五種 modal 驗證正反邊界、關閉後焦點、隱藏／disabled 控制項及匯入確認動態啟用。原選取 OP 保留，鍵盤加入另兩個 OP、儲存／搜尋四筆並匯出三節點兩連線的 pattern；原生 JSON 與三 OP TFLite 子模型下載重開後仍匹配一次。五個 model workers 均關閉。MLIR validation modal、MLIR／Canvas 的完整鍵盤流程及其他引擎仍未在這輪涵蓋。

[main 契約 40482149049](https://github.com/koviankevin/tflite-explorer/actions/runs/40482149049) 的 [74 項測試](results/keyboard-main-contract-2026-10-27.json) 通過、無略過／取消，受測來源未變。[85 個核心依賴指紋](results/keyboard-core-scope-2026-10-27.json) 與既有 main core `40438427440` 完全相同。

最終來源的 [1.25 GiB／21,005 OP 八輪瀏覽器關卡 40482578652](https://github.com/koviankevin/tflite-explorer/actions/runs/40482578652) 已成功，見 [完整原始量測](results/keyboard-final-browser-2026-10-27.json)。重新執行原始 policy 為 passed；扣除兩輪 warmup，六輪 sampled whole-browser peak RSS 約 732.8 MiB，closed RSS drift 約 15.1 MiB、slope 約 0.71 MiB／輪，均在原門檻內；main heap drift 約 42 KiB。這是此環境八輪的有限證據，不代表永不洩漏、連續峰值或固定硬體 SLA。實際 Worker 終止、Blob URL 自然撤銷、完整權重／custom options 和 pattern 正反例也通過，未強制 GC。

[四關卡來源比較](results/preview9-selected-scopes-2026-10-27.json) 已核對成功 main run 與全部相依 fingerprint；交付索引選入新的 browser／contract／site，沿用內容相同的 core。正式 prepare 仍須重新驗證 API、provider artifact digest／原始報告及乾淨來源重建，這份索引／文件本身不等於已發布。此前較早來源的成功大檔測試不冒充本次最終模組的驗收。

操作設計參考 [W3C APG tabs pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/) 的手動啟用與 [modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) 的焦點循環建議。

## 正式交付

先完成 [準備 40484492077](https://github.com/koviankevin/tflite-explorer/actions/runs/40484492077)，再獨立下載 provider artifacts，核對 digest／CRC、完整 Pages tar、core ZIP、四份交付資產與來源；[原始審閱](results/preview9-prepared-review-2026-10-27.json) 為 passed。凍結來源 `8025bc6ac03b18298c86c387a834b74b757ec6bc`，core build `35c75cab9fab0def`，以審閱過的完整 site ID 發布。

[正式發布 40485119978](https://github.com/koviankevin/tflite-explorer/actions/runs/40485119978) 首次 attempt 的 prepare／deploy／verify_live／release 全部成功。[989 檔 HTTP 報告](results/preview9-live-http-2026-10-27.json) 與 [八項正式站原生 UI／鍵盤報告](results/preview9-live-keyboard-2026-10-27.json) 全部通過；五個模型 Worker 均關閉。最新 deployment `7355478805`／job `122125165058` 的來源和完整 site ID，另與無 query 的實際 root、live index 核對一致。保留 preview.8 與固定 baseline preview.7 namespaces，原 root lazy-load 檔案繼續使用 preview.7。

[固定 Release](https://github.com/koviankevin/tflite-explorer/releases/tag/v0.2.0-preview.9) 包含 ZIP、checksum、core manifest 與四關卡 receipt。[獨立最終核對](results/preview9-publication-review-2026-10-27.json) 以實際成功 job 時段選取 artifact ID、重驗 provider ZIP digest／CRC／原始報告，再重新下載全部四份 Release assets，與準備時原始 bytes 完全相符；另見 [發布報告](results/preview9-fixed-release-2026-10-27.json)。ZIP 為 29,459,158 bytes，SHA-256 `0f8743e9b2e94e2d4eff9791a261183b2a9fc5bd054df10d7d6df53311f10911`，內含 247 個 core manifest 檔案及 manifest 本身。完整 site ID 為 `972b669f7f6d39fb720932f24811c9afbcdfae13c75f35699aa08c25e6f02e66`，site manifest SHA-256 為 `d3dfdc233251c52807516ba378b9158ce7d13c27d6e43b7d46d4a2da20ae1e12`。

此輪只更新 GitHub，沒有公司模型或私有擴充。內網原樣部署可取固定 ZIP；已有私有 profile／adapter 時，固定 `v0.2.0-preview.9` 來源後重新建置與公司驗收，不能直接覆蓋客製內容。其餘尚未完成項目仍見 [商品等級工作](product-readiness.md)。
