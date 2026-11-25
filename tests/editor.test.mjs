import test from "node:test";
import assert from "node:assert/strict";
import {World,physicalPosition} from "../src/core.mjs";
import {uniformShape,cornerRefs,mesh} from "../src/geometry.mjs";
import {editVertex,vertexLimits,cellFaces} from "../src/terrain.mjs";
import {faceKey,faceHandles,handleKey,nearestHandle} from "../src/editor.mjs";
const config={schema:"smi-hex-world/1",id:"face-test",grid:{horizontal_ft:5,vertical_ft:5,geometry_subdivisions:2,chunk_size:[16,16,16]},simulation:{mode:"frozen",rate:1}};
function makeWorld(){const w=new World(config);for(let q=-1;q<=0;q++)for(let r=-1;r<=0;r++)for(let z=-1;z<=0;z++)w.defineChunk(q,r,z);return w;}
const soil=shape=>({material:"soil",shape});
test("logical face maps clipped triangles to original controls",()=>{
  assert.equal(faceKey({kind:"top",triangle:4}),"upper");
  assert.equal(faceKey({kind:"bottom",triangle:0}),"lower");
  assert.equal(faceHandles("upper").length,7);assert.equal(faceHandles("lower").length,7);
  for(let i=0;i<6;i++){const key=faceKey({kind:"side",edge:i});assert.deepEqual(faceHandles(key).map(handleKey),["upper:"+i,"upper:"+((i+1)%6),"lower:"+((i+1)%6),"lower:"+i]);}
  assert.throws(()=>faceHandles("side:6"));
});
test("coincident handles respect selected layer",()=>{
  const a={layer:"upper",index:0,x:10,y:10},b={layer:"lower",index:0,x:10,y:10};
  assert.equal(nearestHandle([a,b],10,10,"lower:0"),b);assert.equal(nearestHandle([a,b],10,10,"upper:0"),a);assert.equal(nearestHandle([a,b],100,100,"upper:0"),null);
});
test("upper/lower cannot cross at any of the seven vertices",()=>{
  for(let i=0;i<7;i++){const w=makeWorld(),a=[0,0,0],s=uniformShape(2);s.upper[i]=1;w.set(...a,soil(s));
    assert.deepEqual(vertexLimits(w,a,i,"lower"),{min:0,max:1});
    assert.equal(editVertex(w,a,i,"lower",2).height,1);
    assert.equal(editVertex(w,a,i,"upper",0).height,1);
    const next=w.get(...a).shape;assert.equal(next.lower[i],next.upper[i]);assert.ok(mesh(next,config.grid).every(f=>f.points.flat().every(Number.isFinite)));
    assert.equal(editVertex(w,a,i,"upper",2).height,2);assert.equal(editVertex(w,a,i,"lower",0).height,0);
  }
});
test("connected drag clamps to strictest neighboring opposing vertex across chunk",()=>{
  const w=makeWorld(),a=[0,0,0],refs=cornerRefs(...a,2);for(const [i,r] of refs.entries()){const s=uniformShape(2);s.upper[r.index]=i===1?1:2;w.set(...r.address,soil(s));}
  assert.deepEqual(vertexLimits(w,a,2,"lower",{connected:true}),{min:0,max:1});
  assert.equal(editVertex(w,a,2,"lower",2,{connected:true}).height,1);
  for(const r of refs)assert.equal(w.get(...r.address).shape.lower[r.index],1);
  assert.equal(editVertex(w,a,2,"upper",0,{connected:true}).height,1);
  for(const r of refs)assert.equal(w.get(...r.address).shape.upper[r.index],1);
});
test("fully collapsed volume disappears and can be raised again",()=>{
  const w=makeWorld(),a=[0,0,0];w.set(...a,soil(uniformShape(1)));
  for(let i=0;i<7;i++)editVertex(w,a,i,"lower",2);
  assert.equal(w.get(...a).material,"air");assert.deepEqual(cellFaces(w,a),[]);
  editVertex(w,a,6,"upper",2);assert.equal(w.get(...a).material,"soil");assert.ok(cellFaces(w,a).length>0);
});
