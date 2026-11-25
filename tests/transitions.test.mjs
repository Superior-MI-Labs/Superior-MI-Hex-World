import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {World} from "../src/core.mjs";
import {uniformShape,EDGE_NEIGHBORS,oppositeEdge} from "../src/geometry.mjs";
import {TerrainFaceCache} from "../src/terrain.mjs";
import {decorateTerrain} from "../src/surface-render.mjs";
import {withSurface,validateMaterials,transitionSettings} from "../src/materials.mjs";
const catalog=validateMaterials(JSON.parse(readFileSync(new URL("../examples/materials.json",import.meta.url))));
const cfg={schema:"smi-hex-world/1",id:"w",grid:{horizontal_ft:5,vertical_ft:5,geometry_subdivisions:2,chunk_size:[16,16,16]},simulation:{mode:"frozen",rate:1}};
const cell=(snow=0,shape=uniformShape(2),material="soil")=>withSurface({material,shape},{growth:1,snow});
function world(){const w=new World(cfg);for(let q=-1;q<=0;q++)for(let r=-1;r<=0;r++)for(let z=-1;z<=0;z++)w.defineChunk(q,r,z);return w;}
const top=(faces,e)=>faces.find(f=>f.kind==="top"&&f.triangle===e);
test("connected surface edges share identical color and coverage, centers retain state",()=>{
  for(let e=0;e<6;e++){const w=world(),a=[0,0,0],b=[...EDGE_NEIGHBORS[e],0],o=oppositeEdge(e);w.set(...a,cell(0));w.set(...b,cell(1));
    const x=top(decorateTerrain(w,[a],catalog),e),y=top(decorateTerrain(w,[b],catalog),o);
    assert.equal(x.attributes[0].cover[1],0);assert.equal(y.attributes[0].cover[1],1);
    assert.deepEqual(x.attributes[1],y.attributes[2]);assert.deepEqual(x.attributes[2],y.attributes[1]);assert.equal(x.attributes[1].cover[1],.5);
  }
});
test("three-cell corner is consistent independently of render domain and order",()=>{
  const w=world(),a=[0,0,0],b=[0,1,0],c=[1,0,0];w.set(...a,cell(0));w.set(...b,cell(1));w.set(...c,cell(.5));
  const x=top(decorateTerrain(w,[a],catalog),0),y=top(decorateTerrain(w,[b],catalog),3),z=top(decorateTerrain(w,[c],catalog),2);
  assert.deepEqual(x.attributes[1],y.attributes[2]);assert.deepEqual(x.attributes[1],z.attributes[1]);assert.equal(x.attributes[1].cover[1],.5);
});
test("cliffs, unknown cells and buried surfaces do not blend across gaps",()=>{
  const w=world(),a=[0,0,0],b=[0,1,0];w.set(...a,cell(0));w.set(...b,cell(1,uniformShape(1)));
  let x=top(decorateTerrain(w,[a],catalog),0);assert.equal(x.attributes[1].cover[1],0);
  w.set(...b,cell(1));w.set(0,1,1,cell());x=top(decorateTerrain(w,[a],catalog),0);assert.equal(x.attributes[1].cover[1],0);
  const u=new World(cfg);u.defineChunk(0,0,0);u.set(...a,cell(1));x=top(decorateTerrain(u,[a],catalog),2);assert.equal(x.attributes[1].cover[1],1);
});
test("side rim derives snow and distance, not hanging leaves",()=>{
  const w=world(),a=[0,0,0];w.set(...a,withSurface(cell(1),{growth:1,snow:1,leaves:1,scorch:.4}));
  const f=decorateTerrain(w,[a],catalog).filter(f=>f.kind==="side"&&f.edge===0);
  assert.ok(f.length>0);for(const t of f)for(const [i,p] of t.attributes.entries()){assert.equal(p.cover[0],0);assert.equal(p.cover[1],1);assert.equal(p.cover[2],.4);assert.ok(Math.abs(p.rim-(5-t.points[i][2]))<1e-8);}
});
test("transitions are deterministic derived data; disabled preserves cell coverage",()=>{
  const w=world(),a=[0,0,0],b=[-1,0,0];w.set(...a,cell());w.set(...b,cell(1));const before=w.snapshot(),one=decorateTerrain(w,[a,b],catalog);
  assert.deepEqual(one,decorateTerrain(w,[a,b],catalog));assert.deepEqual(w.snapshot(),before);
  const off=top(decorateTerrain(w,[a],catalog,{enabled:false}),2);assert.ok(off.attributes.every(p=>p.cover[1]===0));
});
test("mesh cache preserves topology on surface edits and invalidates cross-chunk geometry",()=>{
  const w=world(),a=[0,0,0],b=[-1,0,0];w.set(...a,cell());w.set(...b,cell());
  const cache=new TerrainFaceCache(w),first=cache.get(a);w.set(...b,cell(1));assert.equal(cache.get(a),first);
  w.set(...b,cell(1,uniformShape(1)));const second=cache.get(a);assert.notEqual(second,first);assert.ok(second.filter(f=>f.edge===2).length>0);
});
test("cache reacts to newly known neighbor and validates catalog parameters",()=>{
  const w=new World(cfg),a=[0,0,0];w.defineChunk(0,0,0);w.set(...a,cell());const cache=new TerrainFaceCache(w),first=cache.get(a);w.defineChunk(-1,0,0);assert.notEqual(cache.get(a),first);
  assert.throws(()=>transitionSettings({edge_strength:2}));assert.throws(()=>transitionSettings({mask:{asset:"a"}}));
});
