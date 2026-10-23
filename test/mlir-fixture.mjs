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

export const MLIR_SCOPES = `"builtin.module"() ({
  "func.func"() <{sym_name = "first", function_type = () -> ()}> ({
    %x = "acme.input"() : () -> tensor<?x4xf32>
    %y = "acme.region"(%x) ({
    ^bb0(%x: tensor<?x4xf32>):
      %y = "other.custom"(%x) {config = #internal.layout<packed>} : (tensor<?x4xf32>) -> !internal.value<packed>
      "acme.yield"(%y) : (!internal.value<packed>) -> ()
    }) : (tensor<?x4xf32>) -> tensor<?x4xf32>
    "func.return"() : () -> ()
  }) : () -> ()
  "func.func"() <{sym_name = "second", function_type = () -> ()}> ({
    %x = "other.input"() : () -> tensor<2xf32>
    %y = "other.custom"(%x) : (tensor<2xf32>) -> tensor<2xf32>
    "func.return"() : () -> ()
  }) : () -> ()
}) : () -> ()`;
