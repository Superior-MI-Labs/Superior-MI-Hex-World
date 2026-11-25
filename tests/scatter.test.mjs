import test from "node:test";
import assert from "node:assert/strict";
import {World} from "../src/core.mjs";
import {uniformShape} from "../src/geometry.mjs";
import {buildScatterPlan,thinScatter,promoteSample} from "../src/scatter.mjs";
import {validateStyle} from "../src/art-style.mjs";
import {readFileSync} from "node:fs";
const cfg={schema:"smi-hex-world/1",id:"w",grid:{horizontal_ft:5,vertical_ft:5,geometry_subdivisions:2,chunk_size:[16,16,16]},simulation:{mode:"frozen",rate:1}};
const p=validateStyle(JSON.parse(readFileSync(new URL("../examples/meadow-style.json",import.meta.url))));
function world(){const w=new World(cfg);w.defineChunk(-1,0,0);w.defineChunk(0,0,0);for(const a of [[-1,0,0],[0,0,0],[1,0,0]])w.set(...a,{material:"soil",shape:uniformShape(1),components:{surface:{growth:1}}});return w;}
test("neighborhood spacing is stable across active bounds and input order",()=>{const w=world(),a=[-1,0,0],b=[0,0,0],c=[1,0,0];const all=buildScatterPlan(w,[a,b,c],p),local=buildScatterPlan(w,[b],p);assert.deepEqual(local,all.filter(s=>s.address.join()==b.join()));assert.ok(all.length>0);for(let i=0;i<all.length;i++)for(let j=i+1;j<all.length;j++)assert.ok(Math.hypot(all[i].point[0]-all[j].point[0],all[i].point[1]-all[j].point[1])>=1.4-1e-9);assert.deepEqual(thinScatter([...all].reverse()).map(s=>s.key).sort(),all.map(s=>s.key).sort());});
test("promotion persists suppression and entity without regenerating after deletion",()=>{const w=world(),addresses=[[-1,0,0],[0,0,0],[1,0,0]],all=buildScatterPlan(w,addresses,p),s=all[0];const style={scatter:new Map([[s.family,new Map([[s.variant,{base:{binding:{manifest:"./a.json",asset:"a",height_ft:2}}}]])]])};promoteSample(w,style,s,"placed");assert.equal(w.entityCount,1);assert.ok(w.get(...s.address).components.scatter_hidden.includes(s.key));const after=buildScatterPlan(w,addresses,p);assert.equal(after.length,all.length-1);const restored=World.restore(w.snapshot());restored.removeEntity("placed");assert.deepEqual(buildScatterPlan(restored,addresses,p),after);const before=w.snapshot();assert.throws(()=>promoteSample(w,style,s,"another"));assert.deepEqual(w.snapshot(),before);});
test("invalid or duplicate suppression is atomic",()=>{const w=world(),a=[0,0,0],before=w.snapshot();assert.throws(()=>w.promoteScatter("",{id:"x",address:a,anchor:"surface",visual:{manifest:"./a.json",asset:"a"}}));assert.deepEqual(w.snapshot(),before);assert.throws(()=>w.set(...a,{...w.get(...a),components:{scatter_hidden:["x","x"]}}));assert.deepEqual(w.snapshot(),before);});
