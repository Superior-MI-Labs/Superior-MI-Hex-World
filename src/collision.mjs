// Object-space queries; visual pixels and camera orientation are irrelevant.
import {physicalPosition} from "./core.mjs";
import {anchorHeight,colliderActive} from "./entities.mjs";
const EPS=1e-8;
export function objectVolumes(world,{exclude=[]}={}){
  const skip=new Set(exclude),g=world.config.grid,out=[];
  for(const e of world.entities()){
    if(!colliderActive(e)||skip.has(e.id))continue;
    const h=anchorHeight(e,world.get(...e.address),g);if(h===undefined)continue;
    const o=physicalPosition(...e.address,g),[x,y]=e.offset_ft;
    out.push({id:e.id,address:e.address,center:[o.x+x,o.y+y],bottom:o.z+h,top:o.z+h+e.collider.height_ft,radius:e.collider.radius_ft});
    if(out.length>65536)throw Error("Object collision query budget exceeded");
  }
  return out;
}
// Intersect horizontal disk sweep and vertical overlap over the same parameter.
export function sweptCylinder(from,to,height,radius,volume){
  const x=from[0]-volume.center[0],y=from[1]-volume.center[1],dx=to[0]-from[0],dy=to[1]-from[1],dz=to[2]-from[2],r=radius+volume.radius;
  let lo=0,hi=1;
  const a=dx*dx+dy*dy,b=2*(x*dx+y*dy),c=x*x+y*y-r*r;
  if(a<=EPS*EPS){if(c>=-EPS)return false;}
  else{const d=b*b-4*a*c;if(d<=0)return false;const root=Math.sqrt(d);lo=Math.max(lo,(-b-root)/(2*a));hi=Math.min(hi,(-b+root)/(2*a));}
  function positive(v,slope){
    if(Math.abs(slope)<=EPS)return v>EPS;
    const cut=(EPS-v)/slope;if(slope>0)lo=Math.max(lo,cut);else hi=Math.min(hi,cut);return true;
  }
  if(!positive(from[2]+height-volume.bottom,dz)||!positive(volume.top-from[2],-dz))return false;
  return hi-lo>EPS;
}
// Per-query broad phase. Store each volume in every intersected XY bucket,
// not only its center. Z interval is filtered before the narrow phase.
const BUCKET=16;
export function createCollisionIndex(volumes){
  const bins=new Map(),key=(x,y)=>x+","+y;
  function bounds(x0,y0,x1,y1){return [x0,y0,x1,y1].map(x=>Math.floor(x/BUCKET));}
  function safe(b){return b.every(Number.isSafeInteger);}
  for(const v of volumes){
    const [x,y]=v.center,r=v.radius,b=bounds(x-r,y-r,x+r,y+r);
    if(!safe(b))throw Error("Collider coordinates exceed spatial index range");
    for(let i=b[0];i<=b[2];i++)for(let j=b[1];j<=b[3];j++){
      const k=key(i,j),list=bins.get(k)??[];list.push(v);bins.set(k,list);
    }
  }
  return {size:volumes.length,candidates(from,to,radius,height){
    const b=bounds(Math.min(from[0],to[0])-radius,Math.min(from[1],to[1])-radius,Math.max(from[0],to[0])+radius,Math.max(from[1],to[1])+radius);
    const low=Math.min(from[2],to[2]),high=Math.max(from[2],to[2])+height;
    const vertical=v=>v.top>low&&v.bottom<high;
    if(!safe(b)||(b[2]-b[0]+1)*(b[3]-b[1]+1)>256)return volumes.filter(vertical);
    const found=new Set();
    for(let i=b[0];i<=b[2];i++)for(let j=b[1];j<=b[3];j++)for(const v of bins.get(key(i,j))??[])if(vertical(v))found.add(v);
    return found;
  }};
}
export function collisionQuery(world,options){return createCollisionIndex(objectVolumes(world,options));}
export function firstObjectBlock(index,from,to,profile){
  for(const v of index.candidates(from,to,profile.radius_ft??0,profile.height_ft))if(sweptCylinder(from,to,profile.height_ft,profile.radius_ft??0,v))return v.id;
  return null;
}
