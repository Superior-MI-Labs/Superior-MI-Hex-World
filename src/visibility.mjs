// View cutaways are read-only projections. Physics/visibility use the real world.
import {uniformShape,corners,vertices} from "./geometry.mjs";
import {physicalPosition} from "./core.mjs";
const EPS=1e-8;
const assert=(ok,msg)=>{if(!ok)throw Error(msg);};
export function cutawayMask(maxLevel,{center=null,radius=1}={}){
  assert(Number.isSafeInteger(maxLevel),"Invalid cutaway level");
  assert(center===null||(Array.isArray(center)&&center.length===2&&center.every(Number.isSafeInteger)&&Number.isSafeInteger(radius)&&radius>=0&&radius<=128),"Invalid cutaway footprint");
  return ([q,r,z])=>{
    if(z<=maxLevel)return false;
    if(center===null)return true;
    const dq=q-center[0],dr=r-center[1];return Math.max(Math.abs(dq),Math.abs(dr),Math.abs(dq+dr))<=radius;
  };
}
export function cutawayView(world,maxLevel,options){
  const hidden=cutawayMask(maxLevel,options),air={material:"air",shape:uniformShape(0)};
  return {get config(){return world.config;},get(q,r,z){const c=world.get(q,r,z);return c&&hidden([q,r,z])?structuredClone(air):c;},geometryRevisionAt(q,r,z){return world.geometryRevisionAt(q,r,z);}};
}
// Clip parameter interval to an affine inequality f(t)>=0.
function clip(range,a,b){
  if(a<0&&b<0)return null;
  if(a>=0&&b>=0)return range;
  const t=a/(a-b);
  const out=a<0?[Math.max(range[0],t),range[1]]:[range[0],Math.min(range[1],t)];
  return out[1]-out[0]>EPS?out:null;
}
const bary=(p,a,b)=>{const det=a[0]*b[1]-a[1]*b[0],u=(p[0]*b[1]-p[1]*b[0])/det,v=(a[0]*p[1]-a[1]*p[0])/det;return [1-u-v,u,v];};
// Intersect a segment with one convex triangular fan volume. The lower
// and upper planes are interpolated from the actual control vertices.
function intersect(p0,p1,xy,lo,hi){
  let range=[EPS,1-EPS];
  const a=bary(p0,xy[0],xy[1]),b=bary(p1,xy[0],xy[1]);
  for(let i=0;i<3&&range;i++)range=clip(range,a[i]+EPS,b[i]+EPS);
  if(!range)return null;
  const value=(weights,h)=>weights.reduce((s,w,i)=>s+w*h[i],0);
  range=clip(range,p0[2]-value(a,lo)-EPS,p1[2]-value(b,lo)-EPS);
  if(range)range=clip(range,value(a,hi)-p0[2]-EPS,value(b,hi)-p1[2]-EPS);
  if(range)range=clip(range,value(a,hi)-value(a,lo)-EPS,value(b,hi)-value(b,lo)-EPS);
  return range;
}
export function traceVisibility(world,from,to,{maxCells=4096}={}){
  assert([from,to].every(a=>Array.isArray(a)&&a.length===3&&a.every(Number.isFinite)),"Invalid visibility points");
  assert(Number.isInteger(maxCells)&&maxCells>0&&maxCells<=100000,"Invalid visibility budget");
  if(Math.hypot(...from.map((v,i)=>v-to[i]))<EPS)return {status:"clear"};
  const g=world.config.grid,axial=([x,y,z])=>{const r=2*y/(Math.sqrt(3)*g.horizontal_ft);return [x/g.horizontal_ft-r/2,r,z/g.vertical_ft];};
  const a=axial(from),b=axial(to),lo=a.map((v,i)=>Math.floor(Math.min(v,b[i]))-1),hi=a.map((v,i)=>Math.ceil(Math.max(v,b[i]))+1);
  const count=hi.reduce((s,v,i)=>s*(v-lo[i]+1),1);
  if(!Number.isSafeInteger(count)||count>maxCells||![...lo,...hi].every(Number.isSafeInteger))return {status:"budget"};
  const xy=corners(g.horizontal_ft/Math.sqrt(3));let best=null;
  for(let q=lo[0];q<=hi[0];q++)for(let r=lo[1];r<=hi[1];r++)for(let z=lo[2];z<=hi[2];z++){
    const origin=physicalPosition(q,r,z,g),local=p=>[p[0]-origin.x,p[1]-origin.y,p[2]-origin.z],p0=local(from),p1=local(to),c=world.get(q,r,z);
    const v=c?vertices(c.shape,g):null;
    for(let i=0;i<6;i++){
      const ids=[6,i,(i+1)%6],foot=[xy[i],xy[(i+1)%6]];
      const lower=v?ids.map(k=>v.lower[k][2]):[0,0,0],upper=v?ids.map(k=>v.upper[k][2]):Array(3).fill(g.vertical_ft);
      const hit=intersect(p0,p1,foot,lower,upper);
      if(hit&&(!best||hit[0]<best.t))best={status:c?"blocked":"unknown",address:[q,r,z],t:hit[0]};
    }
  }
  return best??{status:"clear"};
}
