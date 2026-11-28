import test from "node:test";import assert from "node:assert/strict";
import {project,unprojectPlane,billboard,pickFace,vertexDragDelta,VERTICAL_PROJECTION} from "../src/camera.mjs";
import {corners,vertices,uniformShape} from "../src/geometry.mjs";
import {viewportBounds} from "../src/region.mjs";
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
test("front/back camera points through opposite edge midpoints at every yaw",()=>{
 const hex=corners(1);
 for(let yaw=0;yaw<6;yaw++){
  const cam={yaw,alignment_deg:30},center=project([0,0,0],cam);
  const mids=hex.slice(0,6).map((p,i)=>{const q=hex[(i+1)%6];return project([(p[0]+q[0])/2,(p[1]+q[1])/2,0],cam);});
  assert.equal(mids.filter(p=>Math.abs(p.x-center.x)<1e-8).length,2);
  assert.equal(mids.filter(p=>Math.abs(p.y-center.y)<1e-8).length,0);
 }
});
test("both alignments share inverse projection, picking and billboard plane",()=>{
 for(const alignment_deg of [0,30])for(const yaw of [0,.25,1,5,5.75]){
  const cam={yaw,alignment_deg,scale:17,width:900,height:450,panX:32,panY:-12},p=[-13,8,2.5],s=project(p,cam);
  unprojectPlane(s.x,s.y,p[2],cam).forEach((v,i)=>near(v,p[i]));
  const quad=billboard(p,yaw,4,7,[.5,1],alignment_deg).map(v=>project(v,cam));
  near(quad[1].x-quad[0].x,68);near(quad[1].y,quad[0].y);near(quad[2].x,quad[1].x);
  const f={points:[p,[p[0]+2,p[1],p[2]],[p[0],p[1]+2,p[2]]]},center=project([p[0]+.5,p[1]+.5,p[2]],cam);
  assert.equal(pickFace([f],center.x,center.y,v=>project(v,cam)),f);
  const bounds=viewportBounds(cam,{horizontal_ft:5,vertical_ft:5});const r=2*p[1]/(Math.sqrt(3)*5),q=p[0]/5-r/2;
  assert.ok(bounds.q[0]<=q&&bounds.q[1]>=q&&bounds.r[0]<=r&&bounds.r[1]>=r);
 }
});

test("5 ft across flats equals the full vertical span; projected drag moves exactly two subdivisions",()=>{
 const grid={horizontal_ft:5,vertical_ft:5,geometry_subdivisions:2},v=vertices(uniformShape(2),grid),mid=i=>v.upper[i].map((x,k)=>(x+v.upper[(i+1)%6][k])/2);
 for(let i=0;i<3;i++){const a=mid(i),b=mid(i+3);near(Math.hypot(...a.map((x,k)=>x-b[k])),5);}
 for(let i=0;i<7;i++)near(v.upper[i][2]-v.lower[i][2],5);
 const half=vertices(uniformShape(1),grid);near(half.upper[6][2],2.5);
 for(const alignment_deg of [0,30])for(let yaw=0;yaw<6;yaw++)for(const scale of [12,24,48]){
  const cam={alignment_deg,yaw,scale},a=project(v.upper[6],cam),b=project(v.lower[6],cam),m=project(half.upper[6],cam);
  near(b.y-a.y,5*scale*VERTICAL_PROJECTION);near(vertexDragDelta(a.y-b.y,scale,grid),-2);near(vertexDragDelta(m.y-b.y,scale,grid),-1);
 }
});
