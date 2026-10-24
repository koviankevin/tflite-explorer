// Pass this read-only probe to the browser's evaluate() after rendering a model.
// Check normal, selected and pattern-picked nodes after changing graph font size.
// The caller must assert a non-empty result and every `withinFrame` is true.
export const operatorLabelBounds = () => [...document.querySelectorAll('#target .node-item-type text')].map(text => {
    const frame = text.parentElement.querySelector('path').getBoundingClientRect();
    const bounds = text.getBoundingClientRect();
    const padding = {
        left: bounds.left - frame.left,
        right: frame.right - bounds.right,
        top: bounds.top - frame.top,
        bottom: frame.bottom - bounds.bottom
    };
    return {
        name: text.textContent,
        weight: getComputedStyle(text).fontWeight,
        font: getComputedStyle(text).fontSize,
        padding,
        withinFrame: Object.values(padding).every(value => value >= -1)
    };
});
