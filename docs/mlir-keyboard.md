# MLIR／Canvas 鍵盤操作與驗收（preview.17）

此頁保留 preview.17 的交付證據；現行 preview.18 見 [桌面修正與正式交付](desktop-fixes.md)。preview.17 已正式發布，build `b279d3ea3f3d7ec5`。Canvas 可見鍵盤焦點、跨 block 選取與 MLIR 檢查對話框返回焦點，已通過主分支、完整封裝及正式站對應版本驗收。固定來源及實際下載核對見本頁正式交付紀錄。

Canvas 聚焦時顯示鍵盤提示：方向鍵平移、＋／－縮放、Home 顯示全圖、Tab 到節點，Enter／Space 查看或切換圈選。焦點所在的 OP 有藍色外框，圖面下方顯示目前控制項及 block／OP 編號。長名稱可換行，控制項不超過 100px 高，完整文字保留於可及名稱與 title。節點清單仍最多 100 個；不為 20,000 個 OP 建立完整 DOM。

Tab 聚焦只移動畫面，不改變搜尋匹配或圈選集合；圈選狀態下原生 Enter／Space 每次只切換一次。方向鍵與縮放鍵也可在節點控制項上使用。視窗重新繪製時不移除目前聚焦的控制項，模式與 aria-pressed 就地更新。用鍵盤展開 pattern capsule 後，舊控制項移除時，只有模型、查詢及焦點仍屬於這次操作才返回新的 Canvas，不搶走使用者後來移到其他控制項的焦點。

本版已通過下列原生鍵盤驗收：未定義 SSA 的 MLIR 匯出要在下載前顯示行列／原因，Tab／Shift Tab 留在檢查對話框、Ctrl F 不影響背景，Escape 與關閉按鈕返回匯出來源並保留圈選。分支匯合及迴圈各增加 1,601 個公開合成 OP，確實超過 1,500 節點而使用 Canvas；從搜尋、展開 capsule、跨 block 選取、16→32px、方向鍵平移／縮放，到儲存及下載 pattern、局部 MLIR 匯出／重開與原 pattern 搜尋，全部透過原生鍵盤／選檔／下載完成。

只在 Hosted Linux Chromium 驗收 1366×640／1280×640 筆電，不測手機、不啟動個人瀏覽器、不使用公司模型。新 build 的正式 smoke 必須包含此流程；固定 preview.16 與更早版本保留原驗收，確保回退仍可驗證。此項不等於全站無障礙、所有瀏覽器或公司 dialect／compiler 已完成驗收。


## 主分支證據

