import test from "node:test";
import assert from "node:assert/strict";
import {World,Clock} from "../src/core.mjs";
import {uniformShape} from "../src/geometry.mjs";
import {waterFaces,buildWaterSurfaces,waterBed,waterVolume,fillForVolume,sharedSill,planWaterStep,stepWater,waterTicks} from "../src/water.mjs";
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

const wet=(fill,shape=uniformShape(0))=>cell(shape,{fill,flow_ft_s:[0,0]});
const full={material:"stone",shape:uniformShape(2)};
function enclosed(addresses){
  const w=new World(cfg);for(let q=-1;q<=0;q++)for(let r=-1;r<=0;r++)for(let z=-1;z<=0;z++)w.defineChunk(q,r,z,full);
  for(const [address,value] of addresses)w.set(...address,value);return w;
}
const total=w=>[...w.waterAddresses()].reduce((s,a)=>{const c=w.get(...a),b=waterBed(c,cfg.grid);return s+(b?waterVolume(b,c.components.water.fill):0);},0);
test("exact normalized basin volume, inverse and shared edge sill",()=>{
  const b=[1,1,1,1,1,1,0];assert.ok(Math.abs(waterVolume(b,.5)-1/24)<1e-12);
  for(const h of [.1,.25,.5,.75,1])assert.ok(Math.abs(fillForVolume(b,waterVolume(b,h))-h)<1e-10);
  assert.equal(waterVolume(Array(7).fill(.5),.75),.25);
  const a=[0,1,0,0,0,0,0],other=[0,0,0,0,1,0,0];assert.equal(sharedSill(a,other,0),.5);
});
test("lateral equilibration conserves volume across a negative chunk boundary",()=>{
  const a=[-1,0,0],b=[0,0,0],w=enclosed([[a,wet(.9)],[b,wet(.1,uniformShape(1))]]);
  const before=w.snapshot(),mass=total(w);assert.ok(planWaterStep(w).edits.length===2);assert.deepEqual(w.snapshot(),before);
  for(let i=0;i<80;i++){const r=stepWater(w);assert.ok(Math.abs(r.before_ft3-r.after_ft3)<1e-6);}
  assert.ok(Math.abs(total(w)-mass)<1e-9);assert.ok(Math.abs(w.get(...a).components.water.fill-w.get(...b).components.water.fill)<1e-7);
  assert.deepEqual(World.restore(w.snapshot()).snapshot(),w.snapshot());
});
test("closed basin, unknown boundary and suspended slab do not leak",()=>{
  const a=[-1,0,0],b=[0,0,0],w=enclosed([[a,wet(.5,{lower:Array(7).fill(0),upper:[2,2,2,2,2,2,0]})],[b,wet(0)]]);
  assert.equal(stepWater(w).edits.length,0);
  w.set(...a,wet(.3,uniformShape(2,1)));const before=w.snapshot();assert.equal(stepWater(w).unsupported,1);assert.deepEqual(w.snapshot(),before);
  const edge=new World(cfg);edge.defineChunk(-1,0,0,full);edge.set(-1,0,0,wet(.8));assert.equal(stepWater(edge).edits.length,0);
});
test("gravity drains open floors, blocks solid floors, conserves mass under competing flux",()=>{
  const a=[0,0,0],b=[0,0,-1],c=[1,0,0],d=[0,1,0],w=enclosed([[a,wet(1)],[b,wet(.2)],[c,wet(0)],[d,wet(0)]]);
  const mass=total(w);for(let i=0;i<20;i++)stepWater(w);assert.ok(Math.abs(total(w)-mass)<1e-9);assert.ok(w.get(...b).components.water.fill>.2);
  for(const addr of [a,b,c,d])assert.ok((w.get(...addr).components?.water?.fill??0)<=1);
  const blocked=enclosed([[a,wet(.8,uniformShape(1))],[b,wet(0)]]);assert.equal(stepWater(blocked).edits.length,0);
});
test("wet index covers default chunks and overrides, clock and opt-in round trip",()=>{
  const w=new World({...cfg,grid:{...cfg.grid,chunk_size:[2,2,2]}});w.defineChunk(-1,0,0,wet(.2));assert.equal([...w.waterAddresses()].length,8);
  w.set(-2,0,0,wet(0));assert.equal([...w.waterAddresses()].length,7);
  w.setEnvironment({...w.environment,water_simulation:true});const restored=World.restore(w.snapshot());assert.equal(restored.environment.water_simulation,true);assert.equal([...restored.waterAddresses()].length,7);
  const c=new Clock();c.animate(10);assert.equal(waterTicks(0,c.simulation),0);c.configure("manual");c.advance(6);assert.equal(waterTicks(0,c.simulation),12);assert.equal(waterTicks(0,.49)+waterTicks(.49,1),2);
});
