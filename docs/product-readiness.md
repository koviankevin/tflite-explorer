# 商品等級工作與完成條件

目標是公開核心可持續升級、公司內網可保留私有擴充，並讓工程師能可靠地日常使用。完成條件不以單一合成模型、一次綠燈或功能數量代替。

| 工作 | 必須具備的證據 | 現況 |
| --- | --- | --- |
| 公開核心與內網擴充可獨立升級 | 不修改核心即可建立帶 dialect 的內網包；公開發布拒絕內網產物；版本及檔案完整性可核對 | 通用建置／封裝與合成 adapter 驗收通過；公司內網仍須自行驗收 |
| 真實模型相容性 | 公司環境的 TFLite／MLIR／custom runtime 正負例、支援版本與限制清單 | 合成測試已有；公司實模尚待內網驗收 |
| 匯出可信度 | 可下載的來源對照、輸出介面、權重與檢查範圍報告；公司 compiler／runtime 驗證接點 | 本機報告、串流 bytes 比對及可指定 native compiler 的 CLI 已實作；公司 compiler／runtime 正負例仍待內網驗收 |
| 效能標準 | 固定硬體／引擎、不同檔案與 OP 規模、瀏覽器及 Worker 記憶體、反覆操作與可取消性 | Node 九筆核心效能 CI 已通過；另加入實體寫滿 1.25 GiB／21,005 OP TFLite 的八輪原生選檔、下載、重開及關閉 CI，含完整權重/custom options、pattern 正反例、整個 Chromium 程序樹 RSS、Worker V8/backing storage、實際 Worker 終止與自然 Blob URL 撤銷；已通過並保存原始報告。數小時長時間負載、其他瀏覽器的 1 GiB 程序記憶體及固定實體硬體 SLA 仍需補齊；受控發布已強制核對此驗收與來源相依 scope |
| 保存及復原 | 草稿自動保存、Undo／Redo、跨分頁衝突、崩潰後恢復與格式遷移 | 已加入 IndexedDB 工作草稿、有限歷史、revision 衝突／分叉與 v1／v2 讀取；已驗證重載及兩分頁恢復。Pattern library 已加入交易合併、同名衝突副本與舊 key 保留，實際雙分頁與跨 block 保存／匯出重開通過；preview.16 已有 TFLite 編輯本機自動保存、嚴格交易／revision 衝突與副本、專屬瀏覽器程序強制終止後的恢復；OS 斷電／儲存回收與公司環境仍需補齊驗收 |
| 操作與診斷 | 新使用者完整操作流程、原文定位、鍵盤及焦點驗收、可預覽且不含模型的診斷報告 | 白名單本機診斷預覽／下載、有限操作紀錄及版本缺失已實作；敏感字串排除、Escape 保留跨 block 選取與手機版面已驗收。Preview.9 另完成 TFLite 原生鍵盤開檔／定位、16→32px 焦點、手動 tabs、五種 modal 邊界／關閉後焦點、繼續選取並保存／搜尋／JSON 及子模型下載重開，正式站八項操作均通過。preview.18 正式版本已通過 MLIR validation modal、分支／匯合／迴圈 Canvas 的跨 block 鍵盤選取、pattern 及 MLIR 匯出重開，見 [MLIR／Canvas 歷史範圍](mlir-keyboard.md)及 [preview.18 桌面功能驗收](desktop-fixes.md)；已完成固定交付與正式站核對。完整新手流程、其他鍵盤／螢幕閱讀器與公司環境仍待補，歷史見 [鍵盤驗收](keyboard-acceptance.md) |
| 發布及回退 | 固定版本部署包、建置來源／清單、公開與內網區分、受影響功能關卡、回退演練 | 受控 Pages 已強制核對四項 main CI、artifact digest、受測依賴 scope、原始量測與乾淨候選重建；main-only environment／必要 PR 檢查及錯誤整站 ID 拒絕已驗收。前次 preview.8／preview.7 實際回退再恢復、同一 browser context 保存／lazy imports／匯出重開通過，見 [正式切換驗收](production-transition-verification.md)。現行 preview.18 已發布，1,318 檔 SHA／MIME、29 項正式原生操作、八份 TFLite 編輯匯出收據與四份固定 Release 實際 bytes、部署權威及 root 均核對；模型分頁、刪除／復原、獨立圖形編輯與 32px 筆電版面見 [preview.18 驗收](desktop-fixes.md)。任意資料格式升降級及公司內網實際切換仍需驗收 |

