import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
import {validateSpritePack} from "../src/assets.mjs";
import {spriteBinding,visualKey,directionalBinding} from "../src/entities.mjs";
import {World} from "../src/core.mjs";
const require=createRequire(import.meta.url);globalThis.VisualAtlasSlots=require("../vendor/atlas/slot-core.js");globalThis.VisualAtlasInteraction=require("../vendor/atlas/interaction-core.js");
const pack=JSON.parse(readFileSync(new URL("../examples/chest-fixture/manifest.json",import.meta.url)));
const id="fixture.chest",visual={manifest:"./examples/chest-fixture/manifest.json",asset:id,preset:"treasure",inputs:{open:false},slots:{contents:"fixture.chest.gems"}};
test("composition and compatible choices use the canonical Atlas resolver",()=>{const a=validateSpritePack(pack,id).get(id);const slots=globalThis.VisualAtlasSlots.resolve(a,visual.preset,visual.slots);assert.equal(slots.slots.contents,"fixture.chest.gems");assert.equal(slots.inputs.open,true);assert.throws(()=>globalThis.VisualAtlasSlots.resolve(a,null,{contents:"fixture.chest.front"}));const bad=structuredClone(pack);bad.assets.at(-1).layers[0].asset=id;assert.throws(()=>validateSpritePack(bad,id),/Cyclic/);});
test("appearance selections are normalized, persist, and do not change the entity position",()=>{const cfg={schema:"smi-hex-world/1",id:"w",grid:{horizontal_ft:5,vertical_ft:5,geometry_subdivisions:2,chunk_size:[16,16,16]},simulation:{mode:"frozen",rate:1}},w=new World(cfg);w.defineChunk(0,0,0);w.putEntity({id:"chest",address:[0,0,0],anchor:"cell",visual});w.setEntityAppearance("chest",{preset:"closed",inputs:{open:true}});const e=World.restore(w.snapshot()).getEntity("chest");assert.equal(e.visual.inputs.open,true);assert.equal(e.visual.slots,undefined);assert.deepEqual(e.address,[0,0,0]);assert.equal(directionalBinding(e.visual,2).preset,"closed");assert.equal(visualKey({...visual,inputs:{b:1,a:true}}),visualKey({...visual,inputs:{a:true,b:1}}));assert.throws(()=>spriteBinding({...visual,inputs:{open:{code:"x"}}}));assert.throws(()=>spriteBinding({...visual,archive_sha256:"a".repeat(64)}));});

import {dispatchAppearance,appearanceOptions,collisionSelection} from "../src/asset-interactions.mjs";
test("authored use resolves preset, preserves slots and changes only visual input",()=>{const a=pack.assets.at(-1),s={preset:"treasure",slots:{contents:"fixture.chest.gems"}};const first=dispatchAppearance(a,s,"use");assert.equal(first.selection.inputs.open,false);assert.equal(first.selection.slots.contents,"fixture.chest.gems");assert.equal(first.outputs.opened,false);assert.equal(first.events[0].name,"chest_visual_changed");assert.equal(dispatchAppearance(a,first.selection,"use").selection.inputs.open,true);assert.equal(dispatchAppearance(a,s,"enter"),null);assert.equal(appearanceOptions(a,s).inputs.open,true);});

test("host collider condition materializes canonical preset values and rejects undeclared inputs",()=>{
  const a=pack.assets.at(-1),c={kind:"cylinder",radius_ft:1,height_ft:3,disabled_when:{input:"open",equals:true}};
  assert.equal(collisionSelection(a,{preset:"treasure"},c).inputs.open,true);
  assert.equal(collisionSelection(a,{preset:"closed"},c).inputs.open,false);
  assert.equal(collisionSelection(a,{preset:"treasure",inputs:{open:false}},c).inputs.open,false);
  assert.throws(()=>collisionSelection(a,{}, {...c,disabled_when:{input:"unknown",equals:true}}));
  assert.throws(()=>collisionSelection(a,{}, {...c,disabled_when:{input:"open",equals:"yes"}}));
});
