"""Live published Atlas audit: requires local HTTP server and Playwright."""
import json
import statistics
from pathlib import Path
from playwright.sync_api import sync_playwright
from workspace_helpers import control, reveal

out=Path("/tmp/hex-world-atlas-preview")
out.mkdir(parents=True,exist_ok=True)

def wait_for_host(page,style):
    # The module initializes asynchronously. Never JSON.parse an empty pre
    # before the first successful frame. The style check remains mandatory.
    page.wait_for_function("document.querySelector('#status')?.textContent.includes('WebGL2')",timeout=120000)
    page.wait_for_function("style=>JSON.parse(document.querySelector('#status').textContent).art_style===style",arg=style,timeout=120000)

counts={"fantasy-recovered-grass-20261125":12,"fantasy-recovered-foliage-20261125":16,
        "fantasy-recovered-trees-20261125":2,"fantasy-recovered-chests-20261125":4,
        "painterly-fantasy-seasonal-fern":5,"painterly-fantasy-understory":5,
        "painterly-fantasy-woodland":9}
with sync_playwright() as p:
    browser=p.chromium.launch(args=["--use-angle=swiftshader","--enable-unsafe-swiftshader"])
    page=browser.new_page(viewport={"width":1200,"height":1000},accept_downloads=True)
    errors=[]
    page.on("pageerror",lambda e: errors.append(str(e)))
    page.goto("http://127.0.0.1:8000/")
    wait_for_host(page,"fantasy-meadow-fixture")
    page.wait_for_function("document.querySelector('#assetStatus').textContent==='Atlas sprite loaded'",timeout=120000)
    status=lambda: page.evaluate("JSON.parse(document.querySelector('#status').textContent)")
    def measure():
        # Existing profiler publishes 500ms windows. Record settled windows,
        # never impose a hardware-specific FPS gate on software WebGL.
        page.wait_for_timeout(1500)
        samples=[]
        for _ in range(5):
            page.wait_for_timeout(600)
            s=status()
            samples.append({k:s[k] for k in ("performance","camera","visible_triangles","vegetation_instances","scatter_instances","object_instances","resident_chunks")})
        return {"samples":samples,"median_frame_ms":statistics.median(s["performance"]["frame_ms"] for s in samples)}
    fixture_performance=measure()
    report=page.evaluate("""async counts=>{
      const {fetchCatalog}=await import('/src/catalog.mjs');
      const {atlasPackSession}=await import('/src/assets.mjs');
      const entries=await fetchCatalog(),rows=[],packs=[];
      for(const [id,expected] of Object.entries(counts)){
        const group=entries.filter(e=>e.pack===id);
        const packRow={id,expected,count:group.length,ok:false};packs.push(packRow);
        if(group.length!==expected){packRow.error='Inventory count mismatch';continue;}
        const {manifest,archive_sha256}=group[0].binding;
        Object.assign(packRow,{manifest,archive_sha256});
        let pack;try{pack=await atlasPackSession(manifest,undefined,archive_sha256);packRow.ok=true;}
        catch(e){packRow.error=String(e);continue;}
        for(const e of group){
          const row={id:e.id,pack:id,license:e.license,visual_qa:e.visual_qa,ok:false};rows.push(row);
          try{
            if(e.binding.manifest!==manifest||e.binding.archive_sha256!==archive_sha256)throw Error('Inconsistent pack binding');
            const a=pack.describe(e.id);
            if(a.kind!==e.kind||e.license!=='CC0-1.0')throw Error('Unexpected kind or license');
            row.kind=a.kind;row.height_ft=a.spatial?.height_ft??null;
            row.views=a.spatial?.views?.assets.length??1;row.wind=Boolean(a.spatial?.wind);
            row.samples=[];
            for(const state of a.kind==='state_set'?Object.keys(a.states):[null]){
              const r=pack.createRaster({asset:e.id,state});await r.update(0);
              const {width,height}=r.image,data=r.image.getContext('2d').getImageData(0,0,width,height).data;
              let visible=0,transparent=0;
              for(let i=3;i<data.length;i+=4){if(data[i]>0)visible++;else transparent++;}
              row.samples.push({state,width,height,pivot:r.pivot,visible,transparent});
              if(!visible||!transparent)throw Error('Expected visible artwork with transparent pixels');
            }
            row.role=row.samples.some(s=>s.pivot[1]<.5)?'hanging-sprite-preview':'upright-sprite-preview';
            row.interactive=false;row.terrain=false;row.ok=true;
          }catch(e){row.error=String(e);}
        }
      }
      return {packs,rows};
    }""",counts)
    (out/"report.json").write_text(json.dumps(report,indent=2))
    assert len(report["rows"])==sum(counts.values()),report["packs"]
    assert all(p["ok"] for p in report["packs"]),report["packs"]
    assert all(r["ok"] for r in report["rows"]),[r for r in report["rows"] if not r["ok"]]
    control(page,"#loadWoodlandPreview").evaluate("(b)=>b.click()")
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).art_style==='published-woodland-preview'",timeout=180000)
    report["performance"]={"fixture":fixture_performance,"woodland":measure(),"note":"Same island/camera; CI SwiftShader, not target hardware"}
    (out/"report.json").write_text(json.dumps(report,indent=2))
    # Select a published chest through the existing catalog, not a special-case loader.
    asset="smi.world.fantasy.recovered.chests-20261125.weathered-wood-chest"
    control(page,"summary",has_text="Browse published Atlas assets").click()
    control(page,"#refreshCatalog").click()
    page.wait_for_function("document.querySelector('#catalogDomain').value==='world-environment'",timeout=120000)
    control(page,"#catalogSearch").fill(asset)
    page.wait_for_function("document.querySelector('#catalogAssets').options.length===1")
    assert control(page,"#catalogCards button").count()==1
    control(page,"#catalogCards button").click()
    assert control(page,"#catalogAssets").input_value()==asset
    control(page,"#loadCatalogAsset").click()
    page.wait_for_function("document.querySelector('#assetStatus').textContent==='Atlas sprite loaded' && document.querySelector('#spatialStatus').textContent.includes('2.5 ft')",timeout=120000)
    before=status()["world_objects"]
    control(page,"#placeActor").click()
    page.wait_for_function("n=>JSON.parse(document.querySelector('#status').textContent).world_objects===n+1",arg=before)
    control(page,"#objects").select_option(label=control(page,"#objects option").filter(has_text=asset).text_content())
    page.wait_for_function("id=>JSON.parse(document.querySelector('#status').textContent).selected_object_view===id",arg=asset)
    entity_id=control(page,"#objects").input_value()
    control(page,"#rotateObject").click()
    page.wait_for_function("document.querySelector('#objectOrientation').textContent==='60°'")
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).unresolved_objects===0")
    # Exercise the real catalog place/rotate route above, then remove that
    # temporary object and construct both pinned props in one reviewed plan.
    control(page,"#removeObject").click()
    page.wait_for_function("n=>JSON.parse(document.querySelector('#status').textContent).world_objects===n",arg=before)
    with page.expect_download() as baseline:
        control(page,"#save").click()
    base_world=json.loads(Path(baseline.value.path()).read_text())
    assert len(base_world["entities"])==before
    control(page,"#previewWoodland").evaluate("(b)=>b.click()")
    try:
        page.wait_for_function("!document.querySelector('#applyEditPlan').disabled",timeout=120000)
    except Exception:
        print("Clearing preview failure:",control(page,"#planStatus").text_content())
        page.screenshot(path=str(out/"clearing-failure.png"),full_page=True)
        raise
    with page.expect_download() as staged:
        control(page,"#exportStagedPlan").evaluate("(b)=>b.click()")
    plan=json.loads(Path(staged.value.path()).read_text())
    (out/"clearing-edit-plan.json").write_text(json.dumps(plan,indent=2))
    assert len(plan["edits"])==8 and len(plan["entities"])==2
    entity_id=next(e["id"] for e in plan["entities"] if e["value"]["visual"]["asset"]==asset)
    control(page,"#applyEditPlan").evaluate("(b)=>b.click()")
    total=before+2
    page.wait_for_function("n=>{const s=JSON.parse(document.querySelector('#status').textContent);return s.world_objects===n&&s.water_triangles>0&&s.unresolved_objects===0}",arg=total)
    control(page,"#undoEdit").click()
    page.wait_for_function("n=>{const s=JSON.parse(document.querySelector('#status').textContent);return s.world_objects===n-2&&s.water_triangles===0}",arg=total)
    control(page,"#redoEdit").click()
    page.wait_for_function("n=>{const s=JSON.parse(document.querySelector('#status').textContent);return s.world_objects===n&&s.water_triangles>0}",arg=total)
    control(page,"#wire").uncheck()
    control(page,"#zoom").evaluate("(e)=>{e.value='12';e.dispatchEvent(new Event('input'))}")
    for yaw in range(6):
        page.wait_for_function("yaw=>{const c=JSON.parse(document.querySelector('#status').textContent).camera;return c.yaw===yaw&&!c.rotating}",arg=yaw)
        control(page,"#viewport").screenshot(path=str(out/f"woodland-view-{yaw}.png"))
        control(page,"#rotate").click()
    page.wait_for_function("(()=>{const c=JSON.parse(document.querySelector('#status').textContent).camera;return c.yaw===0&&!c.rotating})()")
    with page.expect_download() as saved:
        control(page,"#save").click()
    world=json.loads(Path(saved.value.path()).read_text())
    (out/"clearing-world.json").write_text(json.dumps(world,indent=2))
    fixed=[c["value"]["components"]["water"] for chunk in world["chunks"] for c in chunk["cells"] if c["value"].get("components",{}).get("water",{}).get("fixed")]
    assert len(fixed)==4 and all(w["fill"]==.8 for w in fixed)
    entity=next(e for e in world["entities"] if e["id"]==entity_id)
    assert entity["orientation_steps"]==next(e["value"]["orientation_steps"] for e in plan["entities"] if e["id"]==entity_id) and entity["visual"]["asset"]==asset and entity["visual"]["height_ft"]==2.5
    pack=next(p for p in report["packs"] if p["id"]=="fantasy-recovered-chests-20261125")
    assert entity["visual"]["archive_sha256"]==pack["archive_sha256"]
    with page.expect_download() as style:
        control(page,"#exportArt").evaluate("(b)=>b.click()")
    profile=json.loads(Path(style.value.path()).read_text())
    (out/"resolved-style.json").write_text(json.dumps(profile,indent=2))
    report["checkpoint"]={"raster_audit":True,"catalog_placement":True,"mixed_plan":True,"undo_redo":True,"camera_views":6,"fixed_water_cells":len(fixed),"fresh_session_round_trip":False}
    (out/"report.json").write_text(json.dumps(report,indent=2))
    print("Published preview checkpoint: 53 records, placement, mixed plan, undo/redo and six views passed; starting fresh-session restore.")
    # Restart Chromium, not merely reload a tab with retained scroll/form/GPU state.
    browser.close()
    browser=p.chromium.launch(args=["--use-angle=swiftshader","--enable-unsafe-swiftshader"])
    page=browser.new_page(viewport={"width":1200,"height":1000},accept_downloads=True)
    page.on("pageerror",lambda e: errors.append(str(e)))
    try:
        response=page.goto("http://127.0.0.1:8000/",wait_until="domcontentloaded",timeout=60000)
        assert response and response.ok,"Fresh host document failed"
        wait_for_host(page,"fantasy-meadow-fixture")
        page.wait_for_function("document.querySelector('#assetStatus').textContent==='Atlas sprite loaded'",timeout=120000)
    except Exception:
        details=page.evaluate("""()=>Object.fromEntries(['status','artStatus','assetStatus','message'].map(id=>[id,document.getElementById(id)?.textContent??null]))""")
        report["fresh_session_failure"]={"details":details,"page_errors":errors}
        (out/"report.json").write_text(json.dumps(report,indent=2))
        print("Fresh session failure:",json.dumps(report["fresh_session_failure"]))
        page.screenshot(path=str(out/"fresh-session-failure.png"),full_page=True)
        raise
    try:
        control(page,"#importArt").set_input_files({"name":"style.json","mimeType":"application/json","buffer":json.dumps(profile).encode()})
        page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).art_style==='published-woodland-preview'",timeout=180000)
        control(page,"#load").set_input_files({"name":"world.json","mimeType":"application/json","buffer":json.dumps(world).encode()})
        page.wait_for_function("document.querySelector('#message').textContent==='World imported'",timeout=120000)
        control(page,"#zoom").evaluate("(e)=>{e.value='12';e.dispatchEvent(new Event('input'))}")
        page.wait_for_function("n=>{const s=JSON.parse(document.querySelector('#status').textContent);return s.world_objects===n&&s.unresolved_objects===0&&s.object_instances>=n&&s.water_triangles>0}",arg=total,timeout=120000)
    except Exception:
        report["restore_failure"]={"details":page.evaluate("""()=>Object.fromEntries(['status','artStatus','assetStatus','message'].map(id=>[id,document.getElementById(id)?.textContent??null]))"""),"page_errors":errors}
        (out/"report.json").write_text(json.dumps(report,indent=2))
        print("Restore failure:",json.dumps(report["restore_failure"]))
        page.screenshot(path=str(out/"restore-failure.png"),full_page=True)
        raise
    with page.expect_download() as restored:
        control(page,"#save").click()
    restored_world=json.loads(Path(restored.value.path()).read_text())
    recovered=next(e for e in restored_world["entities"] if e["id"]==entity_id)
    assert recovered==entity
    assert restored_world["chunks"]==world["chunks"] and restored_world["entities"]==world["entities"]
    assert restored_world["world"]==world["world"] and restored_world["clock"]==world["clock"] and restored_world["effects"]==world["effects"]
    with page.expect_download() as restored_style:
        control(page,"#exportArt").evaluate("(b)=>b.click()")
    assert json.loads(Path(restored_style.value.path()).read_text())==profile
    control(page,"#viewport").screenshot(path=str(out/"woodland-restored.png"))
    report["clearing"]={"edit_cells":len(plan["edits"]),"objects":len(plan["entities"]),"fixed_water_cells":len(fixed),"undo_redo":True,"frozen_water_persisted":True}
    report["round_trip"]={"entity":entity,"restored":True,"style":profile["id"],"camera_views":6,"directional_qa":"not claimed; static billboard"}
    report["checkpoint"]["fresh_session_round_trip"]=True
    report["page_errors"]=errors
    (out/"report.json").write_text(json.dumps(report,indent=2))
    assert not errors,errors
    print("Published preview: 53 raster records, six camera captures, pinned object and style round-trip passed; artistic/directional qualification pending.")
    browser.close()
