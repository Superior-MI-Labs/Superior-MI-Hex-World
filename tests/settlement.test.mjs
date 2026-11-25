import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {World,physicalPosition} from "../src/core.mjs";
import {uniformShape} from "../src/geometry.mjs";
import {cellFaces} from "../src/terrain.mjs";
import {cutawayView,cutawayMask,traceVisibility} from "../src/visibility.mjs";
import {findRoute,routeWaypoints,sampleRoute,standability} from "../src/navigation.mjs";
import {buildSettlement,settlementDomain,SETTLEMENT} from "../src/settlement.mjs";
const cfg={schema:"smi-hex-world/1",id:"test",grid:{horizontal_ft:5,vertical_ft:5,geometry_subdivisions:2,chunk_size:[16,16,16]},simulation:{mode:"frozen",rate:1}};
const p={schema:"smi-hex-movement/1",height_ft:4,max_step_ft:2.5,max_grade:1,max_nodes:512};
const visual={manifest:"./test.json",asset:"actor",height_ft:4};
const catalog=JSON.parse(readFileSync(new URL("../examples/prefabs.json",import.meta.url)));
const solid=(h=2,l=0)=>({material:"stone",shape:uniformShape(h,l)});
function world(){const w=new World(cfg);for(let q=-1;q<=0;q++)for(let r=-1;r<=0;r++)for(let z=-1;z<=0;z++)w.defineChunk(q,r,z);return w;}
test("cutaway exposes covered floor without changing save or physical clearance",()=>{
 const w=world();w.set(0,0,0,solid());w.set(0,0,1,solid());
 const before=w.snapshot(),v=cutawayView(w,0);
 assert.equal(cellFaces(w,[0,0,0]).filter(f=>f.kind==="top").length,0);
 assert.equal(cellFaces(v,[0,0,0]).filter(f=>f.kind==="top").length,6);
 assert.equal(v.get(0,0,1).material,"air");assert.equal(v.get(100,0,1),undefined);
 assert.equal(standability(w,[0,0,0],p).ok,false);assert.deepEqual(w.snapshot(),before);
});
test("line of sight intersects actual slopes/volumes, preserves vertical clearance and reports unknown",()=>{
 const w=world();w.set(0,0,1,solid());
 assert.equal(traceVisibility(w,[-5,0,7],[5,0,7]).status,"blocked");
 assert.equal(traceVisibility(w,[-5,0,11],[5,0,11]).status,"clear");
 w.set(0,0,1,solid(2,1));
 assert.equal(traceVisibility(w,[-5,0,6],[5,0,6]).status,"clear");
 assert.equal(traceVisibility(w,[-5,0,9],[5,0,9]).status,"blocked");
 assert.equal(traceVisibility(w,[-5,0,9],[5,0,9],{maxCells:1}).status,"budget");
 const u=new World(cfg);u.defineChunk(0,0,0);
 assert.equal(traceVisibility(u,[0,0,2],[-10,0,2]).status,"unknown");
});
test("settlement has real doorway, roof, one continuous traversable floor and roundtrip",()=>{
 const w=buildSettlement(cfg,catalog,visual);assert.equal(w.config.scene,SETTLEMENT);
 assert.ok(settlementDomain.every(a=>w.get(...a)));assert.equal(w.get(0,0,2).material,"stone");
 assert.equal(w.get(-1,0,1).material,"air");assert.equal(w.get(1,0,1).material,"stone");
 const route=findRoute(w,[-2,0,0],[0,0,0],p);assert.deepEqual(route.path,[[-2,0,0],[-1,0,0],[0,0,0]]);
 assert.equal(traceVisibility(w,[-10,0,8],[0,0,8]).status,"clear");assert.equal(traceVisibility(w,[0,0,8],[10,0,8]).status,"blocked");
 assert.deepEqual(World.restore(w.snapshot()).snapshot(),w.snapshot());
});
test("visual route follows shared edge and vertical step; ends at authoritative destination",()=>{
 const w=world();w.set(0,0,0,solid(1));w.set(1,0,0,solid());
 const path=[[0,0,0],[1,0,0]],points=routeWaypoints(w,path,p);
 assert.deepEqual(points.map(v=>v.point.map(x=>Math.round(x*1e8)/1e8)),[[0,0,2.5],[2.5,0,2.5],[2.5,0,5],[5,0,5]].map(a=>a.map(v=>Math.round(v*1e8)/1e8)));
 assert.equal(sampleRoute(points,0).done,false);assert.equal(sampleRoute(points,100).done,true);
 assert.deepEqual(sampleRoute(points,100).address,[1,0,0]);assert.ok(Math.abs(sampleRoute(points,3.75).point[2]-3.75)<1e-8);
});

test("local cutaway removes only its hex-ring footprint and leaves outside roof geometry",()=>{const w=world();w.set(0,0,1,solid());w.set(2,0,1,solid());const before=w.snapshot(),v=cutawayView(w,0,{center:[0,0],radius:1});assert.equal(v.get(0,0,1).material,"air");assert.equal(v.get(2,0,1).material,"stone");const hidden=cutawayMask(0,{center:[-1,0],radius:1});assert.equal(hidden([0,0,1]),true);assert.equal(hidden([1,0,1]),false);assert.equal(hidden([0,0,0]),false);assert.deepEqual(w.snapshot(),before);});
test("flat route keeps seam ownership for contact shadows",()=>{const w=world();w.set(0,0,0,solid());w.set(1,0,0,solid());const points=routeWaypoints(w,[[0,0,0],[1,0,0]],p);assert.equal(points.length,4);assert.deepEqual(sampleRoute(points,2).address,[0,0,0]);assert.deepEqual(sampleRoute(points,3).address,[1,0,0]);assert.equal(sampleRoute(points,5.01).done,true);});
