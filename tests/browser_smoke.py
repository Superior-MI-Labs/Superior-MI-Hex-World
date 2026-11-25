import json
from pathlib import Path
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    browser=p.chromium.launch(args=["--use-angle=swiftshader","--enable-unsafe-swiftshader"])
    page=browser.new_page(viewport={"width":1200,"height":1000})
    errors=[]
    page.on("pageerror",lambda e: errors.append(str(e)))
    page.goto("http://127.0.0.1:8000/")
    page.wait_for_function("document.querySelector('#status').textContent.includes('WebGL2')")
    page.wait_for_function("document.querySelector('#assetStatus').textContent === 'Atlas sprite loaded'")
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).atlas_sprite")
    # Verify actual GPU depth with deliberately overlapping triangles and both orders.
    result=page.evaluate("""async () => {
      const {createRenderer}=await import('/src/gpu.mjs');
      const c=document.createElement('canvas');c.width=c.height=64;
      const r=createRenderer(c), view=([x,y,depth])=>({x,y,depth});
      const tri=(d,color)=>({points:[[5,5,d],[60,5,d],[5,60,d]],color,kind:'top'});
      const far=tri(1,[1,0,0]),near=tri(2,[0,1,0]);
      return [[far,near],[near,far]].map(f=>{r.render(f,view,{pattern:false});return r.readPixel(15,15);});
    }""")
    assert all(c[1]>240 and c[0]<10 for c in result),result
    assert page.locator("#resolution").count()==0
    page.get_by_role("button",name="Reactive fire").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).cell.components.surface.burn===8")
    page.get_by_role("button",name="Advance 6 seconds").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).cell.components.surface.burn===8")
    page.locator("#mode").select_option("manual")
    page.get_by_role("button",name="Advance 6 seconds").click()
    page.get_by_role("button",name="Advance 6 seconds").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).cell.components.surface.scorch===1")
    page.locator("#level").select_option("1")
    page.get_by_role("button",name="Full",exact=True).click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).selected[2]===1 && JSON.parse(document.querySelector('#status').textContent).cell.material==='soil'")
    # Select the visible front side of the new upper cell, not its top.
    xy=page.evaluate("""async () => {
      const {project}=await import('/src/camera.mjs');
      return project([1.25,2.165063509,7.5]);
    }""")
    box=page.locator("#scene").bounding_box()
    page.mouse.click(box["x"]+xy["x"]*box["width"]/900,box["y"]+xy["y"]*box["height"]/450)
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).face==='side:0'")
    assert page.locator("#vertex option").count()==4
    page.locator("#connected").uncheck()
    page.locator("#vertex").select_option("upper:0")
    page.locator("#height").fill("1")
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).cell.shape.upper[0]===1")
    page.locator("#vertex").select_option("lower:0")
    # Drag the actual lower handle past its paired upper vertex.
    handle=page.evaluate("""() => JSON.parse(document.querySelector('#status').textContent).handles.find(h=>h.layer==='lower'&&h.index===0)""")
    page.mouse.move(box["x"]+handle["x"]*box["width"]/900,box["y"]+handle["y"]*box["height"]/450)
    page.mouse.down()
    page.mouse.move(box["x"]+handle["x"]*box["width"]/900,box["y"]+(handle["y"]-150)*box["height"]/450,steps=5)
    page.mouse.up()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).cell.shape.lower[0]===1")
    assert page.locator("#height").get_attribute("max")=="1"
    page.locator("#surface").select_option("lower")
    assert page.locator("#vertex option").count()==7
    page.locator("#surface").select_option("upper")
    assert page.locator("#vertex option").count()==7
    page.locator("#actorState").select_option("walk")
    page.locator("#loadActor").click()
    page.wait_for_function("document.querySelector('#assetStatus').textContent === 'Atlas sprite loaded'")
    page.get_by_role("button",name="Rotate 60°").click()
    page.screenshot(path="/tmp/hex-world-qa.png",full_page=True)
    assert not errors,errors
    print("GPU depth, Atlas sprite load, vertical construction and browser smoke passed")
    browser.close()
