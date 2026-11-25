// Object-space queries; visual pixels and camera orientation are irrelevant.
import {physicalPosition} from "./core.mjs";
import {anchorHeight} from "./entities.mjs";
const EPS=1e-8;
export function objectVolumes(world,{exclude=[]}={}){
  const skip=new Set(exclude),g=world.config.grid,out=[];
  for(const e of world.entities()){
    if(!e.collider||skip.has(e.id))continue;
    const h=anchorHeight(e,world.get(...e.address),g);if(h===undefined)continue;
    const o=physicalPosition(...e.address,g),[x,y]=e.offset_ft;
    out.push({id:e.id,address:e.address,center:[o.x+x,o.y+y],bottom:o.z+h,top:o.z+h+e.collider.height_ft,radius:e.collider.radius_ft});
    if(out.length>4096)throw Error("Object collision query budget exceeded");
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
export function firstObjectBlock(volumes,from,to,profile){
  for(const v of volumes)if(sweptCylinder(from,to,profile.height_ft,profile.radius_ft??0,v))return v.id;
  return null;
}
