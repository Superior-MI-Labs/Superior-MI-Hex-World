import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {validateStyle,vegetationSamples,resolveStyleProfile,loadStyle,fetchStyle,vegetationRaster} from "../src/art-style.mjs";
import {validateSpritePack} from "../src/assets.mjs";
import {visibleTriangle} from "../src/camera.mjs";
const profile=validateStyle(JSON.parse(readFileSync(new URL("../examples/meadow-style.json",import.meta.url))));
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
  delete p.vegetation.wind;
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