目前 TFLite 編輯草稿可下載 JSON，換電腦重新選取原模型、核對完整檔案指紋後續改；探索用 IndexedDB 草稿／工作階段 JSON 仍不包含模型編輯命令。Preview.15 另以網站內分頁保留原模型和小模型的搜尋、選取、視角及編輯 Undo／Redo，只有當前模型啟用 Worker；關站前仍須下載備份，preview.16 的本機編輯自動保存及強制終止測試瀏覽器後的恢復已通過，OS 斷電／儲存回收仍未驗收。

公開開發使用公開／合成樣本。公司模型、私有 dialect 與 compiler 留在內網；內網驗收尚未完成時不得將其標為已支援或將整個商品等級目標標為完成。

長時間負載另加入 [兩小時實體模型 CI](lifecycle-soak.md)：同一瀏覽器至少兩小時／64 輪，沿用所有八輪門檻，額外拒絕長期 RSS 成長、取樣缺口和空等湊時。新判定器正負例與真實瀏覽器結果分開記錄；尚未取得成功的實際 run，不把此項標為完成。

版本隔離、可信 site ID、歷史保留／中斷恢復、固定 Release 提升與部署權威核對已在 main。現行固定交付為 preview.18／build `88b1b6ae59c5fd17`，來源 `cb0b9c179938d10b827a4bb1e679aae82c5b4754`。76 項 main 契約、六種隔離切換、29 項正式 Chromium 操作與 1.25 GiB／21,005 OP 八輪改模、整份輸出及子模型生命週期通過；四關卡 fingerprint／原始報告在 prepare 重新核對。正式站 1,318 檔、四份 Release 實際下載及最新部署權威核對通過，Firefox／WebKit 各十三項所列功能也通過，見 [最新交付與限制](desktop-fixes.md)。既有失敗、前版發布與回退紀錄保留，不以後續成功改寫。

上表公司實模／compiler／runtime、長時間效能、其他引擎的 1 GiB／程序記憶體、固定實體硬體 SLA、OS 斷電／儲存回收、格式遷移及其餘鍵盤／新手流程仍未完成，整體商品等級目標維持進行中。

其他桌面引擎已通過 Hosted Linux Firefox 142.0.1／WebKit 26.0 的正式站各十三項唯讀功能驗收，包含 TFLite 接線、草稿、IF／WHILE／custom 匯出及 MLIR SSA／Canvas／pattern，見 [preview.18 正式交付](desktop-fixes.md)。先前 recovery Worker／ResizeObserver 應用錯誤已修正，Firefox 原生鍵盤 driver 差異也已核對。這不代替其他引擎 1 GiB／程序記憶體、數小時量測或公司環境；全部早期失敗在 [桌面診斷](desktop-engines.md)保留。

Preview.16 的完整大型原模型自動指紋（八輪各最多 1 MiB／次）及瀏覽器程序強制終止後恢復已通過，見 [完整恢復交付](edit-recovery.md)。後續已補上 1.25 GiB 手動 JSON 下載／原生重選恢復、取消、32px 視角及 Redo、實際整份匯出重開與權重／custom options／pattern 驗收，見 [大型手動草稿驗收](large-edit-draft.md)。這不代替公司實模、其他引擎、OS 斷電、固定實體硬體 SLA 或數小時負載。
