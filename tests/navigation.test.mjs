import test from "node:test";
import assert from "node:assert/strict";
import {World} from "../src/core.mjs";
import {uniformShape} from "../src/geometry.mjs";
import {placeObject} from "../src/entities.mjs";
import {standability,walkStep,findRoute,moveObject,validateMovement} from "../src/navigation.mjs";
import {contactShadows} from "../src/lighting.mjs";
const cfg={schema:"smi-hex-world/1",id:"nav",grid:{horizontal_ft:5,vertical_ft:5,geometry_subdivisions:2,chunk_size:[16,16,16]},simulation:{mode:"frozen",rate:1}};
const p={schema:"smi-hex-movement/1",height_ft:4,max_step_ft:2.5,max_grade:1,max_nodes:512};
const solid=(h=2,l=0)=>({material:"stone",shape:uniformShape(h,l)});
function world(){const w=new World(cfg);for(let q=-1;q<=0;q++)for(let r=-1;r<=0;r++)for(let z=-1;z<=0;z++)w.defineChunk(q,r,z);return w;}
test("flat walking crosses negative chunk boundary; routes and object position persist",()=>{
 const w=world();for(const q of [-1,0,1])w.set(q,0,0,solid());
 assert.equal(walkStep(w,[-1,0,0],[0,0,0],p).ok,true);
 const route=findRoute(w,[-1,0,0],[1,0,0],p);assert.deepEqual(route.path,[[-1,0,0],[0,0,0],[1,0,0]]);
 placeObject(w,{id:"walker",address:[-1,0,0],anchor:"surface",visual:{manifest:"./test.json",asset:"actor",height_ft:4}});
 assert.equal(moveObject(w,"walker",[1,0,0],p).ok,true);assert.deepEqual(World.restore(w.snapshot()).getEntity("walker").address,[1,0,0]);
 assert.equal(moveObject(w,"walker",[3,0,0],p).ok,false);assert.deepEqual(w.getEntity("walker").address,[1,0,0]);
});
test("steps, steep slopes, cross-level movement and unsupported cells",()=>{
 const w=world();w.set(0,0,0,solid());w.set(1,0,0,solid(1));
 assert.equal(walkStep(w,[0,0,0],[1,0,0],p).ok,true);
 assert.equal(walkStep(w,[0,0,0],[1,0,0],{...p,max_step_ft:2}).ok,false);
 w.set(1,0,0,solid());w.set(1,0,1,solid(1));
 assert.equal(walkStep(w,[0,0,0],[1,0,1],p).ok,true);
 w.set(1,0,1,solid());assert.equal(walkStep(w,[0,0,0],[1,0,1],p).ok,false);
 const s=uniformShape(2);s.upper[6]=1;w.set(0,0,0,{material:"stone",shape:s});
 assert.equal(walkStep(w,[0,0,0],[1,0,1],p).ok,false);
 assert.equal(standability(w,[2,0,0],p).ok,false);
});
test("low ceiling blocks tall walker but allows a short walker",()=>{
 const w=world();w.set(0,0,0,solid());w.set(0,0,1,solid(2,1));
 assert.equal(standability(w,[0,0,0],p).ok,false);assert.equal(standability(w,[0,0,0],{...p,height_ft:2}).ok,true);
});
test("sloping roof that blocks only the edge rejects step",()=>{
 const w=world();w.set(0,0,0,solid());w.set(1,0,0,solid());
 const s=uniformShape(2,2);s.lower[5]=0;s.lower[0]=0;s.lower[6]=2;w.set(0,0,1,{material:"stone",shape:s});
 assert.equal(standability(w,[0,0,0],p).ok,true);assert.equal(walkStep(w,[0,0,0],[1,0,0],p).ok,false);
});
test("unknown headroom is blocked; route budget and profile validated",()=>{
 const w=new World({...cfg,grid:{...cfg.grid,chunk_size:[1,1,1]}});w.defineChunk(0,0,0,solid());assert.equal(standability(w,[0,0,0],p).reason,"unknown clearance");
 const a=world();a.set(0,0,0,solid());a.set(1,0,0,solid());assert.equal(findRoute(a,[0,0,0],[1,0,0],{...p,max_nodes:1}).reason,"Search budget reached");assert.throws(()=>validateMovement({...p,height_ft:-1}));
});
test("contact shadows use only actual support top triangles and preserve geometry",()=>{
 const a={kind:"top",address:[0,0,0],points:[[0,0,1],[1,0,2],[0,1,3]]};
 const b={...a,address:[0,0,1]},c={...a,kind:"side"};
 const [s,...other]=contactShadows([a,b,c],[{address:[0,0,0],point:[0,0,1],radius:1,opacity:.4}]);
 assert.equal(other.length,0);assert.equal(s.points,a.points);assert.deepEqual(s.uv,[[.5,.5],[1,.5],[.5,1]]);assert.equal(s.opacity,.4);
});

test("supported taper joins a lower floor, and grade is enforced independently of step",()=>{const w=world();w.set(0,0,0,solid());w.set(1,0,0,solid());const s=uniformShape(1);s.upper[2]=0;s.upper[3]=0;w.set(1,0,1,{material:"stone",shape:s});const from=[0,0,0],to=[1,0,1];assert.equal(walkStep(w,from,to,p).ok,true);assert.equal(walkStep(w,from,to,{...p,max_grade:.5}).reason,"slope too steep");w.set(1,0,0,{material:"air",shape:uniformShape(0)});assert.equal(walkStep(w,from,to,p).reason,"no known support");});
