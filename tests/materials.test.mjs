import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {World,Clock} from "../src/core.mjs";
import {uniformShape} from "../src/geometry.mjs";
import {surface,validateMaterials,variantFor,appearance,ignite,advanceSurface,withSurface} from "../src/materials.mjs";
const catalog=validateMaterials(JSON.parse(readFileSync(new URL("../examples/materials.json",import.meta.url))));
const cell=withSurface({material:"soil",shape:uniformShape(2)},{growth:1,leaves:.5});
test("surface independent from substrate and normalized",()=>{assert.throws(()=>surface({snow:1.1}));assert.throws(()=>surface({burn:-1}));assert.equal(cell.material,"soil");assert.equal(cell.components.surface.health,1);});
test("weighted variants deterministic with diversity",()=>{const a=[-1,3,2];assert.deepEqual(variantFor(catalog,"world",a),variantFor(catalog,"world",a));assert.equal(new Set(Array.from({length:100},(_,i)=>variantFor(catalog,"world",[i,0,0]).id)).size,3);});
test("snow and scorch suppress vegetation, stone cannot grow grass",()=>{const snowy=withSurface(cell,{...cell.components.surface,snow:1});assert.equal(appearance(catalog,"w",[0,0,0],snowy,"top").vegetation,0);assert.deepEqual(appearance(catalog,"w",[0,0,0],snowy,"side").cover,[0,0,0]);assert.equal(appearance(catalog,"w",[0,0,0],{...cell,material:"stone"},"top").vegetation,0);});
test("reactive burn advances only with simulation and leaves char",()=>{const c=new Clock(),s=ignite(catalog,cell);assert.equal(s.burn,8);c.animate(8);assert.deepEqual(advanceSurface(s,c.simulation,8),s);c.configure("manual");c.advance(8);const end=advanceSurface(s,c.simulation,8);assert.equal(end.burn,0);assert.equal(end.growth,0);assert.equal(end.scorch,1);assert.equal(cell.components.surface.growth,1);});
test("wet, snowy, bare and stone surfaces reject ignition",()=>{for(const v of [withSurface(cell,{growth:1,moisture:1}),withSurface(cell,{growth:1,snow:1}),withSurface(cell,{}),{...cell,material:"stone"}])assert.equal(ignite(catalog,v).burn,0);});
test("surface state and active burn roundtrip, invalid surface rejected",()=>{const w=new World({schema:"smi-hex-world/1",id:"w",grid:{horizontal_ft:5,vertical_ft:5,geometry_subdivisions:2,chunk_size:[16,16,16]},simulation:{mode:"frozen",rate:1}});w.defineChunk(0,0,0);w.set(0,0,0,withSurface(cell,ignite(catalog,cell)));assert.deepEqual(World.restore(JSON.parse(JSON.stringify(w.snapshot()))).get(0,0,0),w.get(0,0,0));assert.throws(()=>w.set(0,0,0,{...cell,components:{surface:{growth:2}}}));});

import {weatherSurface,surfaceSubmerged} from "../src/materials.mjs";
test("authored exposure preserves geometry and water, thaws snow, and submerged vegetation cannot ignite",()=>{
 const cell={material:"soil",shape:{lower:Array(7).fill(0),upper:Array(7).fill(1)},components:{surface:{growth:.8,snow:.8,burn:4},water:{fill:.8,fixed:true}}};
 const climate={season:"summer",temperature_c:20,precipitation:"none",intensity:0};
 assert.equal(surfaceSubmerged(cell),true);
 assert.equal(ignite(catalog,{...cell,components:{...cell.components,surface:{growth:.8}}}).burn,0);
 const result=weatherSurface(cell,climate,600);
 assert.equal(result.moisture,1);assert.equal(result.burn,0);assert.ok(result.snow<.8);
 assert.equal(cell.components.surface.burn,4);assert.equal(cell.components.water.fixed,true);
 assert.throws(()=>weatherSurface(cell,{...climate,intensity:2},600),/Invalid exposure climate/);
 assert.equal(surfaceSubmerged({...cell,shape:{...cell.shape,upper:Array(7).fill(2)}}),false);
});