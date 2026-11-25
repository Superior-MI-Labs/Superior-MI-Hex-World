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
    alpha=page.evaluate("""async () => {
      const {createRenderer}=await import('/src/gpu.mjs');
      const c=document.createElement('canvas');c.width=c.height=64;
      const r=createRenderer(c),view=([x,y,depth])=>({x,y,depth});
      const img=document.createElement('canvas');img.width=img.height=1;
      const ctx=img.getContext('2d');ctx.fillStyle='rgba(255,0,0,0.5)';ctx.fillRect(0,0,1,1);
      const face={points:[[0,0,1],[64,0,1],[0,64,1]],kind:'top',color:[0,1,0]};
      const sprite=d=>({image:img,revision:0,points:[[5,5,d],[35,5,d],[35,35,d],[5,35,d]]});
      r.render([face],view,{pattern:false,sprites:[sprite(2)],softSprites:true});
      const front=r.readPixel(10,10);
      r.render([face],view,{pattern:false,sprites:[sprite(0)],softSprites:true});
      return {front,behind:r.readPixel(10,10)};
    }""")
    assert 100<alpha["front"][0]<155 and 100<alpha["front"][1]<155,alpha
    assert alpha["behind"][0]<10 and alpha["behind"][1]>240,alpha
    shadow=page.evaluate("""async () => {
      const {createRenderer}=await import('/src/gpu.mjs');
      const c=document.createElement('canvas');c.width=c.height=64;
      const r=createRenderer(c),view=([x,y,depth])=>({x,y,depth});
      const face={points:[[0,0,1],[64,0,1],[0,64,1]],kind:'top',color:[1,1,1]};
      const s={points:face.points,uv:[[0,0],[2,0],[0,2]],opacity:.5};
      r.render([face],view,{pattern:false,shadows:[s]});const dark=r.readPixel(16,16),clear=r.readPixel(3,3);
      const cover={...face,points:face.points.map(([x,y])=>[x,y,2]),color:[0,1,0]};
      r.render([face,cover],view,{pattern:false,shadows:[s]});return {dark,clear,hidden:r.readPixel(16,16)};
    }""")
    assert 110<shadow["dark"][0]<150 and shadow["clear"][0]>240,shadow
    assert shadow["hidden"][1]>240 and shadow["hidden"][0]<10,shadow
    # Verify the coverage gradient and exact zero/full endpoints in actual GPU pixels.
    coverage=page.evaluate("""async () => {
      const {createRenderer}=await import('/src/gpu.mjs');
      const c=document.createElement('canvas');c.width=c.height=64;
      const r=createRenderer(c),view=([x,y,depth])=>({x,y,depth});
      const attr=(snow,rim=-1)=>({color:[0,1,0],cover:[0,snow,0],rim});
      const face={points:[[5,5,1],[60,5,1],[5,60,1]],kind:'top',color:[0,1,0]};
      r.render([{...face,attributes:[attr(0),attr(1),attr(0)]}],view,{pattern:false,debug:true});
      const gradient=[r.readPixel(8,8),r.readPixel(54,8)];
      r.render([{...face,attributes:[attr(1),attr(1),attr(1)]}],view,{pattern:false});
      const snow=r.readPixel(15,15);
      r.render([{...face,attributes:[attr(0),attr(0),attr(0)]}],view,{pattern:false});
      const grass=r.readPixel(15,15);
      r.render([{...face,kind:'side',attributes:[attr(1,0),attr(1,5),attr(1,0)]}],view,{pattern:false,debug:true});
      return {gradient,snow,grass,rim:[r.readPixel(8,8),r.readPixel(54,8)]};
    }""")
    assert coverage["gradient"][0][1]<40 and coverage["gradient"][1][1]>200,coverage
    assert coverage["snow"][0]>220 and coverage["snow"][2]>235,coverage
    assert coverage["grass"][1]>240 and coverage["grass"][0]<10,coverage
    assert coverage["rim"][0][1]>200 and coverage["rim"][1][1]<10,coverage
    page.wait_for_function("document.querySelector('#artStatus').textContent === 'Atlas meadow fixture loaded'")
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).art_style === 'fantasy-meadow-fixture'")
    page.locator("#artStyle").uncheck()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).art_style === null")
    page.locator("#artStyle").check()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).art_style === 'fantasy-meadow-fixture'")
    page.wait_for_function("document.querySelector('#maskStatus').textContent === 'Atlas transition mask loaded'")
    page.locator("#transitionDemo").select_option("snow")
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).transition_triangles > 0")
    page.locator("#transitionDebug").check()
    page.locator("#transitionDebug").uncheck()
    page.locator("#transitions").uncheck()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).transitions === false")
    page.locator("#transitions").check()
    page.get_by_role("button",name="Reset terrain").click()
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
    box=page.locator("#scene").bounding_box()
    page.mouse.move(box["x"]+box["width"]/2,box["y"]+box["height"]/2)
    page.mouse.down(button="middle")
    page.mouse.move(box["x"]+box["width"]/2+50,box["y"]+box["height"]/2+20)
    page.mouse.up(button="middle")
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).camera.panX > 0")
    page.get_by_role("button",name="Reset view").click()
    page.on("dialog",lambda d:d.accept())
    page.locator("#worldMode").select_option("exploration")
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).world_mode==='exploration'",timeout=60000)
    initial=page.evaluate("JSON.parse(document.querySelector('#status').textContent).resident_chunks")
    page.get_by_role("button",name="Half",exact=True).click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).cell.shape.upper.every(v=>v===1)")
    box=page.locator("#scene").bounding_box()
    page.mouse.move(box["x"]+box["width"]/2,box["y"]+box["height"]/2)
    page.mouse.down(button="middle")
    page.mouse.move(box["x"]+box["width"]/2+3500,box["y"]+box["height"]/2)
    page.mouse.up(button="middle")
    page.wait_for_function("(n)=>JSON.parse(document.querySelector('#status').textContent).resident_chunks>n",arg=initial,timeout=60000)
    page.get_by_role("button",name="Reset view").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).camera.panX===0 && JSON.parse(document.querySelector('#status').textContent).cell.shape.upper.every(v=>v===1)",timeout=60000)
    # Return to a deterministic island for construction and persistent object tests.
    page.locator("#worldMode").select_option("island")
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).world_mode==='island'")
    page.locator("#prefab").select_option("stone-gate")
    page.locator("#previewPrefab").check()
    assert page.locator("#placePrefab").is_enabled()
    page.locator("#placePrefab").click()
    assert page.locator("#placePrefab").is_disabled()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).world_objects===1")
    page.locator("#placeActor").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).world_objects===2")
    page.locator("#removeObject").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).world_objects===1")
    with page.expect_download() as download:
        page.locator("#save").click()
    save=download.value.path()
    data=json.loads(Path(save).read_text())
    assert len(data["entities"])==1
    assert sum(1 for c in data["chunks"] for e in c["cells"] if e["value"]["material"]=="stone")==5
    page.locator("#load").set_input_files(str(save))
    page.wait_for_function("document.querySelector('#message').textContent==='World imported'")
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).world_objects===1")
    # Capture explicit geometry, export, and verify persisted standalone effects.
    page.locator("#captureCell").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).capture_cells===1")
    with page.expect_download() as prefab_download:
        page.locator("#exportPrefab").click()
    prefab_data=json.loads(Path(prefab_download.value.path()).read_text())
    assert len(prefab_data["cells"])==1
    page.locator("#mode").select_option("manual")
    page.locator("#fire").click()
    page.locator("#timed").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).active_effects===2")
    with page.expect_download() as effect_download:
        page.locator("#save").click()
    saved=effect_download.value.path()
    page.locator("#load").set_input_files(str(saved))
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).active_effects===2")
    page.locator("#step").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).active_effects===1")
    page.locator("#extinguish").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).world_effects===0")
    # New island: choose a neighboring floor through the actual renderer and move.
    page.get_by_role("button",name="Reset terrain").click()
    page.locator("#movingObject").select_option("demo-actor")
    xy=page.evaluate("""async () => {
      const {project}=await import('/src/camera.mjs');
      return project([5,0,5]);
    }""")
    box=page.locator("#scene").bounding_box()
    page.mouse.click(box["x"]+xy["x"]*box["width"]/900,box["y"]+xy["y"]*box["height"]/450)
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).selected.join(',')==='1,0,0'")
    page.locator("#previewRoute").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).route_steps===1")
    page.locator("#moveObject").click()
    with page.expect_download() as moved:
        page.locator("#save").click()
    assert json.loads(Path(moved.value.path()).read_text())["entities"][0]["address"]==[1,0,0]
    page.locator("#contactShadows").uncheck()
    page.locator("#contactShadows").check()
    page.screenshot(path="/tmp/hex-world-qa.png",full_page=True)
    assert not errors,errors
    print("GPU depth, Atlas sprite load, vertical construction and browser smoke passed")
    browser.close()
