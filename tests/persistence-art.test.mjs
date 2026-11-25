import test from "node:test";
import assert from "node:assert/strict";
import {World,Clock,effect,effectActive} from "../src/core.mjs";
import {uniformShape} from "../src/geometry.mjs";
import {capturePrefab,placePrefab} from "../src/prefabs.mjs";
const cfg={schema:"smi-hex-world/1",id:"w",grid:{horizontal_ft:5,vertical_ft:5,geometry_subdivisions:2,chunk_size:[16,16,16]},simulation:{mode:"frozen",rate:1}};
function world(){const w=new World(cfg);w.defineChunk(0,0,0);w.defineChunk(-1,0,0);return w;}
test("persistent and timed effects preserve clock across save and reload",()=>{
 const w=world(),clock=new Clock({mode:"manual"});clock.advance(12);
 for(const [id,instance] of [["a",effect({behavior:"persistent"},12)],["b",effect({behavior:"timed",duration:5},12)]])w.putEffect({id,kind:"fire",address:[0,0,0],instance});
 clock.advance(2);w.setClockState(clock.snapshot());const r=World.restore(JSON.parse(JSON.stringify(w.snapshot()))),c=Clock.restore(r.clockState);
 assert.equal(c.simulation,14);assert.equal(c.visual,0);assert.equal(r.effects().length,2);c.configure("frozen");c.animate(50);c.advance(10);
 assert.ok(r.effects().every(e=>effectActive(e.instance,c.simulation)));
 c.configure("manual");c.advance(3);assert.equal(r.effects().filter(e=>effectActive(e.instance,c.simulation)).length,1);
 assert.equal(r.removeEffect("a"),true);assert.equal(r.effects().length,1);
});
test("clock and effect validation, independent record copies, older saves",()=>{
 const w=world();assert.throws(()=>w.putEffect({id:"a",kind:"fire",address:[100,0,0],instance:effect({behavior:"persistent"})}));
 assert.throws(()=>w.putEffect({id:"a",kind:"fire",address:[0,0,0],instance:{behavior:"timed",duration:1}}));
 assert.throws(()=>w.setClockState({mode:"manual",rate:1,simulation:-1}));
 w.putEffect({id:"a",kind:"fire",address:[0,0,0],instance:effect({behavior:"persistent"})});
 const e=w.effects()[0];e.address[0]=99;assert.equal(w.effects()[0].address[0],0);assert.throws(()=>w.putEffect(w.effects()[0]));
 const save=w.snapshot();delete save.effects;delete save.clock;assert.equal(World.restore(save).effects().length,0);
});
test("capture explicit cells and re-place rotated recipe, without unrelated terrain",()=>{
 const w=world();w.set(-1,0,0,{material:"stone",shape:uniformShape(1)});w.set(0,0,0,{material:"soil",shape:uniformShape(2)});
 w.set(1,0,0,{material:"soil",shape:uniformShape(2)});
 const p=capturePrefab(w,[[-1,0,0],[0,0,0],[-1,0,0]],[-1,0,0],{id:"x",name:"Test"});
 assert.equal(p.cells.length,2);assert.deepEqual(p.cells.map(c=>c.offset),[[0,0,0],[1,0,0]]);
 placePrefab(w,p,[0,0,1],1);assert.equal(w.get(0,0,1).material,"stone");assert.equal(w.get(0,1,1).material,"soil");assert.equal(w.get(0,1,1).shape.upper[6],2);
 assert.throws(()=>capturePrefab(w,[[5,5,0]],[5,5,0],{id:"y",name:"Empty"}));
 assert.throws(()=>capturePrefab(w,[[100,0,0]],[100,0,0],{id:"y",name:"Unknown"}));
});
