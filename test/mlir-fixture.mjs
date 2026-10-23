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
