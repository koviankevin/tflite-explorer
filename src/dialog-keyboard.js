// Keep modal keyboard navigation local without replacing native controls,
// activation, Escape/cancel handling or the browser's focus restoration.
export function dialogKeyboard(dialog) {
    const stop=event=>event.stopPropagation();
    dialog.addEventListener('keyup',stop);
    dialog.addEventListener('keydown',event=>{
        stop(event);
        if(event.defaultPrevented||event.isComposing||event.key!=='Tab'||event.ctrlKey||event.metaKey||event.altKey)return;
        // Resolve the live list: a file preview can enable confirmation, and
        // collapsed details, disabled fields and hidden controls must not trap.
        const controls=[...dialog.querySelectorAll('button,input,select,textarea,a[href],summary,[tabindex]')].filter(element=>{
            if(element.tabIndex<0||element.matches(':disabled')||element.closest('[inert]')||!element.getClientRects().length)return false;
            const visibility=dialog.ownerDocument.defaultView.getComputedStyle(element).visibility;
            return visibility!=='hidden'&&visibility!=='collapse';
        });
        const index=controls.indexOf(dialog.ownerDocument.activeElement);
        if(!controls.length){event.preventDefault();dialog.focus();return;}
        if(event.shiftKey?index<=0:index<0||index===controls.length-1){event.preventDefault();controls[event.shiftKey?controls.length-1:0].focus();}
    });
}
