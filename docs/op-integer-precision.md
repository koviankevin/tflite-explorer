# OP 64-bit 整數參數精度

Preview.24 的新增 OP 表單會以 JSON 解析陣列；例如 `[9007199254740993]` 先被 JavaScript 捨入成 `9007199254740992`，舊的 int64 轉換仍接受此值，導致寫入的參數與使用者輸入不同。scalar API 也可能接受已捨入的 Number。

修正讓 int64／uint64 scalar 及 int64 陣列拒絕不安全的 Number；較大的值需使用十進位字串，陣列例如 `["9007199254740993"]`。原安全整數仍可使用數字。64-bit 預設值也保留為文字後才轉 BigInt，不經 Number；表單提供輸入說明。

實際舊來源與修正函式的對照已確認上述捨入與拒絕行為。四項直接回歸涵蓋安全數字、正負不安全數字、int64 邊界、非十進位／超範圍拒絕，及真正 Flatbuffer writer → schema reader 的逐值比對。連同原表單與型別亂數共十一項 Node 檢查通過。

新增 Hosted 原生案例在 1280×640／32px 操作進階 OP 表單：不安全陣列需顯示原因且不改草稿；加引號後 scalar／vector 需保留完整值，沒有額外推論、runtime 請求或下載。候選與主分支驗收已通過；正式發布仍待下述準備與發布後核對。

這項修正保證參數不被數字轉型悄悄捨入，不表示巨大索引具備有效的 kernel／shape 語意；完整運算規則仍須對應 runtime 驗證。

## 候選與主分支驗收

[舊／新函式對照](results/int64-before-after-2026-10-29.json)保留實際捨入與修正結果。候選 [40805663585](https://github.com/koviankevin/tflite-explorer/actions/runs/40805663585)，來源 `5862aa64658d0f7adf49419e7b27a931768e875f`／tree `b1736665a3767f15b51b1e7151e255886d2b43ce`，build `6b30b6752db42bf1` 的 [獨立核對](results/int64-candidate-review-2026-10-29.json)、[切換 ZIP](results/int64-candidate-site-2026-10-29.zip)與[原生 ZIP](results/int64-candidate-native-2026-10-29.zip)已驗 provider digest、CRC 與乾淨重建。

主分支來源 `e3f6b5d91428ef0212918d2066dd919626f8f105` 與候選完整 tree 相同，build `b409d539735373bf`。site [40806005437](https://github.com/koviankevin/tflite-explorer/actions/runs/40806005437) 的[獨立核對](results/int64-main-review-2026-10-29.json)、[切換 ZIP](results/int64-main-site-2026-10-29.zip)與[原生 ZIP](results/int64-main-native-2026-10-29.zip)均通過六種切換、30 項操作、十種參數／runtime 情境；38 個模型與四個 runtime Workers 全部關閉，沒有 page errors。32px 表單拒絕不安全數字且草稿不變，字串保留全部位數；舊 raw BIN／CPU／IO ZIP、取消焦點及 optional-reference 行為保留。

[四關卡](results/int64-main-gates-review-2026-10-29.json)核對來源／scope fingerprint／原始報告：core 沿用未改的 main 40700051621，browser 40805999342、contract 40806002140、site 40806005437 為新的成功 main run。

[實體八輪](results/int64-main-owned-review-2026-10-29.json)核對原固定完整／局部 bytes、權重、custom options、pattern 正負例、24 個模型與八個指紋 Workers；RSS 漂移 14307328 bytes、斜率 2705583.543 bytes／輪。觀察到的 6 個 PID／start-ticks 全部正常退出，沒有強制清理。這是有限八輪證據，沒有宣稱新兩小時或其他引擎長測。
