import test from "node:test";
import assert from "node:assert/strict";
import {World,Clock} from "../src/core.mjs";
import {CALM,validateEnvironment,windAt,climateAt,DEFAULT_CLIMATE,sampleWind,validateWindResponse,windState,windOffset,composeBend,precipitationPlan,precipitationParticle} from "../src/environment.mjs";
import {billboard} from "../src/camera.mjs";
import {bendBillboard} from "../src/interactions.mjs";
import {spriteBinding} from "../src/entities.mjs";
const cfg={schema:"smi-hex-world/1",id:"wind",grid:{horizontal_ft:5,vertical_ft:5,geometry_subdivisions:2,chunk_size:[16,16,16]},simulation:{mode:"frozen",rate:1}};
const windy={velocity_ft_s:[20,0],gust:.5},zone=(id,center,levels,wind,radius=1)=>({id,center,levels,wind,radius});
test("world wind defaults calm and saves ordered spatial overrides",()=>{const w=new World(cfg);assert.deepEqual(w.environment.wind,CALM);w.setEnvironment({wind:windy,zones:[zone("shelter",[-16,0],[0,0],CALM),zone("draft",[-16,0],[0,0],{velocity_ft_s:[0,10]},0)]});const e=w.environment;
assert.deepEqual(windAt(e,[-16,0,0]).velocity_ft_s,[0,10]);assert.deepEqual(windAt(e,[-17,0,0]),CALM);assert.deepEqual(windAt(e,[-17,0,1]),windy);assert.deepEqual(windAt(e,[-18,0,0]),windy);e.wind.velocity_ft_s[0]=99;assert.equal(w.environment.wind.velocity_ft_s[0],20);assert.deepEqual(World.restore(w.snapshot()).environment,w.environment);});
test("invalid environment update is atomic and backward-compatible",()=>{const w=new World(cfg),before=w.snapshot();assert.throws(()=>w.setEnvironment({wind:{velocity_ft_s:[Infinity,0]}}));assert.throws(()=>validateEnvironment({zones:[zone("a",[0,0],[1,0],CALM)]}));assert.deepEqual(w.snapshot(),before);assert.deepEqual(World.restore(before).environment.wind,CALM);});
test("gusts deterministic and visual time independent of simulation",()=>{const c=new Clock(),p=[-10,3,5],a=sampleWind(windy,p,0);c.animate(2);assert.equal(c.simulation,0);assert.notDeepEqual(sampleWind(windy,p,c.visual),a);assert.deepEqual(sampleWind(windy,p,0),a);assert.deepEqual(sampleWind(CALM,p,1),[0,0]);});
test("asset capability opt-in, threshold state, direction and root-preserving composition",()=>{const r=validateWindResponse({bend:.5,reference_speed_ft_s:20,states:[{min_speed_ft_s:8,state:"wind"}]});assert.equal(windState(r,CALM,"idle"),"idle");assert.equal(windState(r,windy,"idle"),"wind");assert.deepEqual(windOffset(null,[20,0],2),[0,0]);assert.deepEqual(windOffset(r,[20,0],2),[1,0]);const root=[0,0,5],q=billboard(root,0,1,2),contact=bendBillboard(q,root,2,[{id:"a",point:[-1,0,5]}],{radius_ft:3,vertical_ft:2,strength:.8});const bent=composeBend(q,contact,[1,0],2);assert.deepEqual(bent.slice(2),q.slice(2));assert.ok(bent[0][0]>contact[0][0]);assert.ok(bent[0][0]-q[0][0]<=2+1e-8);assert.equal(composeBend(q,q,[0,0],2),q);assert.throws(()=>validateWindResponse({states:[{min_speed_ft_s:10,state:"x"},{min_speed_ft_s:5,state:"y"}]}));assert.deepEqual(spriteBinding({manifest:"./p.json",asset:"a",wind:r}).wind,r);});

test("climate and wind override independently, survive saves and do not mutate surfaces",()=>{const w=new World(cfg),winter={season:"winter",temperature_c:-10,precipitation:"snow",intensity:.8};w.setEnvironment({wind:windy,zones:[{id:"winter",center:[-16,0],radius:1,levels:[0,0],climate:winter},zone("shelter",[-16,0],[0,0],CALM)]});const e=w.environment;assert.deepEqual(climateAt(e,[-16,0,0]),winter);assert.deepEqual(climateAt(e,[-16,0,1]),DEFAULT_CLIMATE);assert.deepEqual(windAt(e,[-16,0,0]),CALM);assert.deepEqual(World.restore(w.snapshot()).environment,e);assert.throws(()=>w.setEnvironment({climate:{...winter,intensity:2}}));assert.deepEqual(w.environment,e);});

test("weather presentation is deterministic, bounded, honors local climate and excludes lower surfaces",()=>{
 const make=(q,z,triangle=0)=>({kind:"top",address:[q,0,z],triangle,points:[[q*5,0,z*5+5],[q*5+1,0,z*5+5],[q*5,1,z*5+5]]});
 const lower=make(0,0),roof=make(0,1),outdoor=make(1,0),dry=make(2,0);
 const field=validateEnvironment({wind:windy,climate:{season:"summer",temperature_c:15,precipitation:"rain",intensity:1},zones:[
 {id:"snow",center:[0,0],radius:0,levels:[1,1],climate:{season:"winter",temperature_c:-4,precipitation:"snow",intensity:1}},
 {id:"dry",center:[2,0],radius:0,levels:[0,0],climate:DEFAULT_CLIMATE}]});
 const faces=[lower,roof,outdoor,dry],before=structuredClone(field),plan=precipitationPlan(faces,faces,field,"seed");
 assert.equal(plan.length,2);assert.equal(plan.find(p=>p.id[0]===0).kind,"snow");assert.ok(plan.every(p=>p.id[2]===1||p.id[0]===1));
 assert.deepEqual(precipitationPlan(faces,[...faces].reverse(),field,"seed"),plan);
 assert.deepEqual(precipitationPlan(faces,faces,field,"seed",{limit:1}),plan.slice(0,1));
 assert.deepEqual(precipitationPlan(faces,[lower],field,"seed"),[]);
 assert.deepEqual(precipitationPlan(faces,faces,validateEnvironment(),"seed"),[]);
 const sample=plan[0],p=precipitationParticle(sample,0);assert.deepEqual(precipitationParticle(sample,0),p);assert.notDeepEqual(precipitationParticle(sample,.1),p);
 assert.ok(p.point[2]>=sample.point[2]&&p.point[2]<=sample.point[2]+8);assert.deepEqual(field,before);
});
