import test from "node:test";
import assert from "node:assert/strict";
import {World} from "../src/core.mjs";
import {uniformShape} from "../src/geometry.mjs";
import {terrainOcclusion,directionalShadows,spriteShade} from "../src/lighting.mjs";
import {validateLighting} from "../src/environment.mjs";
const cfg={schema:"smi-hex-world/1",id:"light",grid:{horizontal_ft:5,vertical_ft:5,geometry_subdivisions:2,chunk_size:[16,16,16]},simulation:{mode:"frozen",rate:1}},g=cfg.grid;
const light=validateLighting({ambient:.4,direction:[1,0,1]}),solid={material:"stone",shape:uniformShape(2)};
test("occlusion probes real geometry across a negative cell boundary; shared vertices match",()=>{
 const w=new World(cfg);w.defineChunk(-1,0,0);w.defineChunk(0,0,0);
 w.set(-1,0,0,solid);w.set(0,0,0,solid);
 const f={kind:"top",points:[[-2.5,0,5],[-3,0,5],[-3,1,5]]},other={...f,points:[[-2.5,0,5],[-2,0,5],[-2,1,5]]};
 assert.deepEqual(terrainOcclusion(w,[f])[0].occlusion,[0,0,0]);
 w.set(0,0,1,solid);const before=w.snapshot(),[a,b]=terrainOcclusion(w,[f,other]);assert.ok(a.occlusion[0]>0);assert.equal(a.occlusion[0],b.occlusion[0]);assert.deepEqual(w.snapshot(),before);
});
test("directional shadows extend opposite sun, obey level and budget, and never mutate geometry",()=>{
 const f={kind:"top",address:[-1,0,0],points:[[-3,0,5],[-2,0,5],[-3,1,5]]},other={...f,address:[-1,0,1]};
 const caster={address:[0,0,0],point:[0,0,5],height:5,radius:1,opacity:.5};
 const a=directionalShadows([f,other],[caster],light,g);assert.equal(a.faces.length,1);assert.equal(a.faces[0].points,f.points);assert.ok(a.faces[0].opacity>0);
 assert.equal(directionalShadows([f],[caster],{...light,direction:[-1,0,1]},g).faces.length,0);
 assert.equal(directionalShadows([f],[caster],{...light,direction:[1,0,-1]},g).faces.length,0);
 assert.equal(directionalShadows([f],[caster],light,g,{limit:0}).truncated,true);
 assert.ok(spriteShade(light)<1);assert.equal(spriteShade(null),1);
});
test("world lighting survives save and invalid values fail atomically",()=>{const w=new World(cfg);w.setEnvironment({...w.environment,lighting:light});assert.deepEqual(World.restore(w.snapshot()).environment.lighting,light);const before=w.snapshot();assert.throws(()=>w.setEnvironment({...w.environment,lighting:{...light,occlusion:2}}));assert.deepEqual(w.snapshot(),before);});
