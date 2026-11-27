"""Navigate the same visible inspector tabs that creators use."""
def reveal(page,locator):
    if not locator.count():
        return locator
    dock=locator.first.evaluate("(el)=>el.closest('.dock-section')?.id??null")
    if dock:
        if page.locator("#exitFocus").is_visible():
            page.locator("#exitFocus").click()
        if not page.locator("#assetDock").is_visible():
            page.locator("#toggleLibrary").click()
        if not page.locator("#"+dock).is_visible():
            page.locator('[data-dock="'+dock+'"]').click()
        # Dock activation opens its primary disclosure. Let explicit summary
        # actions manage that disclosure rather than toggling it twice.
    panel=locator.first.evaluate("(el)=>el.closest('.inspector-section')?.id??null")
    if panel:
        if not page.locator("#"+panel).is_visible():
            if page.locator("#exitFocus").is_visible():
                page.locator("#exitFocus").click()
            if page.locator("#toggleInspector").get_attribute("aria-pressed")=="true":
                page.locator("#toggleInspector").click()
            page.locator('[data-panel="'+panel+'"]').click()
        field=locator.first.evaluate("(el)=>el.closest('[data-brush-for]')?.hidden===true")
        if field:
            page.locator("#showBrushOptions").click()
    # The newly nested manual-binding group is advanced but remains reachable.
    manual=locator.first.evaluate("(el)=>{const d=el.closest('details');return d?.querySelector(':scope > summary')?.textContent==='Manual asset binding (advanced)'&&!d.open}")
    if manual:
        page.locator("summary",has_text="Manual asset binding (advanced)").click()
    return locator

def control(page,selector,**kwargs):
    return reveal(page,page.locator(selector,**kwargs))
