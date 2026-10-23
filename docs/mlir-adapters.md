# MLIR adapter 與內部 dialect 接入

`model-formats.js` 僅辨識副檔名，前端不載入 parser。Worker 透過
`openModelFile()` 接上 TFLite 或 MLIR；MLIR parser 使用動態 import。
兩者回傳相同搜尋／繪圖索引，以及格式能力 `capabilities.tfliteExport`。

`mlir-engine.js` 使用 Netron 的 parser；upstream `mlir.js` 只有一個本地接點：
文字解析完畢後，若有 `context.buildMLIRModel`，交給 adapter 建立模型。
這避免 upstream viewer 攤平 block 或省略常數時丟失搜尋所需的結構。
更新 Netron 時須保留此接點並執行 MLIR 測試。

## Generic operations 與顯示擴充

未知 dialect 使用 generic operations 時不需預先列舉 op 名稱。
Pattern 保留 qualified `dialect.op` 的 namespace 與大小寫；文字搜尋仍不分大小寫。
`parseMLIR(bytes, { metadata, dialects })` 的 `metadata` 是完整 upstream
`mlir-metadata.json` 文字；`dialects` 可在公司版本傳入 namespace decorator：

```js
const dialects = [{
    namespace: 'company',
    describeOperation({ name, attributes, scope }) {
        return [{ name: 'Internal category', type: 'string', value: 'accelerator' }];
    }
}];
```

在公司版本的 worker 呼叫 `openModelFile()` 時傳入 `dialects`。新增的
attributes 只補充顯示，不覆蓋 canonical `dialect.op` 或 SSA 接線。
內部 definitions、匿名範例和 metadata 留在公司 repo；不用修改搜尋、
pattern library 或圖形控制。不要從模型檔案或網路動態執行 JavaScript。

若輸入是公司專用 custom assembly，先透過公司的 compiler 輸出 generic
形式。若必須直接支援該語法，在 `openModelFile()` 的 MLIR 解析分支替換
parser implementation，回傳 `indexModel()` 可接受的 model，並保留
`sourceFormat: 'mlir'` 及 `capabilities: { tfliteExport: false }`。
這需要真正解析該語法；decorator 或 op 名稱清單不能替代 parser。

## 範圍與驗證

每個 block 是一個 graph／搜尋範圍；巢狀 scope 路徑包含 owning op、region
及 block。跨 scope 使用的值在該 graph 顯示為輸入，不推斷記憶體與控制
相依；不跨 scope 搜尋 pattern。多輸出分組恢復為 `%result#N`。

執行 `node --test test/*.test.mjs`。新增 dialect 必須至少測完整 op 名稱、
不同 namespace 的同名 op、SSA 多輸出、重複 SSA 名稱的不同 scopes、
自訂 type／attributes、圈選 JSON round trip 和無效語法診斷。
瀏覽器另測實際檔案選擇、搜尋定位、圈選與 TFLite／MLIR 來回切換。
