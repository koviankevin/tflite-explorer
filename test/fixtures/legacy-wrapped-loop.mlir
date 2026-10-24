// Model Lens CFG slice: selected operations and required cyclic/control producers.
// input 0: %__ml_slice_input_0 = "%_ml_slice_input_0" : i1 (boundary)
// input 1: %__ml_slice_input_1 = "%_ml_slice_input_1" : i32 (boundary)
// output 0: results [0] = "%next"
// block ^__ml_slice_b0 = "^_ml_slice_entry"
// block ^__ml_slice_b1 = "^_ml_slice_b0"
// block ^__ml_slice_b2 = "^_ml_slice_b1"
// block ^__ml_slice_b3 = "^_ml_slice_b2"
// block ^__ml_slice_b4 = "^_ml_slice_b3"

"builtin.module"() ({
"func.func"() <{sym_name = "extracted", function_type = (i1, i32) -> (i32)}> ({
^__ml_slice_entry(%__ml_slice_input_0: i1, %__ml_slice_input_1: i32):
  "cf.br"(%__ml_slice_input_0, %__ml_slice_input_1)[^__ml_slice_b0] : (i1, i32) -> ()
^__ml_slice_b0(%_ml_slice_input_0: i1, %_ml_slice_input_1: i32):
  "cf.br"(%_ml_slice_input_0, %_ml_slice_input_1)[^__ml_slice_b1] : (i1, i32) -> ()
^__ml_slice_b1(%ml_slice_input_0: i1, %ml_slice_input_1: i32):
  "cf.br"(%ml_slice_input_0, %ml_slice_input_1)[^__ml_slice_b2] : (i1, i32) -> ()
^__ml_slice_b2(%condition: i1, %initial: i32):
  "cf.br"(%initial)[^__ml_slice_b3] : (i32) -> ()
^__ml_slice_b3(%iteration: i32):
  %next = "company.step"(%iteration) {mode = "loop"} : (i32) -> i32
  "cf.cond_br"(%condition, %next)[^__ml_slice_b3, ^__ml_slice_b4] <{operandSegmentSizes = array<i32: 1, 1, 0>}> : (i1, i32) -> ()
^__ml_slice_b4():
  "func.return"(%next) : (i32) -> ()
}) {model_lens.slice_pattern = "{\"version\":1,\"graph\":{\"nodes\":[{\"kind\":\"block\",\"arity\":2,\"block\":3},{\"kind\":\"argument\",\"slot\":0,\"parent\":0,\"actualSlot\":0},{\"kind\":\"argument\",\"slot\":1,\"parent\":0,\"actualSlot\":1},{\"kind\":\"operator\",\"type\":\"cf.br\",\"order\":0,\"parent\":0,\"actualOp\":0,\"inputs\":1,\"results\":0,\"selected\":false},{\"kind\":\"block\",\"arity\":1,\"block\":4},{\"kind\":\"argument\",\"slot\":0,\"parent\":4,\"actualSlot\":0},{\"kind\":\"operator\",\"type\":\"company.step\",\"order\":0,\"parent\":4,\"actualOp\":0,\"inputs\":1,\"results\":1,\"selected\":true},{\"kind\":\"operator\",\"type\":\"cf.cond_br\",\"order\":1,\"parent\":4,\"actualOp\":1,\"inputs\":3,\"results\":0,\"selected\":false},{\"kind\":\"block\",\"arity\":1,\"block\":5},{\"kind\":\"argument\",\"slot\":0,\"parent\":8,\"actualSlot\":null}],\"edges\":[{\"from\":0,\"to\":1,\"kind\":\"contains\"},{\"from\":0,\"to\":2,\"kind\":\"contains\"},{\"from\":0,\"to\":3,\"kind\":\"contains\"},{\"from\":4,\"to\":5,\"kind\":\"contains\"},{\"from\":4,\"to\":6,\"kind\":\"contains\"},{\"from\":4,\"to\":7,\"kind\":\"contains\"},{\"from\":8,\"to\":9,\"kind\":\"contains\"},{\"from\":2,\"to\":3,\"kind\":\"ssa\",\"port\":\"0:0\"},{\"from\":0,\"to\":4,\"kind\":\"control\",\"port\":\"0\"},{\"from\":2,\"to\":5,\"kind\":\"argument\",\"port\":\"0:0\",\"branch\":0},{\"from\":5,\"to\":6,\"kind\":\"ssa\",\"port\":\"0:0\"},{\"from\":1,\"to\":7,\"kind\":\"ssa\",\"port\":\"0:0\"},{\"from\":6,\"to\":7,\"kind\":\"ssa\",\"port\":\"0:1\"},{\"from\":6,\"to\":7,\"kind\":\"ssa\",\"port\":\"0:2\"},{\"from\":4,\"to\":4,\"kind\":\"control\",\"port\":\"0\"},{\"from\":6,\"to\":5,\"kind\":\"argument\",\"port\":\"0:0\",\"branch\":4},{\"from\":4,\"to\":8,\"kind\":\"control\",\"port\":\"1\"},{\"from\":6,\"to\":9,\"kind\":\"argument\",\"port\":\"0:1\",\"branch\":4}]},\"seal\":\"53f0a736f5f785f561066f21af08463785bc024348b0020f7eeb85fc254bf442\"}"} : () -> ()
}) : () -> ()

