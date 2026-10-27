export function performanceMLIR(hidden) {
    const chain=Array.from({length:hidden},(_,n)=>`  %hidden${n} = "company.hidden"(${n?'%hidden'+(n-1):'%next'}) : (i32) -> i32`).join('\n');
    return `"func.func"() <{sym_name = "performance", function_type = (i1, i32) -> i32}> ({
^entry(%condition: i1, %input: i32):
  "cf.cond_br"(%condition)[^left, ^right] <{operandSegmentSizes = array<i32: 1, 0, 0>}> : (i1) -> ()
^left:
  %left = "company.left"(%input) : (i32) -> i32
  "cf.br"(%left)[^join] : (i32) -> ()
^right:
  %right = "company.right"(%input) : (i32) -> i32
  "cf.br"(%right)[^join] : (i32) -> ()
^join(%merged: i32):
  "cf.br"(%merged)[^loop] : (i32) -> ()
^loop(%iteration: i32):
  %next = "company.step"(%iteration) : (i32) -> i32
${chain}
  %continue = "company.test"(%hidden${hidden-1}) : (i32) -> i1
  "cf.cond_br"(%continue, %next, %next)[^loop, ^exit] <{operandSegmentSizes = array<i32: 1, 1, 1>}> : (i1, i32, i32) -> ()
^exit(%answer: i32):
  "func.return"(%answer) : (i32) -> ()
}) : () -> ()\n`;
}