[PR #48](https://github.com/koviankevin/tflite-explorer/pull/48)合併來源 `815813264b785d9fc3f9cab8ab69720a8b501f04`／tree `2cd353bd3269e769b9d1bbc08e9a1eeec5964333` 與成功候選完整 tree 一致。主分支 [40643327706](https://github.com/koviankevin/tflite-explorer/actions/runs/40643327706) 的 [29 項原始操作](results/preview17-main-ui-2026-10-28.json)與 [provider／來源核對](results/preview17-main-ui-review-2026-10-28.json)通過；六種隔離版本切換另有 [原始報告](results/preview17-main-site-2026-10-28.json)。不只沿用候選綠燈。

- 分支匯合：1,608 OP、四個 blocks，鍵盤選七個 OP；迴圈：1,605 OP、三個 blocks，鍵盤選四個 OP。兩者都超過實際 Canvas 門檻，使用 1366×640／1280×640，16→32px、方向鍵平移及＋／－縮放後選取不遺失、不重複；以原生按鍵展開 capsule 也返回新 Canvas。
- 聚焦的實際控制項高 41px、完整位於模型圖範圍內；長 custom 名稱在 1366px 畫面控制項寬 631.625px，1280px 的迴圈控制項寬 418.640625px，頁面無水平溢出。實際 DOM 控制項為 1／7／4 個；最壞清單 100 個上限另由 2,000 節點的 Node adapter 測試驗證。[1280×640 原生焦點畫面](results/preview17-main-canvas-keyboard-2026-10-28.png)已視覺檢查，SHA-256 `44c42db5aa4f9a5a94dc010b4993631ef43e1eb86437f6f1773009ee214e1a29`。
- 未定義 SSA 負例在下載前拒絕，顯示行／欄及 `SSA_UNDEFINED`；Tab／Shift Tab 循環、Ctrl F 隔離、Escape 與按鈕關閉返回原匯出控制項，選取保留且下載數為零。
- 保存的 CFG pattern 可下載 JSON，原模型匹配各一筆；局部 MLIR 分別為 4,019／3,210 bytes，未包含 1,601 個額外 padding OP。Node 重新解析的 SSA／dominance 檢查通過，舊 pattern 與新捕捉的 pattern 各匹配一次；網站原生開啟匯出結果後也各一筆。這不代表公司 dialect 自訂語意或 LLVM verifier 已通過。
- 32 個主 context 模型 Worker 全收到 close。既有模型分頁 context 的六個模型 Worker 及編輯恢復程序樹、權重／custom options 收據亦保留原檢查；SIGKILL 遺失的 DevTools close 仍保留 false，另記 OS 所有權程序終止，不偽改原始事件。

[四關卡與相依核對](results/preview17-main-gates-2026-10-28.json)：沿用 core `40503475445` 的 [九筆量測](results/preview17-main-core-2026-10-28.json)，86 份相依 fingerprint `cf77c1b1377b55cf36fcba0c536e97bfdb391f10eec37f3830a0eb1a1ad1b7c8` 相同；main contract `40643324422` [76 項](results/preview17-main-contract-2026-10-28.json)全通過；site `40643327706` 通過六種版本切換及 29 項操作；browser `40643321265` [實體八輪](results/preview17-main-browser-2026-10-28.json)及 [額外完整指紋／provider 核對](results/preview17-main-browser-review-2026-10-28.json)通過。

實體模型仍為 1,349,965,216 bytes／21,005 OP，八輪完整編輯輸出每份 1,350,445,736 bytes／21,006 OP，七段共 1,342,177,328 bytes 權重／custom options 串流比對通過。兩輪暖機後 RSS drift 17,145,856 bytes、斜率 1777781.03 bytes／輪、取樣峰值 1,001,787,392 bytes，仍使用原門檻；八次完整指紋與獨立 Node 一致，8 個指紋 Worker 與 24 個模型 Worker 全終止。未強制 GC，也未縮短 60 秒 Blob URL 撤銷。

前置失敗保持原狀：[檢查對話框焦點失敗](results/preview17-validation-focus-failure-2026-10-28.json)／[provider 核對](results/preview17-validation-focus-review-2026-10-28.json)指出關閉後仍在 `close-validation`；[測試 tabs 操作失敗](results/preview17-roving-tab-failure-2026-10-28.json)／[provider 核對](results/preview17-roving-tab-review-2026-10-28.json)改用手動 roving tabs 的 End＋Enter；[capsule 焦點交接失敗](results/preview17-capsule-focus-failure-2026-10-28.json)／[provider 核對](results/preview17-capsule-focus-review-2026-10-28.json)確認需從 Netron 圖面容器交回新 Canvas。對話框及 capsule 是應用修正，tabs 是測試方式修正，沒有跳過必要流程或放寬效能上限。

本輪證明所列功能流程可透過鍵盤完成，未宣稱所有快捷鍵、最短操作步數、螢幕閱讀器或全站無障礙已合格。公司實模／compiler／runtime、其他引擎、固定實體硬體 SLA、OS 斷電、數小時負載及完整新手流程仍待驗收。


## 正式交付

- [正式網站](https://koviankevin.github.io/tflite-explorer/)與 [固定 Release](https://github.com/koviankevin/tflite-explorer/releases/tag/v0.2.0-preview.17)為 preview.17／build `b279d3ea3f3d7ec5`。凍結來源 `8f374e20ec4acb29d3434eadf81daebf02523e2d`、tree `b328a1f287869679fd755c30b1065cc624365325`；後續僅更新交付文件，不改寫既有固定產物。
- [準備 40646144406](https://github.com/koviankevin/tflite-explorer/actions/runs/40646144406)後，獨立 [完整部署包審查](results/preview17-prepared-review-2026-10-28.json)與 [凍結來源四關卡指紋](results/preview17-frozen-gates-review-2026-10-28.json)通過，再以精確 build／site ID 執行 [正式發布 40646847623](https://github.com/koviankevin/tflite-explorer/actions/runs/40646847623)。prepare／deploy／verify_live／release 全成功，attempt 1。
- [正式 HTTP 原始紀錄](results/preview17-live-http-2026-10-28.json)核對 1,310 檔 SHA／MIME；site ID `b68ad1da9211af5c8b39309954148f95131be0cea23508f166d028ec829340f1`、manifest SHA-256 `498973cab32d3d2efb22cdbaa97e4a34f92a860b4507ae674b9f147256b97747`、root SHA-256 `b273ae773de533d651bc59308395bed365fcff710260ba5b439216b1524ff54d`。保留 preview.16／preview.15 及永久 preview.7 legacy root。
- [正式版本原生報告](results/preview17-live-ui-2026-10-28.json)29 項通過，包含本頁所列 MLIR modal、1,608／1,605 OP Canvas、跨四／三 blocks 的鍵盤選取、16→32px、pan／zoom、pattern JSON、局部 MLIR 下載重開及舊／新 pattern 各一筆；32 個主 context 模型 Worker 全 close。既有六個模型分頁 context Worker、兩個編輯恢復 owned process trees、八份 TFLite 編輯匯出收據亦通過。此項與正式 HTTP 逐檔同源比對共同構成正式版本驗收，不使用使用者個人瀏覽器或公司模型。
- [1280×640／32px 正式版本焦點畫面](results/preview17-live-canvas-keyboard-2026-10-28.png)已視覺檢查，SHA-256 `68fbe072c501878230063a80dd864a8849b92388224ebe576af068762b00425e`。不測手機；頁面與焦點控制項無水平溢出。
- [固定 Release 核對](results/preview17-fixed-release-2026-10-28.json)及 [最終獨立交付審查](results/preview17-publication-review-2026-10-28.json)通過：四份實際下載均與原準備包 bytes／SHA 一致。`model-lens-public-0.2.0-preview.17-b279d3ea3f3d7ec5.zip` 為 29,716,711 bytes／273 核心檔案，SHA-256 `50c9d6e7c8b4121e5e5fda4a9c0298520992d649436d031166802073fef3b0f0`。
- 權威 Deployment `7379157250`／job `122677794922`／run `40646847623` 與來源、完整 site ID 及未加 query 的實際 root 一致。

此功能與交付驗收完成不代表整個商品等級目標完成。公司實模／compiler／runtime、其他引擎、固定實體硬體 SLA、OS 斷電、數小時負載、其他鍵盤／螢幕閱讀器及完整新手流程仍需另外驗收。
