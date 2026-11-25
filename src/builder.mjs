// All procedural tools produce ordinary reviewed edit plans.
import {makeEditPlan,hexStroke,cellShape,cellMaterial,cellWater} from "./editor.mjs";
import {uniformShape,hasVolume} from "./geometry.mjs";
import {validAddress,validateEntity,anchorHeight,spriteBinding} from "./entities.mjs";
import {stableUnit,surface,withSurface} from "./materials.mjs";
const assert=(ok,msg)=>{if(!ok)throw Error(msg);},key=a=>a.join(",");
export function entityOccupancy(world){
  const map=new Map();for(const e of world.entities()){const k=key(e.address),list=map.get(k)??[];list.push(e);map.set(k,list);}return map;
}
function addressesOf(addresses){
  assert(Array.isArray(addresses)&&addresses.length<=512&&addresses.every(validAddress),"Invalid building region");
  return [...new Map(addresses.map(a=>[key(a),a])).values()].sort((a,b)=>a[2]-b[2]||a[0]-b[0]||a[1]-b[1]);
}
export function planObjectPlacement(world,addresses,{bindings,seed="grove",density=1,occupancy=entityOccupancy(world),idFor=null,allowWet=false}={}){
  assert(Array.isArray(bindings)&&bindings.length>0&&bindings.length<=24,"Choose qualified assets");
  assert(typeof seed==="string"&&seed.length<=128&&Number.isFinite(density)&&density>=0&&density<=1,"Invalid placement settings");
  const assets=bindings.map(spriteBinding),g=world.config.grid,entities=[];let skipped=0;
  for(const address of addressesOf(addresses)){
    const c=world.get(...address);
    if(!c||occupancy.get(key(address))?.length||stableUnit(seed,address,"density")>=density){skipped++;continue;}
    const visual=assets[Math.floor(stableUnit(seed,address,"asset")*assets.length)],id=idFor?idFor(address):"plant:"+key(address)+":"+Math.floor(stableUnit(seed,address,"id")*4294967296).toString(16);
    const value=validateEntity({id,address,anchor:"surface",visual,orientation_steps:Math.floor(stableUnit(seed,address,"heading")*6)});
    const height=anchorHeight(value,c,g);
    if(height===undefined||(!allowWet&&(c.components?.water?.fill??0)*g.vertical_ft>height)||world.getEntity(id)){skipped++;continue;}
    entities.push({id,value});
  }
  return {entities,skipped};
}
export function planGrove(world,addresses,options){
  const {entities,skipped}=planObjectPlacement(world,addresses,options);
  return {plan:makeEditPlan(world,[],"Plant grove",entities),skipped};
}
// Ordered waypoints within a single layer. Radius expands the centerline.
export function pathFootprint(waypoints,radius=0){
  assert(Array.isArray(waypoints)&&waypoints.length>=2&&waypoints.length<=32&&waypoints.every(validAddress),"Choose 2–32 waypoints");
  assert(Number.isInteger(radius)&&radius>=0&&radius<=3,"Invalid path width");
  assert(waypoints.every(a=>a[2]===waypoints[0][2]),"Path must stay on one layer");
  const centers=[];
  for(let i=1;i<waypoints.length;i++)for(const a of hexStroke(waypoints[i-1],waypoints[i])){
    if(!centers.length||key(centers.at(-1))!==key(a))centers.push(a);
    assert(centers.length<=512,"Path exceeds center budget");
  }
  const cells=new Map();
  for(let i=0;i<centers.length;i++){
    const a=centers[i],b=centers[i+1]??a,prev=centers[i-1]??a;
    const dq=b[0]-prev[0],dr=b[1]-prev[1],dx=dq+dr/2,dy=dr*Math.sqrt(3)/2,len=Math.hypot(dx,dy),flow=len?[dx/len,dy/len]:[0,0];
    for(let q=-radius;q<=radius;q++)for(let r=Math.max(-radius,-q-radius);r<=Math.min(radius,-q+radius);r++){
      const address=[a[0]+q,a[1]+r,a[2]];assert(validAddress(address),"Path address overflow");
      const k=key(address);if(!cells.has(k))cells.set(k,{address,flow});
      assert(cells.size<=512,"Path exceeds 512 cells");
    }
  }
  return [...cells.values()];
}
function gradeCell(c,height,material,vegetation){
  assert(c,"Unknown terrain: load cells before grading");
  assert(!hasVolume(c.shape)||c.shape.lower.every(v=>v===0),"Grading raised solids is unsupported");
  return cellMaterial(cellShape(c,uniformShape(height),material),material,vegetation);
}
function settings(world,height,material){
  assert(Number.isInteger(height)&&height>=1&&height<=world.config.grid.geometry_subdivisions&&typeof material==="string"&&material!=="air"&&material.length>0,"Invalid grading settings");
}
export function planGrade(world,addresses,{height,material,vegetation=false}){
  settings(world,height,material);
  const occupied=entityOccupancy(world),edits=addressesOf(addresses).map(address=>{
    assert(!occupied.has(key(address)),"Grading blocked by placed object at "+key(address));
    return {address,value:gradeCell(world.get(...address),height,material,vegetation)};
  });
  return makeEditPlan(world,edits,"Grade terrain");
}
export function planPath(world,waypoints,{kind="road",radius=0,height=2,material="stone",vegetation=false,fill=1,speed=2}={}){
  settings(world,height,material);const n=world.config.grid.geometry_subdivisions;
  assert(["road","river"].includes(kind),"Invalid path kind");
  if(kind==="river")assert(Number.isFinite(speed)&&speed>=0&&speed<=30&&Number.isFinite(fill)&&fill<=1&&fill>height/n,"River fill must be above bed");
  const occupied=entityOccupancy(world),edits=pathFootprint(waypoints,radius).map(({address,flow})=>{
    assert(!occupied.has(key(address)),"Path blocked by placed object at "+key(address));
    let value=gradeCell(world.get(...address),height,material,vegetation);
    value=withSurface(value,{...surface(value.components?.surface),growth:0,burn:0,...(kind==="river"?{moisture:1}:{})});
    value=cellWater(value,kind==="river"?{fill,fixed:true,flow_ft_s:flow.map(v=>v*speed)}:null);
    return {address,value};
  });
  return makeEditPlan(world,edits,kind==="river"?"Build fixed river":"Build road");
}
