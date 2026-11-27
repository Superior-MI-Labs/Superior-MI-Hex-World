import test from "node:test";
import assert from "node:assert/strict";
import {World,effect} from "../src/core.mjs";
import {uniformShape} from "../src/geometry.mjs";
import {terrainOcclusion,directionalShadows,spriteShade,collectPointLights,selectPointLights,PointShadowCache,pointShadowDirection,POINT_SHADOW_WIDTH,POINT_SHADOW_HEIGHT} from "../src/lighting.mjs";
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

test("attached point lights resolve real anchors, follow poses, and survive saves",()=>{
  const w=new World(cfg);w.defineChunk(0,0,0);w.set(0,0,0,solid);
  w.putEntity({id:"torch",address:[0,0,0],anchor:"surface",visual:{manifest:"./p.json",asset:"torch"}});
  const l={color:[1,.5,.2],radius_ft:12,intensity:1,offset_z_ft:2,flicker:.3,emissive:.5};w.setEntityLight("torch",l);
  const before=w.snapshot(),a=collectPointLights(w,{visualTime:1});assert.equal(a.length,1);assert.deepEqual(a[0].point,[0,0,7]);assert.deepEqual(collectPointLights(w,{visualTime:1}),a);assert.notEqual(collectPointLights(w,{visualTime:2})[0].intensity,a[0].intensity);
  const poses=new Map([["torch",{address:[1,0,0],point:[5,0,5]}]]);assert.deepEqual(collectPointLights(w,{poses})[0].point,[5,0,7]);assert.equal(collectPointLights(w,{displayed:()=>false}).length,0);
  assert.deepEqual(w.snapshot(),before);assert.deepEqual(World.restore(before).getEntity("torch").light,l);assert.throws(()=>w.setEntityLight("torch",{...l,radius_ft:100}));assert.deepEqual(w.snapshot(),before);
  w.setEntityLight("torch",null);assert.equal(collectPointLights(w).length,0);
});
test("timed fires use simulation clock, co-located effects deduplicate, render budget is deterministic",()=>{
 const w=new World(cfg);w.defineChunk(0,0,0);w.set(0,0,0,solid);
 for(const id of ["a","b"])w.putEffect({id,kind:"fire",address:[0,0,0],instance:effect({behavior:"timed",duration:5},0)});
 assert.equal(collectPointLights(w,{simulationTime:4,visualTime:100}).length,1);assert.equal(collectPointLights(w,{simulationTime:5}).length,0);
 const face={points:[[0,0,0],[1,0,0],[0,1,0]]},lights=Array.from({length:30},(_,i)=>({id:String(i).padStart(2,"0"),point:[0,0,0],radius:4,color:[1,1,1],intensity:1}));
 lights.push({...lights[0],id:"remote",point:[100,100,100]});const plan=selectPointLights(lights,[face]);assert.equal(plan.lights.length,24);assert.equal(plan.omitted,6);assert.deepEqual(selectPointLights([...lights].reverse(),[face]),plan);
});

test("local shadow maps use actual terrain, ignore flicker, invalidate on edits and exclude moving lights",()=>{
 const w=new World(cfg);for(const q of [-1,0])for(const r of [-1,0])for(const z of [-1,0])w.defineChunk(q,r,z);
 const source={id:"torch",point:[0,0,2.5],radius:12,intensity:1},cache=new PointShadowCache(),before=w.snapshot();
 const clear=cache.prepare(w,[source]);assert.equal(clear.diagnostics.rays,POINT_SHADOW_WIDTH*POINT_SHADOW_HEIGHT);
 assert.ok(clear.plan.data.every(v=>v===255));assert.deepEqual(w.snapshot(),before);
 const same=cache.prepare(w,[{...source,intensity:.5}]);assert.equal(same.plan,clear.plan);assert.equal(same.diagnostics.rays,0);
 w.set(1,0,0,solid);
 const blocked=cache.prepare(w,[source]);assert.notEqual(blocked.plan,clear.plan);assert.ok(blocked.plan.data[4*POINT_SHADOW_WIDTH+8]<160);
 assert.ok(pointShadowDirection(8,4)[0]>.9);
 w.set(1,0,0,{material:"air",shape:uniformShape(0)});
 assert.ok(cache.prepare(w,[source]).plan.data.every(v=>v===255));
 assert.equal(cache.prepare(w,[{...source,moving:true}]).plan,null);
 const budget=cache.prepare(w,[source,{...source,id:"a"},{...source,id:"b"},{...source,id:"far",radius:40}]);
 assert.deepEqual(budget.plan.ids,["a","b"]);assert.equal(budget.diagnostics.omitted,2);assert.equal(budget.diagnostics.rays,2*POINT_SHADOW_WIDTH*POINT_SHADOW_HEIGHT);
});
