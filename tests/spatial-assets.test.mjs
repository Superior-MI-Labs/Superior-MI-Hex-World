import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
import {validateSpritePack} from "../src/assets.mjs";
import {adoptSpatialProfile} from "../src/spatial-assets.mjs";
import {directionalBinding} from "../src/entities.mjs";
const require=createRequire(import.meta.url);globalThis.VisualAtlasSlots=require("../vendor/atlas/slot-core.js");
const pack=JSON.parse(readFileSync(new URL("../examples/meadow-art/manifest.json",import.meta.url)));
const raw={manifest:"./examples/meadow-art/manifest.json",asset:"smi.hex.grass.01"};
test("self-describing spatial asset resolves from validated manifest without a manual binding",()=>{
  const a=validateSpritePack(pack,raw.asset).get(raw.asset),{binding,warnings}=adoptSpatialProfile(raw,a);
  assert.deepEqual(warnings,[]);assert.equal(binding.height_ft,2.5);assert.equal(binding.wind.bend,.35);assert.equal(binding.views.length,6);
  assert.equal(directionalBinding(binding,1).asset,"smi.hex.grass.02");
  const override=adoptSpatialProfile({...raw,height_ft:7,wind:{bend:0}},a).binding;assert.equal(override.height_ft,7);assert.equal(override.wind.bend,0);
  const other=structuredClone(a);other.spatial.views.elevation_deg=45;
  const fallback=adoptSpatialProfile(raw,other);assert.equal(fallback.binding.views,undefined);assert.equal(fallback.warnings.length,1);
  assert.throws(()=>adoptSpatialProfile(raw,{id:"wrong"}));
});
test("broken view dependency is rejected, and declared wind states are adopted",()=>{
  const bad=structuredClone(pack);bad.assets.find(a=>a.id===raw.asset).spatial.views.assets[1]="missing";assert.throws(()=>validateSpritePack(bad,raw.asset),/spatial/);
  const asset="smi.hex.grass.states.fixture",a=validateSpritePack(pack,asset).get(asset);
  assert.deepEqual(adoptSpatialProfile({...raw,asset},a).binding.wind.states,[{min_speed_ft_s:8,state:"wind"}]);
});
