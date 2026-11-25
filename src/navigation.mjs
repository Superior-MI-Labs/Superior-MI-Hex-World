// Game-neutral, bounded centerline walking on the existing solid-volume geometry.
import {physicalPosition} from "./core.mjs";
import {validAddress,anchorHeight} from "./entities.mjs";
import {EDGE_NEIGHBORS,oppositeEdge,vertices,sampleSurface} from "./geometry.mjs";
const assert=(ok,msg)=>{if(!ok)throw Error(msg);};
const EPS=1e-8;
export function validateMovement(p){
  assert(p?.schema==="smi-hex-movement/1","Invalid movement profile");
  assert(Number.isFinite(p.height_ft)&&p.height_ft>0&&p.height_ft<=30&&Number.isFinite(p.max_step_ft)&&p.max_step_ft>=0&&p.max_step_ft<=20&&Number.isFinite(p.max_grade)&&p.max_grade>=0&&p.max_grade<=4,"Invalid movement dimensions");
  assert(Number.isInteger(p.max_nodes)&&p.max_nodes>=1&&p.max_nodes<=4096,"Invalid search budget");
  return structuredClone(p);
}
const mix=(a,b,t)=>a+(b-a)*t;
const midpoint=(a,b)=>a.map((v,i)=>(v+b[i])/2);
const key=a=>a.join(",");
function interval(cell,grid,xy,z){
  if(!cell)return null;
  const lo=sampleSurface(cell.shape,grid,...xy,"lower"),hi=sampleSurface(cell.shape,grid,...xy);
  if(lo===undefined||hi===undefined)return null;
  return [z*grid.vertical_ft+lo,z*grid.vertical_ft+hi];
}
// An overlap exists when all three affine differences are positive at the
// same parameter: obstacle thickness, obstacle top above feet, head above bottom.
function overlaps(lo,hi,feet,head){
  const lines=[hi.map((v,i)=>v-lo[i]),hi.map((v,i)=>v-feet[i]),head.map((v,i)=>v-lo[i])];
  const cuts=[0,1];
  for(const [a,b] of lines){const t=a/(a-b);if(t>0&&t<1)cuts.push(t);}
  cuts.sort((a,b)=>a-b);
  const at=t=>lines.every(([a,b])=>mix(a,b,t)>EPS);
  return cuts.some(at)||cuts.slice(1).some((t,i)=>at((t+cuts[i])/2));
}
function headroom(world,grid,address,points,feet,head){
  const [q,r,z]=address;
  // The supporting solid ends at feet; only higher cells can obstruct.
  const last=Math.ceil((Math.max(...head)-EPS)/grid.vertical_ft)-1;
  for(let level=z+1;level<=last;level++){
    const c=world.get(q,r,level);if(!c)return "unknown clearance";
    const a=interval(c,grid,points[0],level),b=interval(c,grid,points[1],level);
    if(!a||!b)return "invalid clearance";
    if(overlaps([a[0],b[0]],[a[1],b[1]],feet,head))return "blocked clearance";
  }
  return null;
}
function support(world,grid,address,edge){
  const c=world.get(...address);if(!c)return null;
  const v=vertices(c.shape,grid),z=address[2]*grid.vertical_ft;
  const center=[0,0],boundary=edge===undefined?center:midpoint(v.upper[edge],v.upper[(edge+1)%6]).slice(0,2);
  const a=interval(c,grid,center,address[2]),b=interval(c,grid,boundary,address[2]);
  if(!a||!b||a[1]-a[0]<=EPS||b[1]-b[0]<=EPS)return null;
  return {points:[center,boundary],feet:[a[1],b[1]]};
}
export function standability(world,address,profile){
  const p=validateMovement(profile),g=world.config.grid;
  assert(validAddress(address),"Invalid standing address");
  const s=support(world,g,address);
  if(!s)return {ok:false,reason:"no known support"};
  const reason=headroom(world,g,address,s.points,s.feet,s.feet.map(v=>v+p.height_ft));
  return reason?{ok:false,reason}:{ok:true,height_ft:s.feet[0]};
}
function step(world,g,from,to,p){
  const e=EDGE_NEIGHBORS.findIndex(([q,r])=>from[0]+q===to[0]&&from[1]+r===to[1]);
  if(e<0)return {ok:false,reason:"not a horizontal neighbor"};
  const a=support(world,g,from,e),b=support(world,g,to,oppositeEdge(e));
  if(!a||!b)return {ok:false,reason:"no known support"};
  const edgeA=a.feet[1],edgeB=b.feet[1],rise=Math.abs(edgeA-edgeB);
  if(rise>p.max_step_ft+EPS)return {ok:false,reason:"step too high"};
  for(const s of [a,b])if(Math.abs(s.feet[1]-s.feet[0])>p.max_grade*g.horizontal_ft/2+EPS)return {ok:false,reason:"slope too steep"};
  for(const [address,s] of [[from,a],[to,b]]){
    let reason=headroom(world,g,address,s.points,s.feet,s.feet.map(v=>v+p.height_ft));
    if(!reason)reason=headroom(world,g,address,[s.points[1],s.points[1]],[s.feet[1],s.feet[1]],Array(2).fill(Math.max(edgeA,edgeB)+p.height_ft));
    if(reason)return {ok:false,reason};
  }
  return {ok:true,rise_ft:rise};
}
export function walkStep(world,from,to,profile){
  assert(validAddress(from)&&validAddress(to),"Invalid walking address");
  return step(world,world.config.grid,from,to,validateMovement(profile));
}
// Breadth-first search minimizes cell steps. Unknown regions are not traversable.
export function findRoute(world,from,to,profile){
  assert(validAddress(from)&&validAddress(to),"Invalid route address");
  const p=validateMovement(profile),g=world.config.grid;
  const start=standability(world,from,p),end=standability(world,to,p);
  if(!start.ok||!end.ok)return {ok:false,reason:!start.ok?"Start: "+start.reason:"Destination: "+end.reason,visited:0,path:[]};
  const queue=[from],previous=new Map([[key(from),null]]),target=key(to);
  const levels=Math.ceil(p.max_step_ft/g.vertical_ft)+1;
  for(let cursor=0;cursor<queue.length;cursor++){
    const a=queue[cursor],k=key(a);
    if(k===target){const path=[];for(let at=k;at!==null;at=previous.get(at))path.push(at.split(",").map(Number));return {ok:true,path:path.reverse(),visited:previous.size};}
    for(const [dq,dr] of EDGE_NEIGHBORS)for(let dz=-levels;dz<=levels;dz++){
      const b=[a[0]+dq,a[1]+dr,a[2]+dz],bk=key(b);
      if(!validAddress(b)||previous.has(bk)||!step(world,g,a,b,p).ok)continue;
      if(previous.size>=p.max_nodes)continue;
      previous.set(bk,k);queue.push(b);
    }
  }
  return {ok:false,reason:previous.size>=p.max_nodes?"Search budget reached":"No traversable route",visited:previous.size,path:[]};
}
export function planObjectMove(world,id,to,profile){
  const e=world.getEntity(id);assert(e,"Unknown object");
  assert(e.anchor==="surface"&&e.offset_ft.every(v=>v===0),"Walking requires a centered surface anchor");
  assert(anchorHeight(e,world.get(...e.address),world.config.grid)!==undefined,"Object has no support");
  return findRoute(world,e.address,to,profile);
}
export function moveObject(world,id,to,profile){
  const route=planObjectMove(world,id,to,profile);
  if(route.ok)world.relocateEntity(id,to);
  return route;
}
