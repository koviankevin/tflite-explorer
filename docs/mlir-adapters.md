# MLIR adapter 與內部 dialect 接入

`model-formats.js` 僅辨識副檔名，前端不載入 parser。Worker 透過
`openModelFile()` 接上 TFLite 或 MLIR；MLIR parser 使用動態 import。
兩者回傳相同搜尋／繪圖索引，以及格式能力 `capabilities.tfliteExport`／`mlirExport`。

`mlir-engine.js` 使用 Netron 的 parser；文字解析完畢後，若有
`context.buildMLIRModel`，將 block 與 source metadata 交給 adapter 建立模型。
這避免 upstream viewer 攤平 block 或省略常數時丟失搜尋所需的結構。
匯出另記錄 operation／type／SSA use 的原始文字範圍，以及 aliases／resources。
generic block arguments 必須登記到 SSA scope，才能正確區別巢狀同名值；
結果的原始 SSA 名稱需保留 grouped results 的 `#N`，包括混合結果群組。
更新 Netron 時須保留這些接點並執行 MLIR 測試。

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
只有能提供等價原文範圍／SSA identity、並通過匯出 round-trip 的 parser 才啟用
`mlirExport: true`；顯示模型不是可用於匯出的完整 IR。
這需要真正解析該語法；decorator 或 op 名稱清單不能替代 parser。

## 範圍與驗證

每個 block 是一個 graph／搜尋範圍；巢狀 scope 路徑包含 owning op、region
及 block。跨 scope 使用的值在該 graph 顯示為輸入，不推斷記憶體與控制
相依；不跨 scope 搜尋 pattern。多輸出分組恢復為 `%result#N`。

執行 `node --test test/*.test.mjs`。新增 dialect 必須至少測完整 op 名稱、
不同 namespace 的同名 op、SSA 多輸出、重複 SSA 名稱的不同 scopes、
自訂 type／attributes、圈選 JSON round trip 和無效語法診斷。
瀏覽器另測實際檔案選擇、搜尋定位、圈選與 TFLite／MLIR 來回切換。

## 局部 MLIR 匯出

`mlir-export.js` 使用 worker 內的 `index.mlir`，不從圖形／顯示 attributes
重建 IR。依原 block 順序擷取選定 operations，保留完整 region；以 parser
記錄的 SSA use 範圍替換外部值，避免修改 strings、attributes 或巢狀同名值。
型別與 attributes 保留原始 lexemes，aliases 和 resource dictionaries
一併帶入。輸入／輸出以 generic `func.func` 包裝；原有 `func.return`
只有與全部輸出相容時才直接保留，其餘情況產生新的 return。

下載前以相同 parser 重新解析；這只確認可讀性，不等於 LLVM／內部 dialect
的語意驗證。目前不擷取 symbol dependencies 或跨 block 控制流程；遇到
symbol references、successors 或獨立 yield／branch terminator 會明確拒絕。
規格參考 [MLIR Language Reference](https://mlir.llvm.org/docs/LangRef/#operations)。
