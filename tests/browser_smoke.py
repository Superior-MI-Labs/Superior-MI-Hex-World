import json
import hashlib
from io import BytesIO
from zipfile import ZipFile
from pathlib import Path
from playwright.sync_api import sync_playwright
from workspace_helpers import control, reveal
with sync_playwright() as p:
    browser=p.chromium.launch(args=["--use-angle=swiftshader","--enable-unsafe-swiftshader"])
    page=browser.new_page(viewport={"width":1200,"height":1000})
    errors=[]
    page.on("pageerror",lambda e: errors.append(str(e)))
    page.goto("http://127.0.0.1:8000/")
    page.wait_for_function("document.querySelector('#status').textContent.includes('WebGL2')")
    assert page.evaluate("JSON.parse(document.querySelector('#status').textContent).camera.alignment_deg")==30
    page.wait_for_function("""()=>{const s=document.querySelector('#scene'),t=document.querySelector('#terrain'),r=s.getBoundingClientRect(),c=JSON.parse(document.querySelector('#status').textContent).camera;return s.width===t.width&&s.height===t.height&&s.width===c.width&&s.height===c.height&&Math.abs(s.width/s.height-r.width/r.height)<.01}""")
    assert page.evaluate("document.documentElement.scrollHeight===innerHeight")
    start=control(page,"#viewport").bounding_box()
    control(page,"#toggleInspector").click()
    page.wait_for_function("document.querySelector('#scene').width>"+str(int(start["width"])))
    assert control(page,"#viewport").bounding_box()["width"]>start["width"]
    control(page,"#toggleInspector").click()
    page.wait_for_function("Math.abs(document.querySelector('#viewport').clientWidth-"+str(int(start["width"]))+")<2")
    control(page,'[data-tool="water"]').click()
    assert control(page,"#paintTool").input_value()=="water"
    assert page.locator("#paintWater").is_visible() and not page.locator("#objectDensity").is_visible()
    assert not page.locator("#assetPanel").is_visible()
    page.locator('[data-panel="assetPanel"]').click()
    assert page.locator("#assetPanel").is_visible() and not page.locator("#terrainPanel").is_visible()
    control(page,'[data-tool="select"]').click()
    assert control(page,"#paintTool").input_value()=="select"
    control(page,"summary",has_text="Builder painting and edit plans").click()
    control(page,"#focusWorld").click()
    assert control(page,"#exitFocus").is_visible()
    control(page,"#exitFocus").click()
    page.wait_for_function("!document.querySelector('#workspace').classList.contains('focus-world')")
    page.set_viewport_size({"width":680,"height":900})
    page.wait_for_function("document.querySelector('#scene').width<700")
    assert page.evaluate("document.documentElement.scrollWidth===innerWidth")
    page.set_viewport_size({"width":1200,"height":1000})
    page.wait_for_function("Math.abs(document.querySelector('#viewport').clientWidth-"+str(int(start["width"]))+")<2")
    page.wait_for_function("document.querySelector('#scene').width===document.querySelector('#viewport').clientWidth")
    page.screenshot(path="/tmp/hex-world-workspace.png")
    control(page,"#cameraAlignment").select_option("0")
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).camera.alignment_deg===0")
    page.wait_for_function("document.querySelector('#assetStatus').textContent === 'Atlas sprite loaded'")
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).atlas_sprite")
    # Directional fixture uses existing measured grass regions as view IDs, not authored view art.
    vb={"manifest":"./examples/meadow-art/manifest.json","asset":"smi.hex.grass.01"}
    control(page,"#importObjectBinding").set_input_files({"name":"views.json","mimeType":"application/json","buffer":json.dumps(vb).encode()})
    page.wait_for_function("document.querySelector('#assetStatus').textContent === 'Atlas sprite loaded'")
    page.wait_for_function("document.querySelector('#spatialStatus').textContent.includes('2.5 ft · 6 views · wind-responsive')")
    control(page,"#placeActor").click()
    control(page,"#objects").select_option(index=1)
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).selected_object_view==='smi.hex.grass.01'")
    control(page,"#rotateObject").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).selected_object_view==='smi.hex.grass.03'")
    control(page,"#rotate").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).selected_object_view==='smi.hex.grass.01'")
    control(page,"#removeObject").click()
    control(page,"#resetView").click()
    control(page,"#loadActor").click()
    page.wait_for_function("document.querySelector('#assetStatus').textContent === 'Atlas sprite loaded'")
    # Synthetic canonical pack verifies actual region mask qualification.
    pixels=page.evaluate("""() => {
      const c=document.createElement('canvas');c.width=6;c.height=2;const g=c.getContext('2d');
      g.fillStyle='orange';g.fillRect(0,0,2,2);g.fillStyle='black';g.fillRect(2,0,1,2);g.fillStyle='white';g.fillRect(3,0,1,2);g.fillStyle='red';g.fillRect(4,0,2,2);
      return c.toDataURL().split(',')[1];
    }""")
    import base64
    region=lambda id,x,w=2: {"id":id,"kind":"region","texture":"sheet","rect_px":[x,0,w,2],"pivot":[.5,1]}
    manifest={"schema":"smi-visual-pack/1","pack_id":"fixture.emissive","version":"1","license":"CC0-1.0","textures":{"sheet":{"path":"sheet.png","width_px":6,"height_px":2}},"assets":[region("lamp",0),region("mask",2),region("invalid-color",4),region("invalid-size",2,1)]}
    page.route("**/test-emissive/manifest.json",lambda route: route.fulfill(json=manifest))
    page.route("**/test-emissive/sheet.png",lambda route: route.fulfill(body=base64.b64decode(pixels),content_type="image/png"))
    masks=page.evaluate("""async () => {
      const {createAtlasSprite}=await import('/src/assets.mjs');
      const binding={manifest:'./test-emissive/manifest.json',asset:'lamp',emissive_mask:'mask'};
      const raster=await createAtlasSprite(binding),valid=raster.emissiveMask.width===2&&raster.emissiveMask.height===2;
      const bad={};for(const id of ['invalid-color','invalid-size'])try{await createAtlasSprite({...binding,emissive_mask:id});bad[id]=false;}catch(e){bad[id]=e.message;}
      return {valid,bad};
    }""")
    assert masks["valid"] and "grayscale" in masks["bad"]["invalid-color"] and "mismatch" in masks["bad"]["invalid-size"],masks
    # Exercise the same import, qualification, placement and save pipeline as a real asset.
    binding={"manifest":"./test-emissive/manifest.json","asset":"lamp","emissive_mask":"mask","height_ft":3}
    control(page,"#importObjectBinding").set_input_files({"name":"emissive.json","mimeType":"application/json","buffer":json.dumps(binding).encode()})
    page.wait_for_function("document.querySelector('#assetStatus').textContent==='Atlas sprite loaded' && document.querySelector('#spatialStatus').textContent.includes('emissive mask')")
    control(page,"#placeActor").click()
    control(page,"#objects").select_option(index=1)
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).emissive_mask_instances===1")
    control(page,"summary",has_text="Object light source").click()
    control(page,"#objectEmissive").fill("1")
    control(page,"#applyObjectLight").click()
    page.wait_for_function("document.querySelector('#objectLightStatus').textContent==='Light attached'")
    with page.expect_download() as mask_save:
        control(page,"#save").click()
    saved_mask=json.loads(Path(mask_save.value.path()).read_text())
    lamp=next(e for e in saved_mask["entities"] if e["visual"]["asset"]=="lamp")
    assert lamp["visual"]["emissive_mask"]=="mask" and lamp["light"]["emissive"]==1
    control(page,"#load").set_input_files({"name":"mask-world.json","mimeType":"application/json","buffer":json.dumps(saved_mask).encode()})
    page.wait_for_function("document.querySelector('#message').textContent==='World imported'")
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).emissive_mask_instances===1")
    control(page,"#objects").select_option(label=control(page,"#objects option").filter(has_text="lamp").text_content())
    control(page,"#removeObject").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).world_objects===1")
    control(page,"summary",has_text="Object light source").click()
    control(page,"#resetView").click()
    control(page,"#loadActor").click()
    page.wait_for_function("document.querySelector('#assetStatus').textContent==='Atlas sprite loaded'")
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
    # Recover a transient texture failure through the normal explicit load.
    attempts=[]
    def transient_texture(route):
        attempts.append(route.request.url)
        if len(attempts)==1:
            route.abort()
        else:
            route.continue_()
    texture_pattern="**/examples/chest-fixture/textures/chest.png"
    page.route(texture_pattern,transient_texture)
    retry_binding={"manifest":"./examples/chest-fixture/manifest.json?retry-test=1","asset":"fixture.chest","preset":"closed"}
    retry_file={"name":"retry.json","mimeType":"application/json","buffer":json.dumps(retry_binding).encode()}
    control(page,"#importObjectBinding").set_input_files(retry_file)
    page.wait_for_function("document.querySelector('#assetStatus').textContent.includes('Texture unavailable')")
    page.wait_for_function("document.querySelector('#importObjectBinding').value===''")
    control(page,"#importObjectBinding").set_input_files(retry_file)
    page.wait_for_function("document.querySelector('#assetStatus').textContent==='Atlas sprite loaded'")
    assert len(attempts)==2,attempts
    page.unroute(texture_pattern,transient_texture)
    shared=page.evaluate("""async()=>{
      const {atlasPackSession,resolveAtlasBinding}=await import('/src/assets.mjs');
      const binding={manifest:'./examples/chest-fixture/manifest.json?retry-test=1',asset:'fixture.chest'};
      const a=await atlasPackSession(binding.manifest);
      await resolveAtlasBinding(binding);
      return a===await atlasPackSession(binding.manifest);
    }""")
    assert shared
    catalog={"schema":"smi-public-catalog/1","packs":[{"id":"fixture","zip":"demo/chest-test.zip","archive_sha256":digest}],"assets":[{"id":"fixture.chest","name":"Chest","pack":"fixture","kind":"composition","capabilities":["world-use","compatible-slots"],"license":"CC0-1.0","category_path":["world","world.props","world.props.containers"],"perspective":["isometric"],"theme":["fantasy"],"medium":["raster-2d"],"family":"painterly-fantasy"}]}
    page.route("**/test-catalog.json",lambda route: route.fulfill(json=catalog))
    control(page,"summary",has_text="Browse published Atlas assets").click()
    control(page,"#catalogURL").fill("http://127.0.0.1:8000/test-catalog.json")
    control(page,"#refreshCatalog").click()
    page.wait_for_function("document.querySelector('#catalogAssets').options.length===1")
    control(page,"#catalogCategory").select_option("world.props")
    control(page,"#catalogPerspective").select_option("isometric")
    control(page,"#catalogFamily").select_option("painterly-fantasy")
    control(page,"#catalogCapability").select_option("world-use")
    assert control(page,"#catalogAssets").input_value()=="fixture.chest"
    assert control(page,"#catalogCards button").count()==1
    control(page,'[data-asset="fixture.chest"]').click()
    assert control(page,'[data-asset="fixture.chest"]').get_attribute("aria-pressed")=="true"
    assert "CC0-1.0" in control(page,"#catalogSelection").text_content()
    page.screenshot(path="/tmp/hex-world-library.png")
    control(page,"#loadCatalogAsset").click()
    page.wait_for_function("document.querySelector('#assetStatus').textContent === 'Atlas sprite loaded'")
    control(page,"#loadChest").click()
    page.wait_for_function("document.querySelector('#assetStatus').textContent === 'Atlas sprite loaded'")
    control(page,"#placeActor").click()
    control(page,"#objects").select_option(index=1)
    page.wait_for_selector("#generatedPreset")
    control(page,"#generatedPreset").select_option("treasure")
    control(page,"[data-visual-slot=contents]").select_option("fixture.chest.gems")
    control(page,"#applyAppearance").click()
    page.wait_for_function("document.querySelector('#appearanceStatus').textContent === 'Appearance applied'")
    # Host opts into a physical condition using the existing authored boolean.
    control(page,"#colliderRadius").fill("1")
    control(page,"#colliderHeight").fill("3")
    control(page,"#colliderInput").fill("open")
    control(page,"#colliderEquals").fill("true")
    control(page,"#applyCollider").click()
    page.wait_for_function("document.querySelector('#colliderStatus').textContent==='Collider applied'")
    assert control(page,"#colliderActive").text_content()=="Disabled by input"
    with page.expect_download() as appearance_save:
        control(page,"#save").click()
    saved=json.loads(Path(appearance_save.value.path()).read_text())
    assert next(e for e in saved["entities"] if e["visual"]["asset"]=="fixture.chest")["visual"]["slots"]["contents"]=="fixture.chest.gems"
    control(page,"summary",has_text="Spatial interactions").click()
    control(page,"#movingObject").select_option(index=0)
    control(page,"#useObject").click()
    page.wait_for_function("document.querySelector('#interactionStatus').textContent.includes('visual use applied')")
    page.wait_for_function("JSON.parse(document.querySelector('#objectAppearance').value).inputs.open===false")
    assert control(page,"#colliderActive").text_content()=="Blocking"
    control(page,"#useObject").click()
    page.wait_for_function("JSON.parse(document.querySelector('#objectAppearance').value).inputs.open===true")
    assert control(page,"#colliderActive").text_content()=="Disabled by input"
    control(page,"summary",has_text="Spatial interactions").click()
    control(page,"#removeObject").click()
    control(page,"#loadActor").click()
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
    residency=page.evaluate("""()=>{
      return import('/src/gpu.mjs').then(({createRenderer})=>{
        const c=document.createElement('canvas');c.width=c.height=32;
        const renderer=createRenderer(c),view=([x,y,depth])=>({x,y,depth});
        const img=document.createElement('canvas');img.width=img.height=4;
        img.getContext('2d').fillRect(0,0,4,4);
        const sprite={image:img,revision:0,points:[[2,2,1],[10,2,1],[10,10,1],[2,10,1]]};
        renderer.render([],view,{sprites:[sprite]});const initial=renderer.diagnostics();
        renderer.render([],view,{});const idle=renderer.diagnostics();
        renderer.render([],view,{sprites:[sprite]});const reused=renderer.diagnostics();
        renderer.render([],view,{sprites:[{...sprite,revision:1}]});const changed=renderer.diagnostics();
        return {initial,idle,reused,changed};
      });
    }""")
    assert residency["initial"]["sprite_uploads"]==1
    assert residency["idle"]["sprite_textures"]==1 and residency["idle"]["active_sprite_textures"]==0
    assert residency["reused"]["sprite_uploads"]==0 and residency["changed"]["sprite_uploads"]==1
    packed=page.evaluate("""async () => {
      const {createRenderer}=await import('/src/gpu.mjs'),c=document.createElement('canvas');c.width=c.height=32;
      const r=createRenderer(c),view=([x,y,depth])=>({x,y,depth});
      const faces=[{kind:'top',color:[0,1,0],points:[[1,1,1],[30,1,1],[1,30,1]]}];
      r.render(faces,view,{pattern:false,projectionKey:'a'});const first=r.diagnostics(),pixel=r.readPixel(5,5);
      r.render(faces,view,{pattern:false,projectionKey:'a'});const repeat=r.diagnostics(),same=r.readPixel(5,5);
      r.render(faces,view,{pattern:false,projectionKey:'b',cacheStaticTerrain:false});const changed=r.diagnostics();
      r.render(faces,view,{pattern:false,projectionKey:'b'});const settled=r.diagnostics();
      r.render(faces,view,{pattern:false,projectionKey:'b',cacheStaticTerrain:false});const retained=r.diagnostics();
      return {first,repeat,changed,settled,retained,pixel,same};
    }""")
    assert packed["first"]["terrain_uploads"]==1 and packed["first"]["terrain_buffer_bytes"]>0,packed
    assert packed["repeat"]["terrain_uploads"]==0 and packed["repeat"]["terrain_cache_hit"],packed
    assert packed["changed"]["terrain_uploads"]==1 and packed["changed"]["terrain_buffer_bytes"]==0 and packed["pixel"]==packed["same"],packed
    assert packed["settled"]["terrain_uploads"]==1 and packed["settled"]["terrain_buffer_bytes"]>0,packed
    assert packed["retained"]["terrain_uploads"]==0 and packed["retained"]["terrain_buffer_bytes"]==packed["settled"]["terrain_buffer_bytes"],packed
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
      const mask=document.createElement('canvas');mask.width=2;mask.height=1;const m=mask.getContext('2d');m.fillStyle='black';m.fillRect(0,0,1,1);m.fillStyle='white';m.fillRect(1,0,1,1);
      const masked={...actor,emissive:1,emissiveMask:mask,points:[[5,5,2],[35,5,2],[35,25,2],[5,25,2]]};
      r.render([face],view,{pattern:false,lighting,sprites:[masked]});const dark=r.readPixel(7,12),bright=r.readPixel(32,12);
      r.render([face],view,{pattern:false,lighting,sprites:[masked],softSprites:true});const softDark=r.readPixel(7,12),softBright=r.readPixel(32,12);
      const {POINT_SHADOW_WIDTH,POINT_SHADOW_HEIGHT,POINT_SHADOW_LIMIT}=await import('/src/lighting.mjs');
      const occluder={ids:['test'],data:new Uint8Array(POINT_SHADOW_WIDTH*POINT_SHADOW_HEIGHT*POINT_SHADOW_LIMIT)};
      r.render([face],view,{pattern:false,lighting,pointLights:[{...light,id:'test'}],pointShadow:occluder});const shadowed=r.readPixel(17,12);
      r.render([face],view,{pattern:false,lighting,pointLights:[{...light,id:'test'}]});const unshadowed=r.readPixel(17,12);
      return {center,far,off,sprite,emissive,dark,bright,softDark,softBright,shadowed,unshadowed};
    }""")
    assert local_light["center"][0]>120 and local_light["center"][1]<35,local_light
    assert local_light["far"]==local_light["off"],local_light
    assert local_light["sprite"][0]>240 and local_light["sprite"][1]<180,local_light
    assert all(v>245 for v in local_light["emissive"][:3]),local_light
    assert all(140<v<180 for v in local_light["dark"][:3]),local_light
    assert all(v>245 for v in local_light["bright"][:3]),local_light
    assert local_light["softDark"]==local_light["dark"] and local_light["softBright"]==local_light["bright"],local_light
    assert local_light["shadowed"]==local_light["off"] and local_light["unshadowed"][0]>local_light["shadowed"][0]+15,local_light
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
    control(page,"#scatter").uncheck()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).scatter_instances===0")
    control(page,"#scatter").check()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).scatter_instances>0")
    control(page,"summary",has_text="World lighting").click()
    control(page,"#sunAzimuth").fill("90")
    control(page,"#sunElevation").fill("35")
    control(page,"#sunAmbient").fill(".4")
    control(page,"#applyLighting").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).lighting.ambient===0.4")
    control(page,"#resetLighting").click()
    page.wait_for_function("document.querySelector('#lightStatus').textContent==='Style lighting'")
    control(page,"summary",has_text="World lighting").click()
    control(page,"#windSpeed").fill("20")
    control(page,"#applyWind").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).wind_bent_sprites>0 && JSON.parse(document.querySelector('#status').textContent).wind_state_sprites>0")
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).performance.animation_phase_variants>0")
    control(page,"#shelterWind").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).selected_wind.velocity_ft_s[0]===0")
    control(page,"#windVisual").uncheck()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).wind_bent_sprites===0")
    control(page,"#windVisual").check()
    control(page,"#clearWind").click()
    control(page,"#windSpeed").fill("0")
    control(page,"#applyWind").click()
    control(page,"#season").select_option("autumn")
    control(page,"#applyClimate").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).seasonal_sprites>0")
    control(page,"#season").select_option("winter")
    control(page,"#localClimate").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).selected_climate.season==='winter'")
    control(page,"#clearClimate").click()
    control(page,"#season").select_option("summer")
    control(page,"#applyClimate").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).seasonal_sprites===0")
    # Weather is presentation until an ordinary reviewed exposure plan is applied.
    baseline_weather=page.evaluate("JSON.parse(document.querySelector('#status').textContent)")
    control(page,"#precipitation").select_option("rain")
    control(page,"#precipIntensity").fill("1")
    control(page,"#applyClimate").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).precipitation_instances>0")
    control(page,"#weatherVisual").uncheck()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).precipitation_instances===0")
    control(page,"#weatherVisual").check()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).precipitation_instances>0")
    assert page.evaluate("JSON.parse(document.querySelector('#status').textContent).cell")==baseline_weather["cell"]
    control(page,"#exposureSeconds").fill("3600")
    control(page,"#previewExposure").click()
    page.wait_for_function("!document.querySelector('#applyEditPlan').disabled")
    control(page,"#applyEditPlan").evaluate("(b)=>b.click()")
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).cell.components.surface.moisture>.9")
    assert page.evaluate("JSON.parse(document.querySelector('#status').textContent).simulation_seconds")==baseline_weather["simulation_seconds"]
    control(page,"#undoEdit").click()
    page.wait_for_function("c=>JSON.stringify(JSON.parse(document.querySelector('#status').textContent).cell)===JSON.stringify(c)",arg=baseline_weather["cell"])
    control(page,"#precipitation").select_option("none")
    control(page,"#applyClimate").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).precipitation_instances===0")
    # Local resolved style round-trip, with failure preserving current style.
    with page.expect_download() as style_download:
        control(page,"#exportArt").click()
    exported_style=json.loads(Path(style_download.value.path()).read_text())
    assert exported_style["detail"]["top"]["manifest"].startswith("http://127.0.0.1:8000/")
    exported_style["id"]="imported-fixture-style"
    control(page,"#importArt").set_input_files({"name":"style.json","mimeType":"application/json","buffer":json.dumps(exported_style).encode()})
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).art_style==='imported-fixture-style'")
    control(page,"#importArt").set_input_files({"name":"bad-style.json","mimeType":"application/json","buffer":b"{}"})
    page.wait_for_function("document.querySelector('#artStatus').textContent.startsWith('Previous style retained:')")
    assert page.evaluate("JSON.parse(document.querySelector('#status').textContent).art_style")=="imported-fixture-style"
    control(page,"#resetArt").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).art_style==='fantasy-meadow-fixture'")
    control(page,"#artURL").fill("./examples/no-such-style.json")
    control(page,"#loadArt").click()
    page.wait_for_function("document.querySelector('#artStatus').textContent.startsWith('Previous style retained:')")
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).art_style === 'fantasy-meadow-fixture'")
    control(page,"#resetArt").click()
    page.wait_for_function("document.querySelector('#artStatus').textContent === 'Atlas meadow fixture loaded'")
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).art_style === 'fantasy-meadow-fixture'")
    control(page,"#artStyle").uncheck()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).art_style === null")
    control(page,"#artStyle").check()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).art_style === 'fantasy-meadow-fixture'")
    page.wait_for_function("document.querySelector('#maskStatus').textContent === 'Atlas transition mask loaded'")
    control(page,"#transitionDemo").select_option("snow")
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).transition_triangles > 0")
    control(page,"#transitionDebug").check()
    control(page,"#transitionDebug").uncheck()
    control(page,"#transitions").uncheck()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).transitions === false")
    control(page,"#transitions").check()
    reveal(page,page.get_by_role("button",name="Reset terrain")).click()
    assert control(page,"#resolution").count()==0
    reveal(page,page.get_by_role("button",name="Reactive fire")).click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).cell.components.surface.burn===8")
    reveal(page,page.get_by_role("button",name="Advance 6 seconds")).click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).cell.components.surface.burn===8")
    control(page,"#mode").select_option("manual")
    reveal(page,page.get_by_role("button",name="Advance 6 seconds")).click()
    reveal(page,page.get_by_role("button",name="Advance 6 seconds")).click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).cell.components.surface.scorch===1")
    control(page,"#level").select_option("1")
    reveal(page,page.get_by_role("button",name="Full",exact=True)).click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).selected[2]===1 && JSON.parse(document.querySelector('#status').textContent).cell.material==='soil'")
    # Select the visible front side of the new upper cell, not its top.
    xy=page.evaluate("""async () => {
      const {project}=await import('/src/camera.mjs');
      return project([1.25,2.165063509,7.5],JSON.parse(document.querySelector('#status').textContent).camera);
    }""")
    control(page,"#scene").scroll_into_view_if_needed()
    box=control(page,"#scene").bounding_box()
    page.mouse.click(box["x"]+xy["x"]*box["width"]/control(page,"#scene").evaluate("(e)=>e.width"),box["y"]+xy["y"]*box["height"]/control(page,"#scene").evaluate("(e)=>e.height"))
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).face==='side:0'")
    assert control(page,"#vertex option").count()==4
    control(page,"#connected").uncheck()
    control(page,"#vertex").select_option("upper:0")
    control(page,"#height").fill("1")
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).cell.shape.upper[0]===1")
    control(page,"#vertex").select_option("lower:0")
    # Control interactions may scroll the page. Re-read the canvas rectangle
    # after selecting the lower handle, rather than reusing pre-scroll pixels.
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).vertex.layer==='lower' && JSON.parse(document.querySelector('#status').textContent).vertex.index===0")
    control(page,"#scene").scroll_into_view_if_needed()
    box=control(page,"#scene").bounding_box()
    # Drag the actual lower handle past its paired upper vertex.
    handle=page.evaluate("""() => JSON.parse(document.querySelector('#status').textContent).handles.find(h=>h.layer==='lower'&&h.index===0)""")
    hx=box["x"]+handle["x"]*box["width"]/control(page,"#scene").evaluate("(e)=>e.width")
    hy=box["y"]+handle["y"]*box["height"]/control(page,"#scene").evaluate("(e)=>e.height")
    assert page.evaluate("([x,y])=>document.elementFromPoint(x,y)?.id", [hx,hy])=="scene", (box,handle)
    page.mouse.move(hx,hy)
    page.mouse.down()
    page.mouse.move(box["x"]+handle["x"]*box["width"]/control(page,"#scene").evaluate("(e)=>e.width"),box["y"]+(handle["y"]-150)*box["height"]/control(page,"#scene").evaluate("(e)=>e.height"),steps=5)
    page.mouse.up()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).cell.shape.lower[0]===1")
    assert control(page,"#height").get_attribute("max")=="1"
    control(page,"#surface").select_option("lower")
    assert control(page,"#vertex option").count()==7
    control(page,"#surface").select_option("upper")
    assert control(page,"#vertex option").count()==7
    control(page,"#actorState").select_option("walk")
    control(page,"#loadActor").click()
    page.wait_for_function("document.querySelector('#assetStatus').textContent === 'Atlas sprite loaded'")
    reveal(page,page.get_by_role("button",name="Rotate 60°")).click()
    control(page,"#scene").scroll_into_view_if_needed()
    box=control(page,"#scene").bounding_box()
    page.mouse.move(box["x"]+box["width"]/2,box["y"]+box["height"]/2)
    page.mouse.down(button="middle")
    page.mouse.move(box["x"]+box["width"]/2+50,box["y"]+box["height"]/2+20)
    page.mouse.up(button="middle")
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).camera.panX > 0")
    reveal(page,page.get_by_role("button",name="Reset view")).click()
    page.on("dialog",lambda d:d.accept())
    control(page,"#worldMode").select_option("exploration")
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).world_mode==='exploration'",timeout=60000)
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).performance.terrain_cache_hit===true",timeout=60000)
    page.wait_for_function("(()=>{const p=JSON.parse(document.querySelector('#status').textContent).performance;return p.terrain_cache_hit===true&&p.terrain_uploads===0&&p.terrain_ms<20})()",timeout=60000)
    print("MEADOW_PROFILE_SETTLED",page.evaluate("JSON.parse(document.querySelector('#status').textContent).performance"))
    control(page,"summary",has_text="Performance capture").click()
    control(page,"#startBenchmark").click()
    page.wait_for_function("!document.querySelector('#exportBenchmark').disabled",timeout=60000)
    with page.expect_download() as performance_report:
        control(page,"#exportBenchmark").click()
    capture=json.loads(Path(performance_report.value.path()).read_text())
    assert capture["schema"]=="smi-hex-performance/1" and capture["scenario"]=="settled-idle"
    assert capture["elapsed_ms"]>=10000 and capture["metrics"]["interval_samples"]>0
    assert capture["start"]["camera"]==capture["end"]["camera"]
    assert capture["start"]["geometry_revision"]==capture["end"]["geometry_revision"]
    assert capture["start"]["world_mode"]=="exploration"
    assert capture["metrics"]["gpu_ms"] is None or capture["metrics"]["gpu_samples"]>0
    control(page,"summary",has_text="Performance capture").click()
    initial=page.evaluate("JSON.parse(document.querySelector('#status').textContent).resident_chunks")
    reveal(page,page.get_by_role("button",name="Half",exact=True)).click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).cell.shape.upper.every(v=>v===1)")
    control(page,"#scene").scroll_into_view_if_needed()
    box=control(page,"#scene").bounding_box()
    page.mouse.move(box["x"]+box["width"]/2,box["y"]+box["height"]/2)
    page.mouse.down(button="middle")
    page.mouse.move(box["x"]+box["width"]/2+3500,box["y"]+box["height"]/2)
    page.mouse.up(button="middle")
    page.wait_for_function("(n)=>JSON.parse(document.querySelector('#status').textContent).resident_chunks>n",arg=initial,timeout=60000)
    reveal(page,page.get_by_role("button",name="Reset view")).click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).camera.panX===0 && JSON.parse(document.querySelector('#status').textContent).cell.shape.upper.every(v=>v===1)",timeout=60000)
    # Return to a deterministic island for construction and persistent object tests.
    control(page,"#worldMode").select_option("island")
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).world_mode==='island'")
    control(page,"#prefab").select_option("stone-gate")
    control(page,"#previewPrefab").check()
    assert control(page,"#placePrefab").is_enabled()
    control(page,"#placePrefab").click()
    assert control(page,"#placePrefab").is_disabled()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).world_objects===1")
    control(page,"#placeActor").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).world_objects===2")
    control(page,"#removeObject").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).world_objects===1")
    with page.expect_download() as download:
        control(page,"#save").click()
    save=download.value.path()
    data=json.loads(Path(save).read_text())
    assert len(data["entities"])==1
    assert sum(1 for c in data["chunks"] for e in c["cells"] if e["value"]["material"]=="stone")==5
    control(page,"#load").set_input_files(str(save))
    page.wait_for_function("document.querySelector('#message').textContent==='World imported'")
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).world_objects===1")
    # Capture explicit geometry, export, and verify persisted standalone effects.
    control(page,"#captureCell").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).capture_cells===1")
    with page.expect_download() as prefab_download:
        control(page,"#exportPrefab").click()
    prefab_data=json.loads(Path(prefab_download.value.path()).read_text())
    assert len(prefab_data["cells"])==1
    control(page,"#mode").select_option("manual")
    control(page,"#fire").click()
    control(page,"#timed").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).active_effects===2")
    with page.expect_download() as effect_download:
        control(page,"#save").click()
    saved=effect_download.value.path()
    control(page,"#load").set_input_files(str(saved))
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).active_effects===2")
    control(page,"#step").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).active_effects===1")
    control(page,"#extinguish").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).world_effects===0")
    # New island: choose a neighboring floor through the actual renderer and move.
    reveal(page,page.get_by_role("button",name="Reset terrain")).click()
    control(page,"#movingObject").select_option("demo-actor")
    xy=page.evaluate("""async () => {
      const {project}=await import('/src/camera.mjs');
      return project([5,0,5],JSON.parse(document.querySelector('#status').textContent).camera);
    }""")
    control(page,"#scene").scroll_into_view_if_needed()
    box=control(page,"#scene").bounding_box()
    page.mouse.click(box["x"]+xy["x"]*box["width"]/control(page,"#scene").evaluate("(e)=>e.width"),box["y"]+xy["y"]*box["height"]/control(page,"#scene").evaluate("(e)=>e.height"))
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).selected.join(',')==='1,0,0'")
    control(page,"#previewRoute").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).route_steps===1")
    control(page,"summary",has_text="Spatial interactions").click()
    control(page,"#cellTags").fill("sensor, usable")
    control(page,"#setCellTags").click()
    control(page,"#useCell").click()
    assert "environment.use" in control(page,"#interactionStatus").text_content()
    custom={"schema":"smi-hex-interactions/1","rules":[{"id":"custom-use","event":"use","match":{"kind":"cell","tags":["usable"]},"signal":"custom.test"}]}
    control(page,"#importInteractions").set_input_files({"name":"custom.json","mimeType":"application/json","buffer":json.dumps(custom).encode()})
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).interaction_rules===1")
    control(page,"#useCell").click()
    assert "custom.test" in control(page,"#interactionStatus").text_content()
    control(page,"#resetInteractions").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).interaction_rules===7")
    control(page,"#moveObject").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).interaction_events.some(e=>e.signals.some(s=>s.signal==='environment.sensor.enter'))")
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).bent_sprites>0")
    with page.expect_download() as moved:
        control(page,"#save").click()
    assert json.loads(Path(moved.value.path()).read_text())["entities"][0]["address"]==[1,0,0]
    control(page,"#contactShadows").uncheck()
    control(page,"#contactShadows").check()
    control(page,"#worldMode").select_option("settlement")
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).world_mode==='settlement'")
    assert control(page,"#cutaway").input_value()=="all"
    control(page,"#cutaway").select_option("0")
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).cutaway===0")
    control(page,"#movingObject").select_option("demo-actor")
    xy=page.evaluate("""async () => {
      const {project}=await import('/src/camera.mjs');
      const camera=JSON.parse(document.querySelector('#status').textContent).camera;
      return project([0,0,5],camera);
    }""")
    control(page,"#scene").scroll_into_view_if_needed()
    box=control(page,"#scene").bounding_box()
    page.mouse.click(box["x"]+xy["x"]*box["width"]/control(page,"#scene").evaluate("(e)=>e.width"),box["y"]+xy["y"]*box["height"]/control(page,"#scene").evaluate("(e)=>e.height"))
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).selected.join(',')==='0,0,0'")
    control(page,"#localCut").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).cutaway_center?.join(',')==='0,0'")
    control(page,"#checkSight").click()
    assert control(page,"#sightStatus").text_content()=="clear"
    control(page,"#previewRoute").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).route_steps===2")
    control(page,"#moveObject").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).moving_presentations===0")
    with page.expect_download() as settlement_save:
        control(page,"#save").click()
    saved=json.loads(Path(settlement_save.value.path()).read_text())
    assert saved["world"]["scene"]=="settlement-v1"
    assert next(e for e in saved["entities"] if e["id"]=="demo-actor")["address"]==[0,0,0]
    control(page,"#cutaway").select_option("all")
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).cutaway===null")
    page.screenshot(path="/tmp/hex-world-qa.png",full_page=True)
    # Fresh island, guaranteed visible scatter fixture. Explicit promotion must save
    # an entity and suppress exactly one decorative sample, even after deletion.
    page.goto("http://127.0.0.1:8000/")
    control(page,"#cameraAlignment").select_option("0")
    page.wait_for_function("document.querySelector('#artStatus').textContent === 'Atlas meadow fixture loaded'")
    promotion_style=json.loads(Path("examples/meadow-style.json").read_text())
    promotion_style["id"]="promotion-browser-fixture"
    family=promotion_style["vegetation"]["families"][0]
    family["density"]=1
    family["spacing_ft"]=0
    promotion_style["vegetation"]["families"]=[family]
    page.route("**/promotion-test.json",lambda route: route.fulfill(json=promotion_style))
    control(page,"#artURL").fill("./examples/promotion-test.json")
    control(page,"#loadArt").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).art_style==='promotion-browser-fixture'")
    page.wait_for_function("document.querySelector('#scatterChoice').options.length===6")
    count=page.evaluate("JSON.parse(document.querySelector('#status').textContent).scatter_candidates")
    key=control(page,"#scatterChoice").input_value()
    control(page,"#promoteScatter").click()
    page.wait_for_function("n=>{const s=JSON.parse(document.querySelector('#status').textContent);return s.world_objects===2&&s.scatter_candidates===n-1}",arg=count)
    with page.expect_download() as promoted:
        control(page,"#save").click()
    saved=json.loads(Path(promoted.value.path()).read_text())
    assert len(saved["entities"])==2
    assert any(key in c["value"].get("components",{}).get("scatter_hidden",[]) for chunk in saved["chunks"] for c in chunk["cells"])
    control(page,"#objects").select_option(index=1)
    control(page,"#colliderRadius").fill("1.25")
    control(page,"#colliderHeight").fill("3")
    control(page,"#applyCollider").click()
    assert control(page,"#colliderStatus").text_content()=="Collider applied"
    control(page,"#showColliders").check()
    control(page,"summary",has_text="Object light source").click()
    control(page,"#applyObjectLight").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).point_lights>0")
    control(page,"#pointOcclusion").check()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).point_shadow.lights>0")
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).point_shadow.cache_hit")
    control(page,"#pointOcclusion").uncheck()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).point_shadow.lights===0")
    control(page,"#pointLights").uncheck()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).point_lights===0")
    control(page,"#pointLights").check()
    with page.expect_download() as physical_save:
        control(page,"#save").click()
    physical=json.loads(Path(physical_save.value.path()).read_text())
    assert next(e for e in physical["entities"] if e["id"]!="demo-actor")["collider"]=={"kind":"cylinder","radius_ft":1.25,"height_ft":3}
    assert next(e for e in physical["entities"] if e["id"]!="demo-actor")["light"]["radius_ft"]==12
    control(page,"#removeObjectLight").click()
    control(page,"#showColliders").uncheck()
    control(page,"#removeObject").click()
    page.wait_for_function("n=>{const s=JSON.parse(document.querySelector('#status').textContent);return s.world_objects===1&&s.scatter_candidates===n-1}",arg=count)
    reveal(page,page.get_by_role("button",name="Basin",exact=True)).click()
    control(page,"summary",has_text="Water editing").click()
    control(page,"#waterFill").fill(".5")
    control(page,"#waterFlowX").fill("2")
    control(page,"#applyWater").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).water_triangles>0")
    with page.expect_download() as water_save:
        control(page,"#save").click()
    saved=json.loads(Path(water_save.value.path()).read_text())
    assert any(c["value"].get("components",{}).get("water")=={"fill":.5,"flow_ft_s":[2,0]} for chunk in saved["chunks"] for c in chunk["cells"])
    control(page,"#showWater").uncheck()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).water_triangles===0")
    control(page,"#showWater").check()
    control(page,"#drainWater").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).water_triangles===0")
    # Fill an empty cell above the island; simulation must follow the manual
    # clock, not elapsed visual frames, and persist its opt-in setting.
    control(page,"#level").select_option("1")
    control(page,"#waterFill").fill(".8")
    control(page,"#applyWater").click()
    control(page,"#simulateWater").check()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).water_simulation")
    control(page,"#mode").select_option("frozen")
    control(page,"#step").click()
    assert page.evaluate("JSON.parse(document.querySelector('#status').textContent).cell.components.water.fill")==.8
    control(page,"#mode").select_option("manual")
    control(page,"#step").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).cell.components.water.fill<0.8")
    with page.expect_download() as flow_save:
        control(page,"#save").click()
    assert json.loads(Path(flow_save.value.path()).read_text())["world"]["environment"]["water_simulation"] is True
    # Verify keyboard controls and actual batch edits through pointer selection.
    page.goto("http://127.0.0.1:8000/")
    control(page,"#cameraAlignment").select_option("0")
    page.wait_for_function("document.querySelector('#status').textContent.includes('WebGL2')")
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).world_mode==='island'")
    scene=control(page,"#scene")
    scene.scroll_into_view_if_needed()
    xy=page.evaluate("""async () => {const {project}=await import('/src/camera.mjs');return project([5,0,5],JSON.parse(document.querySelector('#status').textContent).camera);}""")
    box=scene.bounding_box()
    page.keyboard.down("Shift")
    page.mouse.click(box["x"]+xy["x"]*box["width"]/control(page,"#scene").evaluate("(e)=>e.width"),box["y"]+xy["y"]*box["height"]/control(page,"#scene").evaluate("(e)=>e.height"))
    page.keyboard.up("Shift")
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).selection.length===2")
    reveal(page,page.get_by_role("button",name="Half",exact=True)).click()
    with page.expect_download() as batch:
        control(page,"#save").click()
    data=json.loads(Path(batch.value.path()).read_text())
    cells={tuple(c["address"][i]*16+v for i,v in enumerate(e["local"])):e["value"] for c in data["chunks"] for e in c["cells"]}
    assert all(cells[a]["shape"]["upper"]==[1]*7 for a in [(0,0,0),(1,0,0)])
    control(page,"#undoEdit").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).cell.shape.upper.every(v=>v===2)")
    control(page,"#redoEdit").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).cell.shape.upper.every(v=>v===1)")
    control(page,"#clearSelection").click()
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
    control(page,"#resetView").click()
    reveal(page,page.get_by_role("button",name="Reset terrain")).click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).builder.history.undo===0")
    control(page,"summary",has_text="Builder painting and edit plans").click()
    control(page,"#paintTool").select_option("half")
    scene.scroll_into_view_if_needed()
    xy=page.evaluate("""async () => {const {project}=await import('/src/camera.mjs');return [project([-5,0,5],JSON.parse(document.querySelector('#status').textContent).camera),project([5,0,5],JSON.parse(document.querySelector('#status').textContent).camera)];}""")
    box=scene.bounding_box()
    def screen(v):
        return box["x"]+v["x"]*box["width"]/control(page,"#scene").evaluate("(e)=>e.width"),box["y"]+v["y"]*box["height"]/control(page,"#scene").evaluate("(e)=>e.height")
    page.mouse.move(*screen(xy[0]))
    page.mouse.down()
    page.mouse.move(*screen(xy[1]),steps=4)
    page.mouse.up()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).builder.history.undo===1")
    with page.expect_download() as plan_download:
        control(page,"#exportLastPlan").click()
    plan_file=plan_download.value.path()
    plan=json.loads(Path(plan_file).read_text())
    assert len(plan["edits"])>=3,plan
    control(page,"#undoEdit").click()
    control(page,"#importEditPlan").set_input_files(str(plan_file))
    page.wait_for_function("!document.querySelector('#applyEditPlan').disabled")
    control(page,"#applyEditPlan").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).builder.history.undo===1")
    control(page,"summary",has_text="Session asset palette").click()
    control(page,"#pinAsset").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).builder.palette===1")
    with page.expect_download() as saved_palette:
        control(page,"#exportPalette").click()
    palette_data=json.loads(Path(saved_palette.value.path()).read_text())
    assert len(palette_data)==1
    control(page,"#clearPalette").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).builder.palette===0")
    control(page,"#importPalette").set_input_files({"name":"palette.json","mimeType":"application/json","buffer":json.dumps(palette_data).encode()})
    page.wait_for_function("document.querySelector('#paletteStatus').textContent==='1 imported assets'")
    control(page,"#importPalette").set_input_files({"name":"bad-palette.json","mimeType":"application/json","buffer":b"{}"})
    page.wait_for_function("document.querySelector('#paletteStatus').textContent.startsWith('Previous palette retained:')")
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).builder.palette===1")
    assert control(page,"#assetPalette button").count()==1
    with page.expect_download() as diagnostic:
        control(page,"#exportDiagnostics").click()
    diagnostics=json.loads(Path(diagnostic.value.path()).read_text())
    assert "interval_p95_ms" in diagnostics["performance"] and "sprite_texture_bytes_estimate" in diagnostics["performance"]
    control(page,"#renderQuality").select_option("fast")
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).builder.quality==='fast'")
    control(page,"#paintTool").select_option("objects")
    control(page,"#objectDensity").fill("1")
    scene.scroll_into_view_if_needed()
    box=scene.bounding_box()
    xy=page.evaluate("""async () => {const {project}=await import('/src/camera.mjs');return project([5,0,2.5],JSON.parse(document.querySelector('#status').textContent).camera);}""")
    page.mouse.click(*screen(xy))
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).world_objects===2")
    control(page,"#undoEdit").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).world_objects===1")
    control(page,"#redoEdit").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).world_objects===2")
    with page.expect_download() as ctx_download:
        control(page,"#exportBuildContext").click()
    context=json.loads(Path(ctx_download.value.path()).read_text())
    assert context["schema"]=="smi-hex-build-context/1" and len(context["assets"])==1
    control(page,"#paintTool").select_option("select")
    control(page,"summary",has_text="Procedural building tools").click()
    control(page,"#usePalette").check()
    control(page,"#previewGrove").click()
    page.wait_for_function("document.querySelector('#planStatus').textContent.includes('Plant grove')")
    control(page,"#discardEditPlan").click()
    control(page,"#addWaypoint").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).builder.waypoints===1")
    control(page,"#clearWaypoints").click()
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).builder.waypoints===0")
    # Exercise the new projection on known flat terrain, independently of
    # previous brush modifications and selected vertex handles.
    control(page,"#cameraAlignment").select_option("30")
    control(page,"#brushRadius").select_option("0")
    control(page,"#paintTool").select_option("select")
    reveal(page,page.get_by_role("button",name="Reset terrain")).click()
    control(page,"#resetView").click()
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
    control(page,"#cameraAlignment").select_option("0")
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).camera.alignment_deg===0")
    assert not errors,errors
    print("GPU depth, Atlas sprite load, scatter promotion, multi-selection, keyboard camera, brush plan replay, object brush, context, procedural controls and front/back alignment passed")
    browser.close()
