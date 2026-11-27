"""Navigate the same visible inspector tabs that creators use."""
def reveal(page,locator):
    if not locator.count():
        return locator
    panel=locator.first.evaluate("(el)=>el.closest('.inspector-section')?.id??null")
    if panel:
        if not page.locator("#"+panel).is_visible():
            page.locator('[data-panel="'+panel+'"]').click()
        field=locator.first.evaluate("(el)=>el.closest('[data-brush-for]')?.hidden===true")
        if field:
            page.locator("#showBrushOptions").click()
    return locator

def control(page,selector,**kwargs):
    return reveal(page,page.locator(selector,**kwargs))
