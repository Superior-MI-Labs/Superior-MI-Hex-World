import test from "node:test";
import assert from "node:assert/strict";
import {World} from "../src/core.mjs";
import {uniformShape} from "../src/geometry.mjs";
import {waterFaces,buildWaterSurfaces} from "../src/water.mjs";
const cfg={schema:"smi-hex-world/1",id:"water",grid:{horizontal_ft:5,vertical_ft:5,geometry_subdivisions:2,chunk_size:[16,16,16]},simulation:{mode:"frozen",rate:1}};
const a=[-1,0,0],water={fill:.5,flow_ft_s:[2,-1]},cell=(shape=uniformShape(0),w=water)=>({material:shape.upper.some((v,i)=>v>shape.lower[i])?"stone":"air",shape,components:{water:w}});
function world(){const w=new World(cfg);w.defineChunk(-1,0,0);return w;}
const area=faces=>faces.reduce((sum,f)=>{const [a,b,c]=f.points;return sum+Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/2;},0);
test("water clips slopes using existing fan, with stable world positions and local depth",()=>{
  const w=world();w.set(...a,cell());const full=waterFaces(w,a);assert.equal(full.length,6);assert.ok(full.every(f=>f.depth.every(d=>d===2.5)));
  w.set(...a,cell({lower:Array(7).fill(0),upper:[2,2,2,2,2,2,0]}));
  const before=w.snapshot(),f=waterFaces(w,a);assert.ok(Math.abs(area(f)/area(full)-.25)<1e-6);assert.ok(f.every(x=>x.points.every(p=>p[2]===2.5)));assert.ok(f.every(x=>x.flow[0]===2));assert.deepEqual(w.snapshot(),before);
  w.set(...a,cell(uniformShape(2)));assert.equal(waterFaces(w,a).length,0);
  w.set(...a,cell(uniformShape(2,1),{...water,fill:.25}));assert.equal(waterFaces(w,a).length,6);
});
test("full columns suppress internal surfaces and unknown ceiling, preserve water through save",()=>{
 const w=world();w.set(...a,cell(uniformShape(0),{...water,fill:1}));assert.equal(waterFaces(w,a).length,6);
 w.set(-1,0,1,cell(uniformShape(0)));assert.equal(waterFaces(w,a).length,0);assert.equal(buildWaterSurfaces(w,[a,[-1,0,1]]).length,6);
 w.set(-1,0,1,{material:"stone",shape:uniformShape(2)});assert.equal(waterFaces(w,a).length,0);
 w.set(-1,0,15,cell(uniformShape(0),{...water,fill:1}));assert.equal(waterFaces(w,[-1,0,15]).length,0);
 const before=w.snapshot();assert.deepEqual(World.restore(before).get(...a).components.water,{...water,fill:1});assert.throws(()=>w.set(...a,cell(uniformShape(0),{fill:2})));assert.deepEqual(w.snapshot(),before);
});
