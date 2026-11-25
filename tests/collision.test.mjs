import test from "node:test";
import assert from "node:assert/strict";
import {World} from "../src/core.mjs";
import {uniformShape} from "../src/geometry.mjs";
import {placeObject} from "../src/entities.mjs";
import {sweptCylinder,objectVolumes,createCollisionIndex,firstObjectBlock} from "../src/collision.mjs";
import {walkStep,moveObject,standability,routeGeometryStamp,interactObject} from "../src/navigation.mjs";
const cfg={schema:"smi-hex-world/1",id:"collision",grid:{horizontal_ft:5,vertical_ft:5,geometry_subdivisions:2,chunk_size:[16,16,16]},simulation:{mode:"frozen",rate:1}};
const p={schema:"smi-hex-movement/1",height_ft:4,max_step_ft:2.5,max_grade:1,max_nodes:512},body={kind:"cylinder",radius_ft:.5,height_ft:3};
const v={manifest:"./test.json",asset:"fixture"};
function world(){const w=new World(cfg);for(let q=-1;q<=0;q++)for(let r=-1;r<=0;r++)for(let z=-1;z<=0;z++)w.defineChunk(q,r,z);for(const a of [[-1,0,0],[0,0,0],[1,0,0],[0,1,0],[1,-1,0]])w.set(...a,{material:"soil",shape:uniformShape(2)});return w;}
test("continuous sweep detects between endpoints, vertical separation and grazing",()=>{const c={center:[0,0],bottom:5,top:8,radius:1};assert.equal(sweptCylinder([-3,0,5],[3,0,5],4,0,c),true);assert.equal(sweptCylinder([-3,1,5],[3,1,5],4,0,c),false);assert.equal(sweptCylinder([-3,1,5],[3,1,5],4,.1,c),true);assert.equal(sweptCylinder([-3,0,8],[3,0,8],4,0,c),false);assert.equal(sweptCylinder([0,0,5],[0,0,5],4,0,c),true);assert.equal(sweptCylinder([-3,0,0],[3,0,20],1,0,c),true);assert.equal(sweptCylinder([-3,0,0],[3,0,30],1,0,c),false);});
test("off-center obstacle blocks an edge, route detours, actor excludes itself",()=>{const w=world();placeObject(w,{id:"actor",address:[-1,0,0],anchor:"surface",visual:v,collider:body});placeObject(w,{id:"prop",address:[0,0,0],anchor:"surface",offset_ft:[2,0,0],visual:v,collider:body});assert.equal(walkStep(w,[0,0,0],[1,0,0],p).reason,"blocked object");assert.equal(standability(w,[1,0,0],p).ok,true);assert.equal(moveObject(w,"actor",[1,0,0],p,{presentation:true}).ok,true);assert.equal(w.getEntity("actor").address[0],1);});
test("blocked destination is atomic; collider edits and saves preserve independent dimensions",()=>{const w=world();placeObject(w,{id:"actor",address:[-1,0,0],anchor:"surface",visual:v});placeObject(w,{id:"prop",address:[0,0,0],anchor:"surface",visual:v,collider:body});const before=w.snapshot(),stamp=routeGeometryStamp(w,[[-1,0,0],[0,0,0]],p);assert.equal(moveObject(w,"actor",[0,0,0],p).ok,false);assert.deepEqual(w.snapshot(),before);assert.deepEqual(World.restore(before).getEntity("prop").collider,body);assert.throws(()=>w.setEntityCollider("prop",{...body,radius_ft:-1}));assert.deepEqual(w.snapshot(),before);w.setEntityCollider("prop",null);assert.notEqual(routeGeometryStamp(w,[[-1,0,0],[0,0,0]],p),stamp);assert.equal(moveObject(w,"actor",[0,0,0],p).ok,true);assert.equal(objectVolumes(w).length,0);});
test("reachable target may be used without treating its own collider as a wall",()=>{const w=world();placeObject(w,{id:"actor",address:[-1,0,0],anchor:"surface",visual:v});placeObject(w,{id:"prop",address:[0,0,0],anchor:"surface",visual:v,collider:body});const rules={schema:"smi-hex-interactions/1",rules:[]};assert.equal(interactObject(w,"actor",[0,0,0],p,rules,"prop").ok,true);assert.equal(interactObject(w,"actor",[0,0,0],p,rules).ok,false);});

test("collision stamp notices support geometry under a blocker outside the route chunks",()=>{const w=world();w.defineChunk(1,0,0);w.set(16,0,0,{material:"soil",shape:uniformShape(2)});placeObject(w,{id:"remote",address:[16,0,0],anchor:"surface",visual:v,collider:body});const path=[[0,0,0],[1,0,0]],before=routeGeometryStamp(w,path,p);w.set(16,0,0,{material:"soil",shape:uniformShape(1)});assert.notEqual(routeGeometryStamp(w,path,p),before);});

test("spatial broad phase agrees with exhaustive sweep across negative buckets, floors and large radii",()=>{
  const volumes=Array.from({length:240},(_,i)=>({id:String(i),center:[(i%20-10)*13,(Math.floor(i/20)-6)*9],bottom:i%3*10,top:i%3*10+5,radius:i%7+1}));
  volumes.push({id:"wide",center:[-16,16],bottom:0,top:8,radius:20});
  const index=createCollisionIndex(volumes);
  for(let i=0;i<100;i++){
    const from=[(i%17-8)*11,(i%11-5)*8,i%4*7],to=[from[0]+(i%5-2)*23,from[1]+(i%3-1)*17,from[2]+i%7-3],profile={height_ft:4,radius_ft:i%4};
    const hits=volumes.filter(v=>sweptCylinder(from,to,profile.height_ft,profile.radius_ft,v));
    assert.deepEqual([...index.candidates(from,to,profile.radius_ft,profile.height_ft)].filter(v=>sweptCylinder(from,to,profile.height_ft,profile.radius_ft,v)).map(v=>v.id).sort(),hits.map(v=>v.id).sort());
    const hit=firstObjectBlock(index,from,to,profile);assert.equal(hit!==null,hits.length>0);
  }
  assert.ok([...index.candidates([0,0,0],[2,0,0],0,4)].length<volumes.length/4);
});
test("conditional collision persists one authoritative input and changes navigation immediately",()=>{
  const w=world(),a=[0,0,0],condition={...body,disabled_when:{input:"open",equals:true}};
  placeObject(w,{id:"gate",address:a,anchor:"surface",visual:{...v,inputs:{open:false}},collider:condition});
  const stamp=w.collisionRevision;assert.equal(standability(w,a,p).ok,false);
  w.setEntityAppearance("gate",{inputs:{open:true}});assert.equal(standability(w,a,p).ok,true);assert.equal(w.collisionRevision,stamp+1);
  w.setEntityAppearance("gate",{inputs:{open:true},slots:{contents:"new"}});assert.equal(w.collisionRevision,stamp+1);
  const restored=World.restore(w.snapshot());assert.equal(standability(restored,a,p).ok,true);
  const before=restored.snapshot();assert.throws(()=>restored.setEntityAppearance("gate",{}));assert.deepEqual(restored.snapshot(),before);
  restored.setEntityAppearance("gate",{inputs:{open:false}});assert.equal(standability(restored,a,p).ok,false);
});
