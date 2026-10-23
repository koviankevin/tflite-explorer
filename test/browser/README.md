# Operator label bounds regression

Run `node test/browser/make-long-label-fixture.mjs <output.tflite>` to create a
synthetic long custom operator with two outputs and an Add join.

Using the supported browser tool, open the fixture through the real file picker
and select 32px. Pass the exported `operatorLabelBounds` probe to the browser's
read-only `evaluate()` API. Assert that the array is non-empty and every
`withinFrame` is true in each state:

- Before selecting a layer.
- After selecting the long custom operator from Layers search.
- After enabling pattern capture and selecting that operator on the graph.
- After changing font size from 14px to 32px while selected.

Also repeat with a custom operator whose outputs take separate operator branches
before joining, then save/search the captured pattern. Verify all matched labels
fit, both branches remain separate and the pattern has one physical match.

This browser measurement catches the original failure: highlighted text changed
from weight 400 to 700 after Netron measured its frame, leaving a negative right
padding. DOM geometry must be checked in a real rendered SVG; a CSS string test
does not cover it.
