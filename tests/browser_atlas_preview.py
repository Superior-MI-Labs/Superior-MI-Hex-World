"""Live published Atlas audit: requires local HTTP server and Playwright."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

out=Path("/tmp/hex-world-atlas-preview")
out.mkdir(parents=True,exist_ok=True)
counts={"fantasy-recovered-grass-20261125":12,"fantasy-recovered-foliage-20261125":16,
        "fantasy-recovered-trees-20261125":2,"fantasy-recovered-chests-20261125":4,
        "painterly-fantasy-seasonal-fern":5,"painterly-fantasy-understory":5,
        "painterly-fantasy-woodland":9}
with sync_playwright() as p:
    browser=p.chromium.launch(args=["--use-angle=swiftshader","--enable-unsafe-swiftshader"])
    page=browser.new_page(viewport={"width":1200,"height":1000})
    page.goto("http://127.0.0.1:8000/")
    page.wait_for_function("document.querySelector('#status').textContent.includes('WebGL2')")
    report=page.evaluate("""async counts=>{
      const {fetchCatalog}=await import('/src/catalog.mjs');
      const {openAtlasPack}=await import('/src/assets.mjs');
      const entries=await fetchCatalog(),rows=[],packs=[];
      for(const [id,expected] of Object.entries(counts)){
        const group=entries.filter(e=>e.pack===id);
        const packRow={id,expected,count:group.length,ok:false};packs.push(packRow);
        if(group.length!==expected){packRow.error='Inventory count mismatch';continue;}
        const {manifest,archive_sha256}=group[0].binding;
        Object.assign(packRow,{manifest,archive_sha256});
        let pack;try{pack=await openAtlasPack(manifest,undefined,archive_sha256);packRow.ok=true;}
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
    page.locator("#loadWoodlandPreview").evaluate("(b)=>b.click()")
    page.wait_for_function("JSON.parse(document.querySelector('#status').textContent).art_style==='published-woodland-preview'",timeout=180000)
    page.screenshot(path=str(out/"woodland.png"))
    assert len(report["rows"])==sum(counts.values()),report["packs"]
    assert all(p["ok"] for p in report["packs"]),report["packs"]
    assert all(r["ok"] for r in report["rows"]),[r for r in report["rows"] if not r["ok"]]
    print("Published preview: all 53 records rasterized; artistic and directional qualification pending.")
    browser.close()
