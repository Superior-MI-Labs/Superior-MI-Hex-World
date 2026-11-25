import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
globalThis.VisualAtlasSlots=createRequire(import.meta.url)("../vendor/atlas/slot-core.js");
import {validateStyle,vegetationSamples,resolveStyleProfile,loadStyle,fetchStyle,vegetationRaster,terrainTexturePlan,vegetationWind,scatterSamples,scatterRaster} from "../src/art-style.mjs";
import {validateSpritePack} from "../src/assets.mjs";
import {visibleTriangle} from "../src/camera.mjs";
const fullProfile=validateStyle(JSON.parse(readFileSync(new URL("../examples/meadow-style.json",import.meta.url))));
const profile=structuredClone(fullProfile);delete profile.vegetation.families;
const pack=JSON.parse(readFileSync(new URL("../examples/meadow-art/manifest.json",import.meta.url)));
test("art style references canonical Atlas regions and a wind state set",()=>{for(const id of [profile.detail.top,profile.detail.side,profile.vegetation.assets["meadow-02"],profile.vegetation.assets["meadow-03"]])assert.equal(validateSpritePack(pack,id).get(id).kind,"region");const id=profile.vegetation.assets["meadow-01"].asset;assert.equal(validateSpritePack(pack,id).get(id).kind,"state_set");});
test("art style rejects broken visual parameters",()=>{assert.throws(()=>validateStyle({...profile,lighting:{ambient:.5,direction:[0,0,0]}}));assert.throws(()=>validateStyle({...profile,vegetation:{...profile.vegetation,samples_per_triangle:100}}));});
test("stable vegetation samples conform to slope and LOD retains a subset",()=>{
  const f={kind:"top",triangle:2,address:[-4,3,0],points:[[0,0,0],[5,0,5],[0,5,5]],vegetation:1,variant:"meadow-01"};
  const full=vegetationSamples(f,"w",profile,24),mid=vegetationSamples(f,"w",profile,12);
  assert.equal(full.length,3);assert.deepEqual(full,vegetationSamples(f,"w",profile,24));assert.deepEqual(mid,full.slice(0,mid.length));assert.equal(vegetationSamples(f,"w",profile,8).length,0);
  for(const {point:[x,y,z]} of full){assert.ok(x>=0&&y>=0&&x+y<=5+1e-9);assert.ok(Math.abs(z-x-y)<1e-9);}
});
test("conservative viewport culling keeps crossing triangles and padded sprites",()=>{const view=([x,y])=>({x,y});const f={points:[[-10,50],[110,50],[50,-10]]};assert.equal(visibleTriangle(f,view,100,100),true);const g={points:[[105,5],[110,5],[108,10]]};assert.equal(visibleTriangle(g,view,100,100),false);assert.equal(visibleTriangle(g,view,100,100,10),true);});

test("independent agent packs resolve relative to the style document, not the host",async()=>{
  const baseURL="https://example.org/styles/meadow.json",p=structuredClone(profile);p.manifest="./ground/manifest.json";
  p.detail.side={manifest:"https://assets.example.org/cliff/manifest.json",asset:"cliff"};
  p.vegetation.assets={"meadow-01":{manifest:"../grass/manifest.json",asset:"grass"},"meadow-02":{manifest:"../grass/manifest.json",asset:"grass"},"meadow-03":{manifest:"../grass/manifest.json",asset:"tall"}};
  delete p.vegetation.wind;delete p.vegetation.seasonal;delete p.detail.materials;
  const opened=[],loaded=[];const openPack=async manifest=>{opened.push(manifest);return {createRaster({asset,regionOnly}){assert.equal(regionOnly,asset==="cliff"||asset===p.detail.top);loaded.push([manifest,asset]);return {image:{},async update(){}};}};};
  const r=await loadStyle(p,{baseURL,openPack});
  assert.equal(opened.length,3);assert.equal(loaded.length,4);assert.equal(r.vegetation.get("meadow-01"),r.vegetation.get("meadow-02"));
  assert.equal(r.profile.detail.top.manifest,"https://example.org/styles/ground/manifest.json");
  assert.throws(()=>resolveStyleProfile({...p,detail:{...p.detail,top:{manifest:"javascript:alert(1)",asset:"a"}}},baseURL));
  assert.throws(()=>validateStyle({...p,detail:{...p.detail,color_mode:"unknown"}}));
  const catalog={vegetation:{variants:[{id:"meadow-01"},{id:"meadow-02"},{id:"meadow-03"}]}};
  const load=()=>fetchStyle("https://example.org/styles/meadow.json",catalog,{baseURL,openPack,fetcher:async()=>({ok:true,text:async()=>JSON.stringify({...p,vegetation:{...p.vegetation,assets:{"meadow-01":"x"}}})})});
  await assert.rejects(load,/Missing vegetation binding/);
});

test("wind states share pack and use authored sequence only at sustained threshold",async()=>{const calls=[],openPack=async manifest=>({createRaster(b){calls.push(b);return {binding:b,image:{},async update(){}};}});const s=await loadStyle(profile,{baseURL:"https://example.org/style.json",openPack});assert.equal(vegetationRaster(s,"meadow-01",{velocity_ft_s:[0,0]}).binding.state,"calm");assert.equal(vegetationRaster(s,"meadow-01",{velocity_ft_s:[8,0]}).binding.state,"wind");assert.equal(calls.filter(c=>c.requireState).length,2);assert.equal(vegetationRaster(s,"meadow-02",{velocity_ft_s:[15,0]}),s.vegetation.get("meadow-02"));});

