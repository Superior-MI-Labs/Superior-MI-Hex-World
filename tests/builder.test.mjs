import test from "node:test";import assert from "node:assert/strict";
import {World} from "../src/core.mjs";import {uniformShape} from "../src/geometry.mjs";import {CellEditHistory,applyEditPlan} from "../src/editor.mjs";import {pathFootprint,planPath,planGrade,planGrove,planWoodlandClearing} from "../src/builder.mjs";
const cfg={schema:"smi-hex-world/1",id:"builder",grid:{horizontal_ft:5,vertical_ft:5,geometry_subdivisions:2,chunk_size:[16,16,16]},simulation:{mode:"frozen",rate:1}};
const solid={material:"soil",shape:uniformShape(2)},a=[-1,0,0],b=[0,0,0],c=[1,0,0];
function world(){const w=new World(cfg);w.defineChunk(-1,0,0,solid);w.defineChunk(0,0,0,solid);return w;}
test("waypoint footprint follows contiguous hexes and rejects cross-layer paths",()=>{assert.deepEqual(pathFootprint([a,c]).map(x=>x.address),[a,b,c]);assert.ok(pathFootprint([a,c],1).length>3);assert.throws(()=>pathFootprint([a,[0,0,1]]));assert.throws(()=>pathFootprint([[0,0,0],[130,0,0]]));});
test("fixed river and road share reviewed edits, preserve world until applied, undo restores terrain",()=>{const w=world(),h=new CellEditHistory(w),before=w.snapshot(),p=planPath(w,[a,c],{kind:"river",height:1,fill:.8,speed:2});assert.deepEqual(w.snapshot(),before);applyEditPlan(w,h,p);assert.equal(w.get(...b).shape.upper[0],1);assert.deepEqual(w.get(...b).components.water,{fill:.8,fixed:true,flow_ft_s:[2,0]});h.undo();assert.deepEqual(w.get(...b),solid);h.redo();assert.equal(w.get(...b).components.water.fixed,true);applyEditPlan(w,h,planPath(w,[a,c]));assert.equal(w.get(...b).components.water,undefined);assert.equal(w.get(...b).material,"stone");assert.throws(()=>planPath(w,[a,c],{kind:"river",height:2,fill:1}));});
test("grading blocks unknown terrain and placed objects without mutation",()=>{const w=world(),opts={height:1,material:"stone"};assert.throws(()=>planGrade(w,[[99,0,0]],opts),/Unknown/);w.putEntity({id:"keep",address:b,anchor:"surface",visual:{manifest:"./x.json",asset:"x"}});const before=w.snapshot();assert.throws(()=>planPath(w,[a,c]),/blocked/);assert.throws(()=>planGrade(w,[a,b],opts),/blocked/);assert.deepEqual(w.snapshot(),before);});
test("grove is deterministic independent of input order, excludes occupied and wet cells",()=>{const w=world();w.set(...a,{material:"soil",shape:uniformShape(1),components:{water:{fill:.8}}});const bindings=[{manifest:"./x.json",asset:"oak"},{manifest:"./x.json",asset:"pine"}],opts={bindings,seed:"woods",density:1};const p=planGrove(w,[a,b,c],opts);assert.deepEqual(p,planGrove(w,[c,b,a],opts));assert.equal(p.plan.entities.length,2);const h=new CellEditHistory(w);applyEditPlan(w,h,p.plan);assert.equal(w.entityCount,2);assert.equal(planGrove(w,[a,b,c],opts).plan.entities,undefined);h.undo();assert.equal(w.entityCount,0);});

test("woodland clearing is one deterministic reversible plan with fixed water and two pinned props",()=>{
 const w=new World(cfg);for(const q of [-1,0])for(const r of [-1,0])w.defineChunk(q,r,0,solid);
 const tree={manifest:"https://example.org/tree.zip",asset:"tree",archive_sha256:"a".repeat(64),height_ft:18},chest={...tree,asset:"chest",height_ft:2.5};
 const opts={tree,chest},before=w.snapshot(),plan=planWoodlandClearing(w,[0,0,0],opts);
 assert.deepEqual(planWoodlandClearing(w,[0,0,0],opts),plan);assert.deepEqual(w.snapshot(),before);
 assert.equal(plan.edits.length,8);assert.equal(plan.entities.length,2);
 const h=new CellEditHistory(w);applyEditPlan(w,h,plan);assert.equal(w.entityCount,2);
 assert.equal(w.get(-2,1,0).components.water.fixed,true);assert.equal(w.get(-1,-1,0).components.water,undefined);
 const after=w.snapshot();h.undo();assert.deepEqual(w.snapshot(),before);h.redo();assert.deepEqual(w.snapshot(),after);
 assert.throws(()=>planWoodlandClearing(w,[0,0,0],opts),/free/);
 assert.throws(()=>planWoodlandClearing(w,[100,100,0],opts),/Unknown/);
});
