export const MLIR_BRANCH = `"builtin.module"() ({
  "func.func"() <{sym_name = "main", function_type = (tensor<2xf32>) -> tensor<2xf32>}> ({
  ^bb0(%input: tensor<2xf32>):
    %split:2 = "acme.split"(%input) {tag = "custom op"} : (tensor<2xf32>) -> (tensor<2xf32>, tensor<2xf32>)
    %left = "acme.reshape"(%split#0) : (tensor<2xf32>) -> tensor<2xf32>
    %right = "acme.reshape"(%split#1) : (tensor<2xf32>) -> tensor<2xf32>
    %joined = "acme.join"(%left, %right) : (tensor<2xf32>, tensor<2xf32>) -> tensor<2xf32>
    "func.return"(%joined) : (tensor<2xf32>) -> ()
  }) : () -> ()
}) : () -> ()`;

export const MLIR_EXPORT_BRANCH = '!T = tensor<2x!internal.elem<foo,bar>>\n#cfg = #internal.layout<packed>\n'+
    MLIR_BRANCH.replaceAll('tensor<2xf32>', '!T').replace('{tag = "custom op"}',
        '<{count = 9223372036854775807 : i64}> {tag = "中文😀 custom %input", config = #cfg, data = dense<[1.0, 2.0]> : tensor<2xf32>}')+
    '\n#loc = loc("fixture.mlir":7:3)';

export const MLIR_REPEATED_RETURN = '"func.func"() <{sym_name = "repeated", function_type = () -> (i32, i32)}> ({\n'+
    '%x = "acme.input"() : () -> i32\n"func.return"(%x, %x) : (i32, i32) -> ()\n}) : () -> ()';

export const MLIR_SCOPES = `"builtin.module"() ({
  "func.func"() <{sym_name = "first", function_type = () -> ()}> ({
    %x = "acme.input"() : () -> tensor<?x4xf32>
    %y = "acme.region"(%x) ({
    ^bb0(%nested_x: tensor<?x4xf32>):
      %nested_y = "other.custom"(%nested_x) {config = #internal.layout<packed>} : (tensor<?x4xf32>) -> !internal.value<packed>
      "acme.yield"(%nested_y) : (!internal.value<packed>) -> ()
    }) : (tensor<?x4xf32>) -> tensor<?x4xf32>
    "func.return"() : () -> ()
  }) : () -> ()
  "func.func"() <{sym_name = "second", function_type = () -> ()}> ({
    %x = "other.input"() : () -> tensor<2xf32>
    %y = "other.custom"(%x) : (tensor<2xf32>) -> tensor<2xf32>
    "func.return"() : () -> ()
  }) : () -> ()
}) : () -> ()`;
export const MLIR_CFG_DIAMOND = `"builtin.module"() ({
  "func.func"() <{sym_name = "diamond", function_type = (i1, i32) -> i32}> ({
  ^entry(%cond: i1, %input: i32):
    "cf.cond_br"(%cond)[^left, ^right] <{operandSegmentSizes = array<i32: 1, 0, 0>}> : (i1) -> ()
  ^left:
    %left_value = "company.custom_long_name_with_attributes"(%input) <{mode = "保留"}> {tag = "left", count = 9223372036854775807 : i64} : (i32) -> i32
    "cf.br"(%left_value)[^join] : (i32) -> ()
  ^right:
    %right_value = "company.custom"(%input) {tag = "right"} : (i32) -> i32
    "cf.br"(%right_value)[^join] : (i32) -> ()
  ^join(%merged: i32):
    %result = "company.finish"(%merged) : (i32) -> i32
    "func.return"(%result) : (i32) -> ()
  }) : () -> ()
}) : () -> ()`;

export const MLIR_CFG_LOOP = `"func.func"() <{sym_name = "loop", function_type = (i1, i32) -> i32}> ({
^entry(%condition: i1, %initial: i32):
  "cf.br"(%initial)[^loop] : (i32) -> ()
^loop(%iteration: i32):
  %next = "company.step"(%iteration) {mode = "loop"} : (i32) -> i32
  "cf.cond_br"(%condition, %next, %next)[^loop, ^exit] <{operandSegmentSizes = array<i32: 1, 1, 1>}> : (i1, i32, i32) -> ()
^exit(%answer: i32):
  "func.return"(%answer) : (i32) -> ()
}) : () -> ()`;

// The dominating definition is printed after its use block, which requires
// lexical forward-reference repair but is valid CFG/SSA.
export const MLIR_CFG_FORWARD = `"func.func"() <{sym_name = "forward", function_type = (i32) -> i32}> ({
^entry(%input: i32):
  "cf.br"()[^definition] : () -> ()
^use:
  %result = "company.use"(%later) : (i32) -> i32
  "func.return"(%result) : (i32) -> ()
^definition:
  %later = "company.define"(%input) : (i32) -> i32
  "cf.br"()[^use] : () -> ()
}) : () -> ()`;

export const MLIR_CFG_SWITCH = `"func.func"() <{sym_name = "switch", function_type = (i32, i32) -> i32}> ({
^entry(%flag: i32, %input: i32):
  "cf.switch"(%flag, %input, %input, %input)[^default, ^case0, ^case1] <{operandSegmentSizes = array<i32: 1, 1, 2>, case_operand_segments = array<i32: 1, 1>, case_values = dense<[0, 1]> : vector<2xi32>}> : (i32, i32, i32, i32) -> ()
^default(%d: i32):
  "func.return"(%d) : (i32) -> ()
^case0(%a: i32):
  "func.return"(%a) : (i32) -> ()
^case1(%b: i32):
  "func.return"(%b) : (i32) -> ()
}) : () -> ()`;
