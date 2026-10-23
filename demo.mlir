"builtin.module"() ({
  "func.func"() <{sym_name = "main", function_type = (tensor<2xf32>) -> tensor<2xf32>}> ({
  ^bb0(%input: tensor<2xf32>):
    %split:2 = "acme.split"(%input) {tag = "custom op"} : (tensor<2xf32>) -> (tensor<2xf32>, tensor<2xf32>)
    %left = "acme.reshape"(%split#0) : (tensor<2xf32>) -> tensor<2xf32>
    %right = "acme.reshape"(%split#1) : (tensor<2xf32>) -> tensor<2xf32>
    %joined = "acme.join"(%left, %right) : (tensor<2xf32>, tensor<2xf32>) -> tensor<2xf32>
    "func.return"(%joined) : (tensor<2xf32>) -> ()
  }) : () -> ()
}) : () -> ()
