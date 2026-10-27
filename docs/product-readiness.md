# 商品等級工作與完成條件

目標是公開核心可持續升級、公司內網可保留私有擴充，並讓工程師能可靠地日常使用。完成條件不以單一合成模型、一次綠燈或功能數量代替。

| 工作 | 必須具備的證據 | 現況 |
| --- | --- | --- |
| 公開核心與內網擴充可獨立升級 | 不修改核心即可建立帶 dialect 的內網包；公開發布拒絕內網產物；版本及檔案完整性可核對 | 通用建置／封裝與合成 adapter 驗收通過；公司內網仍須自行驗收 |
| 真實模型相容性 | 公司環境的 TFLite／MLIR／custom runtime 正負例、支援版本與限制清單 | 合成測試已有；公司實模尚待內網驗收 |
| 匯出可信度 | 可下載的來源對照、輸出介面、權重與檢查範圍報告；公司 compiler／runtime 驗證接點 | 本機報告、串流 bytes 比對及可指定 native compiler 的 CLI 已實作；公司 compiler／runtime 正負例仍待內網驗收 |
| 效能標準 | 固定硬體／引擎、不同檔案與 OP 規模、瀏覽器及 Worker 記憶體、反覆操作與可取消性 | Node 九筆核心效能 CI 已通過；另加入實體寫滿 1.25 GiB／21,005 OP TFLite 的八輪原生選檔、下載、重開及關閉 CI，含完整權重/custom options、pattern 正反例、整個 Chromium 程序樹 RSS、Worker V8/backing storage、實際 Worker 終止與自然 Blob URL 撤銷；已通過並保存原始報告。數小時長時間負載、其他瀏覽器及固定實體硬體 SLA 仍需補齊；受控發布已強制核對此驗收與來源相依 scope |
| 保存及復原 | 草稿自動保存、Undo／Redo、跨分頁衝突、崩潰後恢復與格式遷移 | 已加入 IndexedDB 工作草稿、有限歷史、revision 衝突／分叉與 v1／v2 讀取；已驗證重載及兩分頁恢復。Pattern library 已加入交易合併、同名衝突副本與舊 key 保留，實際雙分頁與跨 block 保存／匯出重開通過；硬崩潰／儲存回收與公司環境仍需補齊驗收 |
| 操作與診斷 | 新使用者完整操作流程、原文定位、鍵盤及焦點驗收、可預覽且不含模型的診斷報告 | 白名單本機診斷預覽／下載、有限操作紀錄及版本缺失已實作；敏感字串排除、Escape 保留跨 block 選取與手機版面已驗收。Preview.9 另完成 TFLite 原生鍵盤開檔／定位、16→32px 焦點、手動 tabs、五種 modal 邊界／關閉後焦點、繼續選取並保存／搜尋／JSON 及子模型下載重開，正式站八項操作均通過。MLIR validation modal、MLIR／Canvas 完整鍵盤流程、完整新手流程與公司環境仍待補；見 [鍵盤驗收](keyboard-acceptance.md) |
| 發布及回退 | 固定版本部署包、建置來源／清單、公開與內網區分、受影響功能關卡、回退演練 | 受控 Pages 已強制核對四項 main CI、artifact digest、受測依賴 scope、原始量測與乾淨候選重建；main-only environment／必要 PR 檢查及錯誤整站 ID 拒絕已驗收。前次 preview.8／preview.7 實際回退再恢復、同一 browser context 保存／lazy imports／匯出重開通過，見 [正式切換驗收](production-transition-verification.md)。現行 preview.9 首次 attempt 發布成功，989 檔 SHA／MIME、八項原生 UI／鍵盤、四份固定 Release 實際 bytes、部署權威與 root 均核對；保留前兩版 namespace。任意資料格式升降級及公司內網實際切換仍需驗收 |

公開開發使用公開／合成樣本。公司模型、私有 dialect 與 compiler 留在內網；內網驗收尚未完成時不得將其標為已支援或將整個商品等級目標標為完成。

版本隔離、可信 site ID、歷史保留／中斷恢復、固定 Release 提升與部署權威核對已在 main。現行固定交付為 preview.9／build `35c75cab9fab0def`，來源 `8025bc6ac03b18298c86c387a834b74b757ec6bc`。74 項 main 契約、六種隔離切換、八項原生 UI／鍵盤與最終來源的 1.25 GiB／21,005 OP 八輪生命週期均通過；四關卡 fingerprint／原始報告在 prepare 重新核對。正式站 989 檔、原生操作及實際 Release 下載也通過，見 [最新交付與限制](keyboard-acceptance.md)。舊版失敗與前次回退紀錄仍保留，不以後續成功改寫，見 [前次切換驗收](production-transition-verification.md)。

上表公司實模／compiler／runtime、長時間效能、其他引擎、固定實體硬體 SLA、硬崩潰／儲存回收、格式遷移及其餘鍵盤／新手流程仍未完成，整體商品等級目標維持進行中。