test("material layers share static raster loading; seasonal overrides preserve fallback",async()=>{const calls=[],openPack=async()=>({createRaster(b){calls.push(b);return {binding:b,image:{},async update(){}};}});const s=await loadStyle(profile,{baseURL:"https://example.org/style.json",openPack});assert.equal(s.materialRasters.get("stone").top,s.side);assert.equal(vegetationRaster(s,"meadow-01",{velocity_ft_s:[20,0]},"autumn"),s.vegetation.get("meadow-03"));assert.equal(vegetationRaster(s,"meadow-03",{velocity_ft_s:[0,0]},"spring"),s.vegetation.get("meadow-03"));assert.throws(()=>validateStyle({...profile,vegetation:{...profile.vegetation,seasonal:{monsoon:{}}}}));});
test("texture plan collapses unmapped materials and preserves weighted layers",()=>{const f={kind:"top",material:"soil",attributes:[{materialWeights:[["soil",1]]},{materialWeights:[["soil",.5],["stone",.5]]},{materialWeights:[["sand",.25],["soil",.25],["stone",.5]]}]};const p=terrainTexturePlan(f,profile);assert.deepEqual(p.keys,[null,"sand","stone"]);assert.deepEqual(p.weights,[[1,0,0,0],[.5,0,.5,0],[.25,.25,.5,0]]);assert.deepEqual(terrainTexturePlan(f,null).weights,[[1,0,0,0],[1,0,0,0],[1,0,0,0]]);});

test("seasonal asset may independently declare wind state and flexibility",async()=>{const p=structuredClone(profile);p.vegetation.seasonal.winter["meadow-01"]={asset:"smi.hex.grass.states.fixture",state:"calm",wind:{bend:.2,states:[{min_speed_ft_s:5,state:"wind"}]}};const openPack=async()=>({createRaster(b){return {binding:b,image:{},async update(){}};}});const s=await loadStyle(p,{baseURL:"https://example.org/style.json",openPack});assert.equal(vegetationRaster(s,"meadow-01",{velocity_ft_s:[6,0]},"winter").binding.state,"wind");assert.equal(vegetationRaster(s,"meadow-01",{velocity_ft_s:[0,0]},"winter").binding.state,"calm");assert.equal(vegetationWind(s.profile,"meadow-01","winter").bend,.2);assert.equal(vegetationWind(s.profile,"meadow-01","autumn").bend,.42);});

test("scatter is independent of grass, conforms to slopes and preserves stable LOD",()=>{
  const p=structuredClone(fullProfile),f=p.vegetation.families[0];f.density=1;f.samples_per_triangle=4;
  const face={kind:"top",material:"soil",triangle:2,address:[-16,3,0],points:[[0,0,0],[5,0,2],[0,5,2]],surface:{growth:1,scorch:0,snow:0},vegetation:0};
  const all=scatterSamples(face,"w",p,24),mid=scatterSamples(face,"w",p,9.5);
  assert.equal(all.length,4);assert.deepEqual(mid,all.slice(0,2));assert.deepEqual(scatterSamples(face,"w",p,24),all);
  for(const s of all)assert.ok(Math.abs(s.point[2]-.4*(s.point[0]+s.point[1]))<1e-9);
  assert.equal(scatterSamples({...face,surface:{...face.surface,scorch:1}},"w",p,24).length,0);
  assert.equal(scatterSamples({...face,material:"stone"},"w",p,24).length,0);
  assert.equal(scatterSamples({...face,points:[[0,0,0],[5,0,20],[0,5,20]]},"w",p,24).length,0);
  assert.equal(scatterSamples({...face,kind:"side"},"w",p,24).length,0);
  assert.throws(()=>validateStyle({...p,vegetation:{...p.vegetation,families:[f,f]}}));
  f.variants[0].weight=0;assert.throws(()=>validateStyle(p));
});
test("scatter adopts actual Atlas height, views and wind; reuses pack sessions and seasonal size",async()=>{
  const p=structuredClone(fullProfile),v=p.vegetation.families[0].variants[0];v.seasonal={winter:"smi.hex.grass.02"};
  const opened=[],openPack=async(url)=>{opened.push(url);return {describe:id=>validateSpritePack(pack,id).get(id),createRaster(b){return {binding:b,image:{},async update(){}};}};};
  const s=await loadStyle(p,{baseURL:"https://example.org/style.json",openPack});assert.equal(opened.length,1);
  const sample={family:"brush-fixture",variant:"tall",orientation:0,scale:1},calm={velocity_ft_s:[0,0]};
  const a=scatterRaster(s,sample,calm,"summer",1);assert.equal(a.r.binding.asset,"smi.hex.grass.02");assert.equal(a.height,2.5);assert.equal(a.wind.bend,.35);
  const winter=scatterRaster(s,sample,calm,"winter",3);assert.equal(winter.r.binding.asset,"smi.hex.grass.02");assert.equal(winter.height,a.height);assert.equal(winter.seasonal,true);
  const windy=scatterRaster(s,{...sample,variant:"sway"},{velocity_ft_s:[20,0]},"summer",0);assert.equal(windy.r.binding.state,"wind");assert.equal(windy.animatedState,true);
  const broken=structuredClone(p);broken.vegetation.families[0].variants[0].asset="missing";await assert.rejects(()=>loadStyle(broken,{baseURL:"https://example.org/style.json",openPack}),/Missing asset/);
});
