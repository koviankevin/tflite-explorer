# 商品等級工作與完成條件

手動 interpreter 另完成 [Chromium 正式站八輪／24 次 CPU 與 IO 生命週期](runtime-io-lifecycle.md#已核對結果)：4 MiB const、每次 4 MiB input／output、8 份完整 bytes、自然下載 URL 釋放、411 次觀測程序 RSS／main heap 與正常程序退出通過。這是新的有限 CPU／IO 證據，沒有倒算到既有兩小時開檔／編輯負載，也沒有宣稱連續 Worker heap、數小時 interpreter 或其他引擎完成。

現行固定 preview.30 另通過[三引擎真實運算取消／逾時／恢復](runtime-active-compute.md#三引擎實際結果)：不暫停下載、不用 fake timer，實際 WHILE invoke 後觀測 UI 回應、手動取消與網站 30 秒 timer 終止專用 Worker，再開正常模型成功執行。此測試與證據增補沒有修改應用或重新部署，仍不代替數小時 runtime、其他 OS 或 RSS 驗收。

2026-10-29 使用者明確調整本輪範圍：「先保證外網的 OK 就好，內網我會再修改」。本輪以 [公開版使用與驗收清單](public-acceptance.md)為交付範圍；公司模型、dialect、compiler／runtime 與內網部署由使用者自行處理，不再作為外網交付的阻擋條件。本頁保留完整品質規劃及各項證據界線，不將未驗收環境寫成已通過。

最新固定正式版為 preview.30／build `f3ff13b75b83ee57`。[正式交付](usage-guide.md#preview30-正式交付)核對全站 1,400 檔、31 項原生操作、五組站內指南、19 種執行／分佈情境、v3 草稿、四份下載與權威部署。1.25 GiB／21,005 OP 八輪、32px 兩種桌面尺寸、pattern、草稿與匯出重開通過；指南自動流程不代替真人易用性或完整螢幕閱讀器驗收，其餘公開品質與長期／跨引擎缺口仍保留，整體商品等級目標未宣告完成。

歷史 preview.21 應用程式的 [新版兩引擎八輪](desktop-physical.md#preview21-應用的兩引擎八輪結果)另已核對：當時 Linux WebKit 通過原門檻，Firefox 的 RSS 峰值成長失敗，完整功能／bytes／Worker 與程序清理通過。這些早期結果原樣保留；後續 preview.22 修正與新量測見下段，沒有為了通過調整門檻。

preview.22 的 prefix-only 本機 Blob 準備修正，使 Firefox 八輪峰值成長由歷史 3.34 GB 降至 479 MB，原門檻未調整。完整／局部匯出 bytes、權重、options 及搜尋通過；新的逐 PID 啟動識別量測是後續 CI 補強，不倒算到歷史報告，見 [三引擎驗證](desktop-physical.md#preview22-候選的三引擎八輪與發布關卡)。

Pages 與固定 Release 已完成本輪正式核對；第一次啟動逾時與相同應用後續診斷通過的證據並列保留，見 [公開啟動診斷](desktop-physical.md#相同公開應用的啟動診斷結果)。後續新增程序識別 producer 的 resource preflight helper 已修正，[新的實體八輪](lifecycle-soak.md#逐程序識別八輪結果)已核對：六個觀察到的 PID／start-ticks 身分全部正常退出，無強制清理；原零輪失敗仍保留。另補齊 [現行來源 2.5 GiB MLIR](mlir-large-files.md#現行來源的-hosted-node-大檔驗收2026-10-29)的 Hosted Node 權重／SSA／pattern 驗收。這些補測不更動固定發布檔。

目標是公開核心可持續升級、公司內網可保留私有擴充，並讓工程師能可靠地日常使用。完成條件不以單一合成模型、一次綠燈或功能數量代替。

| 工作 | 必須具備的證據 | 現況 |
| --- | --- | --- |
| 公開核心與內網擴充可獨立升級 | 不修改核心即可建立帶 dialect 的內網包；公開發布拒絕內網產物；版本及檔案完整性可核對 | 通用建置／封裝與合成 adapter 驗收通過；公司內網仍須自行驗收 |
| 真實模型相容性 | 公司環境的 TFLite／MLIR／custom runtime 正負例、支援版本與限制清單 | 合成測試已有；公司實模尚待內網驗收 |
| 匯出可信度 | 可下載的來源對照、輸出介面、權重與檢查範圍報告；公司 compiler／runtime 驗證接點 | 本機報告、串流 bytes 比對及可指定 native compiler 的 CLI 已實作；公司 compiler／runtime 正負例仍待內網驗收 |
| 效能標準 | 固定硬體／引擎、檔案與 OP 規模、瀏覽器及 Worker 記憶體、反覆操作與可取消性 | 核心九筆、Linux 三引擎實體 1.25 GiB／21,005 OP 八輪、現行應用 Chromium 80 輪／約 2 小時 12 分均已核對。另完成逐 PID／start-ticks 八輪與 2.5 GiB MLIR Hosted Node 驗收。長測仍保留原根程序／descendants RSS 與 Worker V8 checkpoints 範圍，不倒算新能力；其他 OS／固定硬體 SLA、其他引擎長時間與手動 runtime 數小時量測未證實 |
| 保存及復原 | 草稿自動保存、Undo／Redo、跨分頁衝突、崩潰後恢復與格式遷移 | 已加入 IndexedDB 工作草稿、有限歷史、revision 衝突／分叉與 v1／v2 讀取；已驗證重載及兩分頁恢復。Pattern library 已加入交易合併、同名衝突副本與舊 key 保留，實際雙分頁與跨 block 保存／匯出重開通過；preview.16 已有 TFLite 編輯本機自動保存、嚴格交易／revision 衝突與副本、專屬瀏覽器程序強制終止後的恢復；OS 斷電／儲存回收與公司環境仍需補齊驗收 |
| 操作與診斷 | 新使用者完整操作流程、原文定位、鍵盤及焦點驗收、可預覽且不含模型的診斷報告 | 白名單本機診斷預覽／下載、有限操作紀錄及版本缺失已實作；敏感字串排除、Escape 保留跨 block 選取與手機版面已驗收。Preview.9 另完成 TFLite 原生鍵盤開檔／定位、16→32px 焦點、手動 tabs、五種 modal 邊界／關閉後焦點、繼續選取並保存／搜尋／JSON 及子模型下載重開，正式站八項操作均通過。preview.18 正式版本已通過 MLIR validation modal、分支／匯合／迴圈 Canvas 的跨 block 鍵盤選取、pattern 及 MLIR 匯出重開，見 [MLIR／Canvas 歷史範圍](mlir-keyboard.md)及 [preview.18 桌面功能驗收](desktop-fixes.md)；已完成固定交付與正式站核對。完整新手流程、其他鍵盤／螢幕閱讀器與公司環境仍待補，歷史見 [鍵盤驗收](keyboard-acceptance.md) |
| 發布及回退 | 固定版本部署包、建置來源／清單、公開與內網區分、受影響功能關卡、回退演練 | 受控 Pages 已強制核對四項 main CI、artifact digest、受測依賴 scope、原始量測與乾淨候選重建；main-only environment／必要 PR 檢查及錯誤整站 ID 拒絕已驗收。前次 preview.8／preview.7 實際回退再恢復、同一 browser context 保存／lazy imports／匯出重開通過，見 [正式切換驗收](production-transition-verification.md)。preview.18 的歷史正式交付已完成，1,318 檔 SHA／MIME、29 項正式原生操作、八份 TFLite 編輯匯出收據與四份固定 Release 實際 bytes、部署權威及 root 均核對；模型分頁、刪除／復原、獨立圖形編輯與 32px 筆電版面見 [preview.18 驗收](desktop-fixes.md)。任意資料格式升降級及公司內網實際切換仍需驗收 |

目前 TFLite 編輯草稿可下載 JSON，換電腦重新選取原模型、核對完整檔案指紋後續改；探索用 IndexedDB 草稿／工作階段 JSON 仍不包含模型編輯命令。Preview.15 另以網站內分頁保留原模型和小模型的搜尋、選取、視角及編輯 Undo／Redo，只有當前模型啟用 Worker；關站前仍須下載備份，preview.16 的本機編輯自動保存及強制終止測試瀏覽器後的恢復已通過，OS 斷電／儲存回收仍未驗收。

公開開發使用公開／合成樣本。公司模型、私有 dialect 與 compiler 留在內網；未驗收時不得將其標為已支援。依使用者最新範圍，這部分由使用者自行修改，不阻擋本輪公開版交付。

長時間負載另加入 [兩小時實體模型 CI](lifecycle-soak.md)：同一瀏覽器至少兩小時／64 輪，沿用所有八輪門檻，額外拒絕長期 RSS 成長、取樣缺口和空等湊時。判定器正負例與真實瀏覽器結果分開記錄；較早 preview.18 與現行 preview.22 應用各有獨立 80 輪成功紀錄。兩次負載都沒有呼叫手動 interpreter，不當成數小時 WASM 執行證據。

版本隔離、可信 site ID、歷史保留／中斷恢復、固定 Release 提升與部署權威核對已在 main。preview.18 的歷史固定交付為 build `88b1b6ae59c5fd17`，來源 `cb0b9c179938d10b827a4bb1e679aae82c5b4754`。76 項 main 契約、六種隔離切換、29 項正式 Chromium 操作與 1.25 GiB／21,005 OP 八輪改模、整份輸出及子模型生命週期通過；四關卡 fingerprint／原始報告在 prepare 重新核對。當時正式站 1,318 檔、四份 Release 實際下載及部署權威核對通過，Firefox／WebKit 各十三項所列功能也通過，見 [preview.18 歷史交付與限制](desktop-fixes.md)。既有失敗、前版發布與回退紀錄保留，不以後續成功改寫。

後續公開品質仍有其他引擎及手動 runtime 長時間負載、其他 OS／固定硬體 SLA、OS 斷電／儲存回收、任意格式遷移與完整鍵盤／螢幕閱讀器及新使用者流程；本次沒有宣稱這些項目全部完成。已完成的三引擎八輪與 Chromium 80 輪保持各自證據範圍。公司實模／compiler／custom runtime 則依使用者指示交由內網自行處理。

其他桌面引擎已通過 Hosted Linux Firefox 142.0.1／WebKit 26.0 的正式站各十三項唯讀功能驗收，包含 TFLite 接線、草稿、IF／WHILE／custom 匯出及 MLIR SSA／Canvas／pattern，見 [preview.18 正式交付](desktop-fixes.md)。先前 recovery Worker／ResizeObserver 應用錯誤已修正，Firefox 原生鍵盤 driver 差異也已核對。這不代替其他引擎 1 GiB／程序記憶體、數小時量測或公司環境；全部早期失敗在 [桌面診斷](desktop-engines.md)保留。

Preview.16 的完整大型原模型自動指紋（八輪各最多 1 MiB／次）及瀏覽器程序強制終止後恢復已通過，見 [完整恢復交付](edit-recovery.md)。後續已補上 1.25 GiB 手動 JSON 下載／原生重選恢復、取消、32px 視角及 Redo、實際整份匯出重開與權重／custom options／pattern 驗收，見 [大型手動草稿驗收](large-edit-draft.md)。這不代替公司實模、其他引擎、OS 斷電、固定實體硬體 SLA 或數小時負載。


Firefox／WebKit 較早加入 [實體 1.25 GiB 八輪程序 RSS 驗收](desktop-physical.md)。當時重測已完成八輪完整改模、子模型匯出重開、權重／options 比對與原生 Worker close；兩個引擎都因 RSS 峰值成長超過既定上限而失敗，不能由功能成功推論記憶體合格。原始 provider 認證與失敗數據保留；後續修正及新三引擎八輪結果見上方 preview.22 候選，不以後續成功改寫歷史失敗。共用 Chromium runner 的原八輪來源與歷史長測範圍另見 [實際證據](lifecycle-soak.md#共用-runner-的原八輪模式)；不能延伸成所有新版來源或數小時負載都已通過。


大型 v2 組合草稿的 [手動儲存、取消及重新選原模型還原](large-composition-draft.md#已核對的結果)已補驗，包含 32px 視角、Redo、完整權重／options、相同 bytes 重匯出及原生程序清理；當時截圖發現的工作區按鈕選取殘留已在 [preview.27](workspace-mode-state.md#preview27-正式交付)修復，後續 preview.30 的工作區互斥驗收也通過。

現行 preview.30 的 Firefox 142.0.1／WebKit 26.0 已完成[跨引擎獨立核對](desktop-runtime.md#最終核對結果)：各十六項原生操作、四次正式示範 CPU、十九種執行／分佈情境、五組指南及六十模型／十六 runtime Workers 關閉。兩次 Firefox 測試觀察問題與原失敗保留，WebKit 成功按相同應用及僅測試等待／完成策略的差異沿用；未修改應用或重新部署。頁面 layout Worker 最後 close 與 Firefox JS module request 的觀察界線另明列，不延伸為所有程序／RSS、數小時或完整螢幕閱讀器已驗收。
