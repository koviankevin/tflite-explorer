# 鍵盤操作與焦點驗收

候選 preview.9 補上搜尋分頁的鍵盤操作。Tab 進入目前啟用的分頁，左右方向鍵循環移動，Home／End 到第一／最後分頁；Enter 或 Space 才切換並搜尋。移焦點不啟動另一個搜尋，以免大型模型或跨 block pattern 的計算拖慢導覽。搜尋控制區以 tabpanel 與當前分頁互相標示；未啟用的 tabs 不各占一個 Tab 停留點。

對話框的 keydown／keyup 停在框內，保留瀏覽器原生 Tab、按鈕、選單和 Escape 行為；不再傳給後方圖形的快捷鍵。原生關閉後回到開啟它的按鈕。Netron 圖形 register 僅在焦點原本屬於圖面或 body 時聚焦圖形；關閉 sidebar 也只在 sidebar／圖形原本持有焦點時返回圖形，避免重畫搶走搜尋欄、字級選單和對話框中的焦點。

`production-smoke.yml` 的 `scenario=keyboard` 可唯讀驗收正式站。兩個已發布的固定 preview.7／preview.8 build 保留原四項回退驗收；所有其他新 build 的 site／正式部署 smoke 都必須加跑鍵盤流程，不能因新版本尚未支援就略過。只在 hosted Linux CI、固定公開 repository／workflow 執行；顯式舊版 audit 另要求 main，模型只用公開範例，不操作個人瀏覽器。

腳本以真實 Tab、方向鍵、Enter、Space、Escape、Ctrl F／O，以及原生 file chooser／download 操作，CDP 只讀 DOM。涵蓋原生開檔、搜尋定位、16→32px 字級及重畫後焦點、手動啟用 tabs、modal 焦點／選取、鍵盤加入 layers／儲存並搜尋、pattern JSON 匯入匯出，以及 TFLite 子模型下載／重開和 Worker 終止。原生下拉選單在 Enter 確認後核對實際 value；選檔訂閱在導覽前啟用，避免把觀察器的非同步訂閱誤當作網站故障。

前置正式站 audit `40477509713` 等不到選檔事件，但後續 `40478529038` 的 Enter 未用任何替代鍵即成功，因此沒有宣稱網站 Enter 故障。修正原生 select 的提交方式後，[40479230063](https://github.com/koviankevin/tflite-explorer/actions/runs/40479230063) 仍無法連續完成 16→32px；Netron `Target.register()` 的無條件聚焦是修正目標。舊版尚未跑到 arrow tabs／modal 場景，不以這些前置失敗冒充其動態負例。候選實際瀏覽器、效能與正式部署驗收仍待完成；本文件不是全站無障礙或其他瀏覽器合格聲明。

操作設計參考 [W3C APG tabs pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/) 的手動啟用與焦點建議。
