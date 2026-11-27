import json
import hashlib
from io import BytesIO
from zipfile import ZipFile
from pathlib import Path
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    browser=p.chromium.launch(args=["--use-angle=swiftshader","--enable-unsafe-swiftshader"])
    page=browser.new_page(viewport={"width":1200,"height":1000})
    errors=[]
    page.on("pageerror",lambda e: errors.append(str(e)))
    page.goto("http://127.0.0.1:8000/")
    page.wait_for_function("document.querySelector('#status').textContent.includes('WebGL2')")
    assert page.evaluate("JSON.parse(document.querySelector('#status').textContent).camera.alignment_deg")==30
    page.locator("#cameraAlignment").select_option("0")
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).camera.alignment_deg===0")
    page.wait_for_function("document.querySelector('#assetStatus').textContent === 'Atlas sprite loaded'")
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).atlas_sprite")
    # Directional fixture uses existing measured grass regions as view IDs, not authored view art.
    vb={"manifest":"./examples/meadow-art/manifest.json","asset":"smi.hex.grass.01"}
    page.locator("#importObjectBinding").set_input_files({"name":"views.json","mimeType":"application/json","buffer":json.dumps(vb).encode()})
    page.wait_for_function("document.querySelector('#assetStatus').textContent === 'Atlas sprite loaded'")
    page.wait_for_function("document.querySelector('#spatialStatus').textContent.includes('2.5 ft · 6 views · wind-responsive')")
    page.locator("#placeActor").click()
    page.locator("#objects").select_option(index=1)
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).selected_object_view==='smi.hex.grass.01'")
    page.locator("#rotateObject").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).selected_object_view==='smi.hex.grass.03'")
    page.locator("#rotate").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).selected_object_view==='smi.hex.grass.01'")
    page.locator("#removeObject").click()
    page.locator("#resetView").click()
    page.locator("#loadActor").click()
    page.wait_for_function("document.querySelector('#assetStatus').textContent === 'Atlas sprite loaded'")
    # Real shared ZIP reader, canonical composition and independent input/slot choices.
    stream=BytesIO()
    root=Path("examples/chest-fixture")
    with ZipFile(stream,"w") as z:
        z.write(root/"manifest.json","manifest.json")
        z.write(root/"textures/chest.png","textures/chest.png")
    payload=stream.getvalue()
    page.route("**/chest-test.zip",lambda route: route.fulfill(body=payload,content_type="application/zip"))
    digest=hashlib.sha256(payload).hexdigest()
    chest=page.evaluate("""async digest => {
      const {createAtlasRaster}=await import('/src/assets.mjs');
      const base={manifest:'./chest-test.zip',archive_sha256:digest,asset:'fixture.chest'};
      async function draw(inputs,slots,preset='closed'){
        const r=await createAtlasRaster({...base,inputs,slots,preset});await r.update(0);
        return Array.from(r.image.getContext('2d').getImageData(0,0,64,64).data);
      }
      const gold={contents:'fixture.chest.gold'},gems={contents:'fixture.chest.gems'};
      const closedGold=await draw({open:false},gold),closedGems=await draw({open:false},gems);
      const openGold=await draw({open:true},gold),openGems=await draw({open:true},gems);
      const equal=(a,b)=>a.every((v,i)=>v===b[i]);
      let invalid=false,badHash=false,badInput=false;
      try{await draw({open:true},{contents:'fixture.chest.front'});}catch(e){invalid=true;}
      try{await draw({open:42},gold);}catch(e){badInput=true;}
      try{await createAtlasRaster({...base,archive_sha256:'0'.repeat(64)});}catch(e){badHash=e.message.includes('SHA-256');}
      return {closedSame:equal(closedGold,closedGems),openDifferent:!equal(openGold,openGems),preset:equal(openGold,await draw({},gold,'treasure')),invalid,badHash,badInput};
    }""",digest)
    assert all(chest.values()),chest
    catalog={"schema":"smi-public-catalog/1","packs":[{"id":"fixture","zip":"demo/chest-test.zip","archive_sha256":digest}],"assets":[{"id":"fixture.chest","name":"Chest","pack":"fixture","kind":"composition","capabilities":["world-use","compatible-slots"],"license":"CC0-1.0"}]}
    page.route("**/test-catalog.json",lambda route: route.fulfill(json=catalog))
    page.locator("summary",has_text="Browse published Atlas assets").click()
    page.locator("#catalogURL").fill("http://127.0.0.1:8000/test-catalog.json")
    page.locator("#refreshCatalog").click()
    page.wait_for_function("document.querySelector('#catalogAssets').options.length===1")
    page.locator("#catalogCapability").select_option("world-use")
    page.locator("#loadCatalogAsset").click()
    page.wait_for_function("document.querySelector('#assetStatus').textContent === 'Atlas sprite loaded'")
    page.locator("#loadChest").click()
    page.wait_for_function("document.querySelector('#assetStatus').textContent === 'Atlas sprite loaded'")
    page.locator("#placeActor").click()
    page.locator("#objects").select_option(index=1)
    page.wait_for_selector("#generatedPreset")
    page.locator("#generatedPreset").select_option("treasure")
    page.locator("[data-visual-slot=contents]").select_option("fixture.chest.gems")
    page.locator("#applyAppearance").click()
    page.wait_for_function("document.querySelector('#appearanceStatus').textContent === 'Appearance applied'")
    # Host opts into a physical condition using the existing authored boolean.
    page.locator("#colliderRadius").fill("1")
    page.locator("#colliderHeight").fill("3")
    page.locator("#colliderInput").fill("open")
    page.locator("#colliderEquals").fill("true")
    page.locator("#applyCollider").click()
    page.wait_for_function("document.querySelector('#colliderStatus').textContent==='Collider applied'")
    assert page.locator("#colliderActive").text_content()=="Disabled by input"
    with page.expect_download() as appearance_save:
        page.locator("#save").click()
    saved=json.loads(Path(appearance_save.value.path()).read_text())
    assert next(e for e in saved["entities"] if e["visual"]["asset"]=="fixture.chest")["visual"]["slots"]["contents"]=="fixture.chest.gems"
    page.locator("summary",has_text="Spatial interactions").click()
    page.locator("#movingObject").select_option(index=0)
    page.locator("#useObject").click()
    page.wait_for_function("document.querySelector('#interactionStatus').textContent.includes('visual use applied')")
    page.wait_for_function("JSON.parse(document.querySelector('#objectAppearance').value).inputs.open===false")
    assert page.locator("#colliderActive").text_content()=="Blocking"
    page.locator("#useObject").click()
    page.wait_for_function("JSON.parse(document.querySelector('#objectAppearance').value).inputs.open===true")
    assert page.locator("#colliderActive").text_content()=="Disabled by input"
    page.locator("summary",has_text="Spatial interactions").click()
    page.locator("#removeObject").click()
    page.locator("#loadActor").click()
    page.wait_for_function("document.querySelector('#assetStatus').textContent === 'Atlas sprite loaded'")
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
    materials=page.evaluate("""async () => {
      const {createRenderer}=await import('/src/gpu.mjs');
      const c=document.createElement('canvas');c.width=c.height=64;
      const r=createRenderer(c),view=([x,y,depth])=>({x,y,depth});
      function img(color){const a=document.createElement('canvas');a.width=a.height=2;const x=a.getContext('2d');x.fillStyle=color;x.fillRect(0,0,2,2);return a;}
      r.setTerrainDetail('top',img('#ff0000'));
      r.setTerrainDetail('top',img('#0000ff'),'stone');
      const style={detail:{repeat_ft:5,strength:1,color_mode:'albedo',materials:{stone:{top:'stone'}}}};
      const attr=materialWeights=>({color:[0,1,0],cover:[0,0,0],rim:-1,materialWeights});
      const face={kind:'top',material:'soil',points:[[0,0,1],[64,0,1],[0,64,1]],attributes:[attr([['soil',1]]),attr([['stone',1]]),attr([['soil',1]])]};
      r.render([face],view,{style});
      const gradient=[r.readPixel(3,3),r.readPixel(31,3),r.readPixel(59,2)];
      r.setTerrainDetail("top",img("#00ff00"),"grass");r.setTerrainDetail("top",img("#ffffff"),"snow");
      style.detail.materials.grass={top:"grass"};style.detail.materials.snow={top:"snow"};
      const mixed=attr([["soil",.25],["stone",.25],["grass",.25],["snow",.25]]);
      r.render([{...face,attributes:[mixed,mixed,mixed]}],view,{style});return {gradient,mixed:r.readPixel(10,10)};
    }""")
    gradient=materials["gradient"]
    assert gradient[0][0]>230 and gradient[0][2]<25,materials
    assert 105<gradient[1][0]<150 and 105<gradient[1][2]<150,materials
    assert gradient[2][2]>225 and gradient[2][0]<30,materials
    assert all(120<v<136 for v in materials["mixed"][:3]),materials
    # Water blends over the bed and respects opaque depth; flow uses visual time.
    liquid=page.evaluate("""async () => {
      const {createRenderer}=await import('/src/gpu.mjs');
      const c=document.createElement('canvas');c.width=c.height=64;
      const r=createRenderer(c),view=([x,y,depth])=>({x,y,depth});
      const tri=(z,color)=>({kind:'top',points:[[0,0,z],[64,0,z],[0,64,z]],color});
      const bed=tri(1,[.4,.4,.4]),water={points:tri(2).points,flow:[1,0],depth:[2,2,2]};
      r.render([bed],view,{pattern:false,water:[water]});const wet=r.readPixel(10,10);
      r.render([bed],view,{pattern:false,water:[water],visualTime:1.3});const moved=r.readPixel(10,10);
      r.render([bed,tri(3,[1,0,0])],view,{pattern:false,water:[water]});const blocked=r.readPixel(10,10);
      r.render([bed],view,{pattern:false});return {wet,moved,blocked,dry:r.readPixel(10,10)};
    }""")
    assert liquid["wet"][2]>liquid["wet"][0] and liquid["wet"]!=liquid["dry"],liquid
    assert liquid["blocked"][0]>240 and liquid["blocked"][2]<10,liquid
    assert liquid["wet"]!=liquid["moved"],liquid
    # Per-fragment local light illuminates terrain and sprites in world space.
    local_light=page.evaluate("""async () => {
      const {createRenderer}=await import('/src/gpu.mjs');
      const c=document.createElement('canvas');c.width=c.height=64;
      const r=createRenderer(c),view=([x,y,depth])=>({x,y,depth});
      const face={kind:'top',points:[[0,0,1],[64,0,1],[0,64,1]],color:[.5,.5,.5]};
      const light={point:[12,12,1],radius:12,color:[1,0,0],intensity:1};
      const lighting={ambient:.2,direction:[1,0,0],sprite_strength:1};
      r.render([face],view,{pattern:false,lighting,pointLights:[light]});
      const center=r.readPixel(12,12),far=r.readPixel(30,12);
      r.render([face],view,{pattern:false,lighting});const off=r.readPixel(12,12);
      const img=document.createElement('canvas');img.width=img.height=1;const ctx=img.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,1,1);
      const actor={image:img,revision:0,points:[[5,5,2],[20,5,2],[20,20,2],[5,20,2]]};
      r.render([face],view,{pattern:false,lighting,sprites:[actor],pointLights:[light]});const sprite=r.readPixel(12,12);
      r.render([face],view,{pattern:false,lighting,sprites:[{...actor,emissive:1}]});const emissive=r.readPixel(12,12);
      return {center,far,off,sprite,emissive};
    }""")
    assert local_light["center"][0]>120 and local_light["center"][1]<35,local_light
    assert local_light["far"]==local_light["off"],local_light
    assert local_light["sprite"][0]>240 and local_light["sprite"][1]<180,local_light
    assert all(v>245 for v in local_light["emissive"][:3]),local_light
    # Lighting also shades full snow coverage and preserves unlit debug colors.
    lit=page.evaluate("""async () => {
      const {createRenderer}=await import('/src/gpu.mjs');
      const c=document.createElement('canvas');c.width=c.height=64;
      const r=createRenderer(c),view=([x,y,depth])=>({x,y,depth});
      const face={kind:'top',points:[[0,0,1],[64,0,1],[0,64,1]],color:[1,1,1],cover:[0,1,0],occlusion:[1,1,1]};
      const lighting={ambient:.5,direction:[1,0,0],occlusion:.4,sprite_strength:.5,shadow_strength:.5};
      r.render([face],view,{pattern:false,lighting});const snow=r.readPixel(10,10);
      r.render([face],view,{pattern:false,lighting,debug:true});const debug=r.readPixel(10,10);
      const img=document.createElement('canvas');img.width=img.height=1;const ctx=img.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,1,1);
      r.render([face],view,{pattern:false,lighting,sprites:[{image:img,revision:0,points:[[5,5,2],[35,5,2],[35,35,2],[5,35,2]]}]});
      return {snow,debug,sprite:r.readPixel(10,10)};
    }""")
    assert all(60<v<85 for v in lit["snow"][:3]),lit
    assert lit["debug"][1]>240,lit
    assert all(210<v<235 for v in lit["sprite"][:3]),lit
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
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).scatter_instances>0")
    page.locator("#scatter").uncheck()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).scatter_instances===0")
    page.locator("#scatter").check()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).scatter_instances>0")
    page.locator("summary",has_text="World lighting").click()
    page.locator("#sunAzimuth").fill("90")
    page.locator("#sunElevation").fill("35")
    page.locator("#sunAmbient").fill(".4")
    page.locator("#applyLighting").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).lighting.ambient===0.4")
    page.locator("#resetLighting").click()
    page.wait_for_function("document.querySelector('#lightStatus').textContent==='Style lighting'")
    page.locator("summary",has_text="World lighting").click()
    page.locator("#windSpeed").fill("20")
    page.locator("#applyWind").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).wind_bent_sprites>0 && JSON.parse(document.querySelector('#status').textContent).wind_state_sprites>0")
    page.locator("#shelterWind").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).selected_wind.velocity_ft_s[0]===0")
    page.locator("#windVisual").uncheck()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).wind_bent_sprites===0")
    page.locator("#windVisual").check()
    page.locator("#clearWind").click()
    page.locator("#windSpeed").fill("0")
    page.locator("#applyWind").click()
    page.locator("#season").select_option("autumn")
    page.locator("#applyClimate").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).seasonal_sprites>0")
    page.locator("#season").select_option("winter")
    page.locator("#localClimate").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).selected_climate.season==='winter'")
    page.locator("#clearClimate").click()
    page.locator("#season").select_option("summer")
    page.locator("#applyClimate").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).seasonal_sprites===0")
    page.locator("#artURL").fill("./examples/no-such-style.json")
    page.locator("#loadArt").click()
    page.wait_for_function("document.querySelector('#artStatus').textContent.startsWith('Previous style retained:')")
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).art_style === 'fantasy-meadow-fixture'")
    page.locator("#resetArt").click()
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
    page.locator("#scene").scroll_into_view_if_needed()
    box=page.locator("#scene").bounding_box()
    page.mouse.click(box["x"]+xy["x"]*box["width"]/900,box["y"]+xy["y"]*box["height"]/450)
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).face==='side:0'")
    assert page.locator("#vertex option").count()==4
    page.locator("#connected").uncheck()
    page.locator("#vertex").select_option("upper:0")
    page.locator("#height").fill("1")
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).cell.shape.upper[0]===1")
    page.locator("#vertex").select_option("lower:0")
    # Control interactions may scroll the page. Re-read the canvas rectangle
    # after selecting the lower handle, rather than reusing pre-scroll pixels.
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).vertex.layer==='lower' && JSON.parse(document.querySelector('#status').textContent).vertex.index===0")
    page.locator("#scene").scroll_into_view_if_needed()
    box=page.locator("#scene").bounding_box()
    # Drag the actual lower handle past its paired upper vertex.
    handle=page.evaluate("""() => JSON.parse(document.querySelector('#status').textContent).handles.find(h=>h.layer==='lower'&&h.index===0)""")
    hx=box["x"]+handle["x"]*box["width"]/900
    hy=box["y"]+handle["y"]*box["height"]/450
    assert page.evaluate("([x,y])=>document.elementFromPoint(x,y)?.id", [hx,hy])=="scene", (box,handle)
    page.mouse.move(hx,hy)
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
    page.locator("#scene").scroll_into_view_if_needed()
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
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).performance.terrain_cache_hit===true",timeout=60000)
    page.wait_for_function("(()=>{const p=JSON.parse(document.querySelector('#status').textContent).performance;return p.terrain_cache_hit===true&&p.terrain_uploads===0&&p.terrain_ms<20})()",timeout=60000)
    print("MEADOW_PROFILE_SETTLED",page.evaluate("JSON.parse(document.querySelector('#status').textContent).performance"))
    initial=page.evaluate("JSON.parse(document.querySelector('#status').textContent).resident_chunks")
    page.get_by_role("button",name="Half",exact=True).click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).cell.shape.upper.every(v=>v===1)")
    page.locator("#scene").scroll_into_view_if_needed()
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
    page.locator("#scene").scroll_into_view_if_needed()
    box=page.locator("#scene").bounding_box()
    page.mouse.click(box["x"]+xy["x"]*box["width"]/900,box["y"]+xy["y"]*box["height"]/450)
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).selected.join(',')==='1,0,0'")
    page.locator("#previewRoute").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).route_steps===1")
    page.locator("summary",has_text="Spatial interactions").click()
    page.locator("#cellTags").fill("sensor, usable")
    page.locator("#setCellTags").click()
    page.locator("#useCell").click()
    assert "environment.use" in page.locator("#interactionStatus").text_content()
    custom={"schema":"smi-hex-interactions/1","rules":[{"id":"custom-use","event":"use","match":{"kind":"cell","tags":["usable"]},"signal":"custom.test"}]}
    page.locator("#importInteractions").set_input_files({"name":"custom.json","mimeType":"application/json","buffer":json.dumps(custom).encode()})
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).interaction_rules===1")
    page.locator("#useCell").click()
    assert "custom.test" in page.locator("#interactionStatus").text_content()
    page.locator("#resetInteractions").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).interaction_rules===7")
    page.locator("#moveObject").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).interaction_events.some(e=>e.signals.some(s=>s.signal==='environment.sensor.enter'))")
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).bent_sprites>0")
    with page.expect_download() as moved:
        page.locator("#save").click()
    assert json.loads(Path(moved.value.path()).read_text())["entities"][0]["address"]==[1,0,0]
    page.locator("#contactShadows").uncheck()
    page.locator("#contactShadows").check()
    page.locator("#worldMode").select_option("settlement")
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).world_mode==='settlement'")
    assert page.locator("#cutaway").input_value()=="all"
    page.locator("#cutaway").select_option("0")
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).cutaway===0")
    page.locator("#movingObject").select_option("demo-actor")
    xy=page.evaluate("""async () => {
      const {project}=await import('/src/camera.mjs');
      const camera=JSON.parse(document.querySelector('#status').textContent).camera;
      return project([0,0,5],camera);
    }""")
    page.locator("#scene").scroll_into_view_if_needed()
    box=page.locator("#scene").bounding_box()
    page.mouse.click(box["x"]+xy["x"]*box["width"]/900,box["y"]+xy["y"]*box["height"]/450)
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).selected.join(',')==='0,0,0'")
    page.locator("#localCut").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).cutaway_center?.join(',')==='0,0'")
    page.locator("#checkSight").click()
    assert page.locator("#sightStatus").text_content()=="clear"
    page.locator("#previewRoute").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).route_steps===2")
    page.locator("#moveObject").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).moving_presentations===0")
    with page.expect_download() as settlement_save:
        page.locator("#save").click()
    saved=json.loads(Path(settlement_save.value.path()).read_text())
    assert saved["world"]["scene"]=="settlement-v1"
    assert next(e for e in saved["entities"] if e["id"]=="demo-actor")["address"]==[0,0,0]
    page.locator("#cutaway").select_option("all")
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).cutaway===null")
    page.screenshot(path="/tmp/hex-world-qa.png",full_page=True)
    # Fresh island, guaranteed visible scatter fixture. Explicit promotion must save
    # an entity and suppress exactly one decorative sample, even after deletion.
    page.goto("http://127.0.0.1:8000/")
    page.locator("#cameraAlignment").select_option("0")
    page.wait_for_function("document.querySelector('#artStatus').textContent === 'Atlas meadow fixture loaded'")
    promotion_style=json.loads(Path("examples/meadow-style.json").read_text())
    promotion_style["id"]="promotion-browser-fixture"
    family=promotion_style["vegetation"]["families"][0]
    family["density"]=1
    family["spacing_ft"]=0
    promotion_style["vegetation"]["families"]=[family]
    page.route("**/promotion-test.json",lambda route: route.fulfill(json=promotion_style))
    page.locator("#artURL").fill("./examples/promotion-test.json")
    page.locator("#loadArt").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).art_style==='promotion-browser-fixture'")
    page.wait_for_function("document.querySelector('#scatterChoice').options.length===6")
    count=page.evaluate("JSON.parse(document.querySelector('#status').textContent).scatter_candidates")
    key=page.locator("#scatterChoice").input_value()
    page.locator("#promoteScatter").click()
    page.wait_for_function("n=>{const s=JSON.parse(document.querySelector('#status').textContent);return s.world_objects===2&&s.scatter_candidates===n-1}",arg=count)
    with page.expect_download() as promoted:
        page.locator("#save").click()
    saved=json.loads(Path(promoted.value.path()).read_text())
    assert len(saved["entities"])==2
    assert any(key in c["value"].get("components",{}).get("scatter_hidden",[]) for chunk in saved["chunks"] for c in chunk["cells"])
    page.locator("#objects").select_option(index=1)
    page.locator("#colliderRadius").fill("1.25")
    page.locator("#colliderHeight").fill("3")
    page.locator("#applyCollider").click()
    assert page.locator("#colliderStatus").text_content()=="Collider applied"
    page.locator("#showColliders").check()
    page.locator("summary",has_text="Object light source").click()
    page.locator("#applyObjectLight").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).point_lights>0")
    page.locator("#pointLights").uncheck()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).point_lights===0")
    page.locator("#pointLights").check()
    with page.expect_download() as physical_save:
        page.locator("#save").click()
    physical=json.loads(Path(physical_save.value.path()).read_text())
    assert next(e for e in physical["entities"] if e["id"]!="demo-actor")["collider"]=={"kind":"cylinder","radius_ft":1.25,"height_ft":3}
    assert next(e for e in physical["entities"] if e["id"]!="demo-actor")["light"]["radius_ft"]==12
    page.locator("#removeObjectLight").click()
    page.locator("#showColliders").uncheck()
    page.locator("#removeObject").click()
    page.wait_for_function("n=>{const s=JSON.parse(document.querySelector('#status').textContent);return s.world_objects===1&&s.scatter_candidates===n-1}",arg=count)
    page.get_by_role("button",name="Basin",exact=True).click()
    page.locator("summary",has_text="Water editing").click()
    page.locator("#waterFill").fill(".5")
    page.locator("#waterFlowX").fill("2")
    page.locator("#applyWater").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).water_triangles>0")
    with page.expect_download() as water_save:
        page.locator("#save").click()
    saved=json.loads(Path(water_save.value.path()).read_text())
    assert any(c["value"].get("components",{}).get("water")=={"fill":.5,"flow_ft_s":[2,0]} for chunk in saved["chunks"] for c in chunk["cells"])
    page.locator("#showWater").uncheck()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).water_triangles===0")
    page.locator("#showWater").check()
    page.locator("#drainWater").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).water_triangles===0")
    # Fill an empty cell above the island; simulation must follow the manual
    # clock, not elapsed visual frames, and persist its opt-in setting.
    page.locator("#level").select_option("1")
    page.locator("#waterFill").fill(".8")
    page.locator("#applyWater").click()
    page.locator("#simulateWater").check()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).water_simulation")
    page.locator("#mode").select_option("frozen")
    page.locator("#step").click()
    assert page.evaluate("JSON.parse(document.querySelector('#status').textContent).cell.components.water.fill")==.8
    page.locator("#mode").select_option("manual")
    page.locator("#step").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).cell.components.water.fill<0.8")
    with page.expect_download() as flow_save:
        page.locator("#save").click()
    assert json.loads(Path(flow_save.value.path()).read_text())["world"]["environment"]["water_simulation"] is True
    # Verify keyboard controls and actual batch edits through pointer selection.
    page.goto("http://127.0.0.1:8000/")
    page.locator("#cameraAlignment").select_option("0")
    page.wait_for_function("document.querySelector('#status').textContent.includes('WebGL2')")
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).world_mode==='island'")
    scene=page.locator("#scene")
    scene.scroll_into_view_if_needed()
    xy=page.evaluate("""async () => {const {project}=await import('/src/camera.mjs');return project([5,0,5]);}""")
    box=scene.bounding_box()
    page.keyboard.down("Shift")
    page.mouse.click(box["x"]+xy["x"]*box["width"]/900,box["y"]+xy["y"]*box["height"]/450)
    page.keyboard.up("Shift")
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).selection.length===2")
    page.get_by_role("button",name="Half",exact=True).click()
    with page.expect_download() as batch:
        page.locator("#save").click()
    data=json.loads(Path(batch.value.path()).read_text())
    cells={tuple(c["address"][i]*16+v for i,v in enumerate(e["local"])):e["value"] for c in data["chunks"] for e in c["cells"]}
    assert all(cells[a]["shape"]["upper"]==[1]*7 for a in [(0,0,0),(1,0,0)])
    page.locator("#undoEdit").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).cell.shape.upper.every(v=>v===2)")
    page.locator("#redoEdit").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).cell.shape.upper.every(v=>v===1)")
    page.locator("#clearSelection").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).selection.length===1")
    scene.focus()
    page.keyboard.press("q")
    page.wait_for_function("(()=>{const c=JSON.parse(document.querySelector('#status').textContent).camera;return c.yaw===5&&!c.rotating})()")
    page.keyboard.press("e")
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).camera.yaw===0")
    page.keyboard.down("d")
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).camera.panX<0")
    page.keyboard.up("d")
    page.keyboard.down("x")
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).camera.scale>24")
    page.keyboard.up("x")
    page.locator("#resetView").click()
    page.get_by_role("button",name="Reset terrain").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).builder.history.undo===0")
    page.locator("summary",has_text="Builder painting and edit plans").click()
    page.locator("#paintTool").select_option("half")
    scene.scroll_into_view_if_needed()
    xy=page.evaluate("""async () => {const {project}=await import('/src/camera.mjs');return [project([-5,0,5]),project([5,0,5])];}""")
    box=scene.bounding_box()
    def screen(v):
        return box["x"]+v["x"]*box["width"]/900,box["y"]+v["y"]*box["height"]/450
    page.mouse.move(*screen(xy[0]))
    page.mouse.down()
    page.mouse.move(*screen(xy[1]),steps=4)
    page.mouse.up()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).builder.history.undo===1")
    with page.expect_download() as plan_download:
        page.locator("#exportLastPlan").click()
    plan_file=plan_download.value.path()
    plan=json.loads(Path(plan_file).read_text())
    assert len(plan["edits"])>=3,plan
    page.locator("#undoEdit").click()
    page.locator("#importEditPlan").set_input_files(str(plan_file))
    page.wait_for_function("!document.querySelector('#applyEditPlan').disabled")
    page.locator("#applyEditPlan").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).builder.history.undo===1")
    page.locator("summary",has_text="Session asset palette").click()
    page.locator("#pinAsset").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).builder.palette===1")
    page.locator("#renderQuality").select_option("fast")
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).builder.quality==='fast'")
    page.locator("#paintTool").select_option("objects")
    page.locator("#objectDensity").fill("1")
    scene.scroll_into_view_if_needed()
    box=scene.bounding_box()
    xy=page.evaluate("""async () => {const {project}=await import('/src/camera.mjs');return project([5,0,2.5]);}""")
    page.mouse.click(*screen(xy))
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).world_objects===2")
    page.locator("#undoEdit").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).world_objects===1")
    page.locator("#redoEdit").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).world_objects===2")
    with page.expect_download() as ctx_download:
        page.locator("#exportBuildContext").click()
    context=json.loads(Path(ctx_download.value.path()).read_text())
    assert context["schema"]=="smi-hex-build-context/1" and len(context["assets"])==1
    page.locator("#paintTool").select_option("select")
    page.locator("summary",has_text="Procedural building tools").click()
    page.locator("#usePalette").check()
    page.locator("#previewGrove").click()
    page.wait_for_function("document.querySelector('#planStatus').textContent.includes('Plant grove')")
    page.locator("#discardEditPlan").click()
    page.locator("#addWaypoint").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).builder.waypoints===1")
    page.locator("#clearWaypoints").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).builder.waypoints===0")
    # Exercise the new projection on known flat terrain, independently of
    # previous brush modifications and selected vertex handles.
    page.locator("#cameraAlignment").select_option("30")
    page.locator("#brushRadius").select_option("0")
    page.locator("#paintTool").select_option("select")
    page.get_by_role("button",name="Reset terrain").click()
    page.locator("#resetView").click()
    page.wait_for_function("""()=>{const s=JSON.parse(document.querySelector('#status').textContent),c=s.camera;return c.alignment_deg===30&&c.yaw===0&&!c.rotating&&c.scale===24&&c.panX===0&&c.panY===50&&s.selected.join(',')==='0,0,0'&&s.cell.shape.upper.every(v=>v===2)&&s.builder.history.undo===0}""")
    scene.scroll_into_view_if_needed()
    box=scene.bounding_box()
    xy=page.evaluate("""async () => {const {project}=await import('/src/camera.mjs');const s=JSON.parse(document.querySelector('#status').textContent);return project([5,0,5],s.camera);}""")
    # Modified click bypasses the active vertex handles and adds the neighbor.
    page.keyboard.down("Shift")
    page.mouse.click(*screen(xy))
    page.keyboard.up("Shift")
    page.wait_for_function("(()=>{const s=JSON.parse(document.querySelector('#status').textContent);return s.selected.join(',')==='1,0,0'&&s.selection.length===2})()")
    scene.focus()
    page.keyboard.press("e")
    page.wait_for_function("(()=>{const c=JSON.parse(document.querySelector('#status').textContent).camera;return c.yaw===1&&!c.rotating&&c.alignment_deg===30})()")
    page.locator("#cameraAlignment").select_option("0")
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).camera.alignment_deg===0")
    assert not errors,errors
    print("GPU depth, Atlas sprite load, scatter promotion, multi-selection, keyboard camera, brush plan replay, object brush, context, procedural controls and front/back alignment passed")
    browser.close()
