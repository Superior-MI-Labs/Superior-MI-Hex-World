import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {World} from "../src/core.mjs";
import {uniformShape} from "../src/geometry.mjs";
import {placeObject} from "../src/entities.mjs";
import {planObjectMove,moveObject,interactObject} from "../src/navigation.mjs";
import {validateInteractions,bendBillboard,cellTarget,contactResponse,interactionTags} from "../src/interactions.mjs";
import {billboard} from "../src/camera.mjs";
const p=validateInteractions(JSON.parse(readFileSync(new URL("../examples/interactions.json",import.meta.url))));
const movement={schema:"smi-hex-movement/1",height_ft:4,max_step_ft:2.5,max_grade:1,max_nodes:512};
const config={schema:"smi-hex-world/1",id:"x",grid:{horizontal_ft:5,vertical_ft:5,geometry_subdivisions:2,chunk_size:[16,16,16]},simulation:{mode:"frozen",rate:1}};
const visual={manifest:"./test.json",asset:"test"};
function world(){const w=new World(config);for(let q=-1;q<=0;q++)for(let r=-1;r<=0;r++)for(let z=-1;z<=0;z++)w.defineChunk(q,r,z);
 for(const q of [-1,0,1,2])w.set(q,0,0,{material:"soil",shape:uniformShape(2),components:{surface:{growth:.8},interaction_tags:q===0?["sensor","usable"]:[]}});
 placeObject(w,{id:"actor",address:[-1,0,0],anchor:"surface",visual});
 placeObject(w,{id:"plant",address:[0,0,0],anchor:"surface",visual,interaction_tags:["flexible","usable"]});return w;}
test("preview is pure; committed route emits ordered enter/leave across chunks, including intermediate objects",()=>{
 const w=world(),before=w.snapshot(),to=[1,0,0];assert.equal(planObjectMove(w,"actor",to,movement).ok,true);assert.deepEqual(w.snapshot(),before);
 const r=moveObject(w,"actor",to,movement,{interactions:p,presentation:true});
 assert.equal(r.ok,true);assert.deepEqual(w.getEntity("actor").address,to);assert.equal(r.points.length,7);
 assert.deepEqual(r.events.filter(e=>e.target.kind==="cell").map(e=>[e.event,e.target.address[0]]),[["leave",-1],["enter",0],["leave",0],["enter",1]]);
 const signals=r.events.flatMap(e=>e.signals.map(s=>s.signal));for(const s of ["environment.sensor.enter","environment.sensor.leave","environment.prop.contact","environment.brush.contact"])assert.ok(signals.includes(s));
 assert.equal(r.events.some(e=>e.target.id==="actor"),false);assert.equal(moveObject(w,"actor",to,movement,{interactions:p}).events.length,0);
 const saved=w.snapshot(),blocked=moveObject(w,"actor",[99,0,0],movement,{interactions:p});assert.equal(blocked.ok,false);assert.deepEqual(w.snapshot(),saved);
});
test("explicit use targets one cell or entity, not preview or remote cells",()=>{
 const w=world(),before=w.snapshot(),a=interactObject(w,"actor",[0,0,0],movement,p,"plant");
 assert.equal(a.ok,true);assert.deepEqual(a.events[0].signals.map(s=>s.signal),["object.use"]);
 assert.equal(interactObject(w,"actor",[0,0,0],movement,p).events[0].signals[0].signal,"environment.use");
 assert.equal(interactObject(w,"actor",[2,0,0],movement,p).ok,false);assert.deepEqual(w.snapshot(),before);
});
test("tags persist with validated records, old saves still work",()=>{
 const w=world();w.setEntityTags("plant",["flexible","usable","usable"]);assert.deepEqual(w.getEntity("plant").interaction_tags,["flexible","usable"]);
 assert.deepEqual(World.restore(w.snapshot()).snapshot(),w.snapshot());assert.throws(()=>w.setEntityTags("plant",["bad tag"]));assert.throws(()=>interactionTags("bad"));assert.throws(()=>validateInteractions({...p,rules:[{...p.rules[0],bend:{radius_ft:0,vertical_ft:1,strength:1}}]}));
});
test("visual bending anchors roots, ignores other floors and returns neutral outside contact",()=>{
 const w=world(),root=[0,0,5],quad=billboard(root,0,1,2),response=contactResponse(p,cellTarget([0,0,0],w.get(0,0,0)));
 assert.ok(response);const next=bendBillboard(quad,root,2,[{id:"actor",point:[-1,0,5]}],response);assert.ok(next[0][0]>quad[0][0]);assert.deepEqual(next.slice(2),quad.slice(2));
 assert.equal(bendBillboard(quad,root,2,[{id:"actor",point:[-1,0,10]}],response),quad);
 assert.equal(bendBillboard(quad,root,2,[{id:"actor",point:[-1,0,5]}],response,"actor"),quad);
 const c=w.get(0,0,0);c.components.surface.snow=1;assert.equal(contactResponse(p,cellTarget([0,0,0],c)),null);
});
test("invalid interaction profile fails before movement commit",()=>{const w=world(),before=w.snapshot();assert.throws(()=>moveObject(w,"actor",[0,0,0],movement,{interactions:{schema:"bad"}}));assert.deepEqual(w.snapshot(),before);});
