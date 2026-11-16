// Reveal the search editor through its own scroll containers. Focusing must
// never move the model canvas or enter the actual-model editing workspace.
export function revealPatternEditor(root,selector){
    root.open=true;
    root.scrollIntoView({block:'start',inline:'nearest',behavior:'instant'});
    const target=root.querySelector(selector)||root.querySelector('summary');
    target?.focus({preventScroll:true});
    target?.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
}
