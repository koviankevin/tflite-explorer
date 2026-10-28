// Supports the immutable older direct picker and the current draft manager.
export async function chooseEditDraft(page,file){
    const event=page.waitForEvent('filechooser');await page.locator('#open-edit-draft').click();
    if(await page.locator('#edit-recovery-dialog').isVisible())await page.locator('#choose-edit-draft-file').click();
    await(await event).setFiles(file);
}
