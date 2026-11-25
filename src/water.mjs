// Derived horizontal free surfaces, clipped against the existing solid fan.
import {physicalPosition} from "./core.mjs";
import {vertices,hasVolume,EDGE_NEIGHBORS,oppositeEdge} from "./geometry.mjs";
const EPS=1e-8;
function clip(poly,depth,epsilon=EPS){
  const out=[];
  for(let i=0;i<poly.length;i++){
    const a=poly[i],b=poly[(i+1)%poly.length],da=depth(a)-epsilon,db=depth(b)-epsilon;
    if(da>=0)out.push(a);
    if((da>=0)!==(db>=0)){const t=da/(da-db);out.push(a.map((v,j)=>v+(b[j]-v)*t));}
  }
  return out;
}
export function waterFaces(world,address,grid=world.config.grid){
  const c=world.get(...address),w=c?.components?.water;
  if(!w||w.fill<=0)return [];
  const level=w.fill*grid.vertical_ft,o=physicalPosition(...address,grid),v=vertices(c.shape,grid),out=[];
  // Unknown is not air; suppress the top of a continued water column.
  const above=w.fill===1?world.get(address[0],address[1],address[2]+1):null;
  if(w.fill===1&&(!above||above.components?.water?.fill>0))return [];
  function emit(poly,depth){
    for(let i=1;i+1<poly.length;i++){
      const tri=[poly[0],poly[i],poly[i+1]],a=tri[0],b=tri[1],c=tri[2];
      if(Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))<=EPS)continue;
      out.push({kind:"water",address:[...address],points:tri.map(p=>[o.x+p[0],o.y+p[1],o.z+level]),depth:tri.map(p=>Math.max(0,depth(p))),flow:[...w.flow_ft_s]});
    }
  }
  for(let i=0;i<6;i++){
    const ids=[6,i,(i+1)%6],poly=ids.map(k=>[...v.upper[k].slice(0,2),v.lower[k][2],v.upper[k][2]]);
    if(above&&ids.every(k=>above.shape.lower[k]===0)&&ids.some(k=>above.shape.upper[k]>0))continue;
    if(ids.every(k=>c.shape.lower[k]===c.shape.upper[k])){emit(poly,()=>level);continue;}
    emit(clip(poly,p=>p[2]-level),()=>level);
    emit(clip(poly,p=>level-p[3]),p=>level-p[3]);
  }
  return out;
}
export function buildWaterSurfaces(world,addresses){
  const g=world.config.grid,out=[];
  for(const a of addresses)for(const f of waterFaces(world,a,g))out.push(f);
  return out;
}

// The first solver deliberately supports one floor-connected free surface.
// A solid with a lower void is not representable as a single connected pool.
export function waterBed(cell,grid){
  if(!cell)return null;
  if(!hasVolume(cell.shape))return Array(7).fill(0);
  if(cell.shape.lower.some(v=>v!==0))return null;
  return cell.shape.upper.map(v=>v/grid.geometry_subdivisions);
}
// Fraction of the whole hex-prism volume. Each fan triangle has equal area.
// Clip the affine bed against the fill plane and integrate linear depth exactly.
export function waterVolume(bed,fill){
  if(bed.every(v=>v===bed[0]))return Math.max(0,fill-bed[0]);
  let volume=0;
  for(let i=0;i<6;i++){
    const poly=clip([[0,0,bed[6]],[1,0,bed[i]],[0,1,bed[(i+1)%6]]],p=>fill-p[2],0);
    for(let j=1;j+1<poly.length;j++){
      const [a,b,c]=[poly[0],poly[j],poly[j+1]];
      const twiceArea=Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]));
      volume+=twiceArea*(3*fill-a[2]-b[2]-c[2])/18;
    }
  }
  return Math.max(0,volume);
}
export function fillForVolume(bed,amount){
  const capacity=waterVolume(bed,1);
  if(amount<=0)return 0;
  if(amount>=capacity)return 1;
  if(bed.every(v=>v===bed[0]))return bed[0]+amount;
  let lo=0,hi=1;
  for(let i=0;i<44;i++){const m=(lo+hi)/2;if(waterVolume(bed,m)<amount)lo=m;else hi=m;}
  return (lo+hi)/2;
}
// Lowest common opening along two aligned affine upper edges, including
// their intersection. A crest at fill 1 has no lateral opening.
export function sharedSill(a,b,edge){
  const j=(edge+1)%6,other=oppositeEdge(edge),k=(other+1)%6;
  const u=[a[edge],a[j]],v=[b[k],b[other]],d0=u[0]-v[0],d1=u[1]-v[1];
  let sill=Math.min(Math.max(u[0],v[0]),Math.max(u[1],v[1]));
  if(d0*d1<0){const t=d0/(d0-d1);sill=Math.min(sill,u[0]+t*(u[1]-u[0]));}
  return sill;
}
function verticalOpening(a,b){
  for(let i=0;i<6;i++){const ids=[6,i,(i+1)%6];if(ids.every(k=>a[k]===0)&&ids.some(k=>b[k]<1))return true;}
  return false;
}
const key=a=>a.join(",");
export const WATER_TICK_SECONDS=.5;
export const WATER_WET_LIMIT=2048;
const CELL_LIMIT=16000, VOLUME_EPS=1e-10;
// Snapshot, propose edge fluxes, constrain aggregate outgoing/incoming mass,
// then commit once. No camera-dependent domain, mutation during planning, or
// hidden stores. Unknown and unsupported solid geometry are closed boundaries.
export function planWaterStep(world){
  const g=world.config.grid,nodes=new Map(),wet=[],flux=[],seen=new Set(),beds=new Map();let unsupported=0;
  function get(address){
    if(!address.every(Number.isSafeInteger))return null;
    const k=key(address);if(nodes.has(k))return nodes.get(k);
    if(nodes.size>=CELL_LIMIT)throw Error("Water candidate budget exceeded");
    const cell=world.get(...address);if(!cell){nodes.set(k,null);return null;}
    const b=waterBed(cell,g);if(!b){nodes.set(k,null);return null;}
    const signature=b.join(","),bed=beds.get(signature)??b;beds.set(signature,bed);
    const fill=cell.components?.water?.fill??0,volume=waterVolume(bed,fill),capacity=waterVolume(bed,1);
    const node={address,cell,bed,fill,volume,capacity,out:0,in:0,delta:0};nodes.set(k,node);return node;
  }
  let count=0;
  for(const a of world.waterAddresses()){
    if(++count>WATER_WET_LIMIT)throw Error("Water wet-cell budget exceeded");
    const n=get(a);if(!n){unsupported++;continue;}if(n.volume>VOLUME_EPS)wet.push(n);
  }
  wet.sort((a,b)=>key(a.address)<key(b.address)?-1:key(a.address)>key(b.address)?1:0);
  function propose(a,b,amount){
    if(amount<=VOLUME_EPS)return;flux.push({a,b,amount});a.out+=amount;b.in+=amount;
  }
  for(const a of wet){
    const [q,r,z]=a.address;
    const below=get([q,r,z-1]);
    if(below&&below.capacity-below.volume>VOLUME_EPS&&verticalOpening(a.bed,below.bed))
      propose(a,below,.5*Math.min(a.volume,below.capacity-below.volume));
    for(let i=0;i<6;i++){
      const [dq,dr]=EDGE_NEIGHBORS[i],b=get([q+dq,r+dr,z]);if(!b||b.capacity<=VOLUME_EPS)continue;
      const ak=key(a.address),bk=key(b.address),pair=ak<bk?ak+"|"+bk:bk+"|"+ak;
      if(seen.has(pair))continue;seen.add(pair);
      const high=a.fill>=b.fill?a:b,low=high===a?b:a;
      if(high.volume<=VOLUME_EPS||low.capacity-low.volume<=VOLUME_EPS)continue;
      const sill=sharedSill(a.bed,b.bed,i);
      if(high.fill<=Math.max(low.volume>VOLUME_EPS?low.fill:0,sill)+1e-8)continue;
      // Solve the two-cell equal-head volume target, then stop at the sill.
      const total=high.volume+low.volume;let lo=0,hi=1;
      for(let j=0;j<40;j++){const m=(lo+hi)/2;if(waterVolume(high.bed,m)+waterVolume(low.bed,m)<total)lo=m;else hi=m;}
      const desired=waterVolume(low.bed,(lo+hi)/2)-low.volume;
      propose(high,low,.35*Math.min(desired,high.volume-waterVolume(high.bed,sill),low.capacity-low.volume));
    }
  }
  let moved=0;
  for(const {a,b,amount} of flux){
    const n=amount*Math.min(1,a.volume/a.out,(b.capacity-b.volume)/b.in);
    a.delta-=n;b.delta+=n;moved+=n;
  }
  const edits=[];let before=0,after=0;
  for(const n of nodes.values()){
    if(!n)continue;
    before+=n.volume;let volume=n.volume;
    if(Math.abs(n.delta)>0){
      volume=Math.max(0,Math.min(n.capacity,n.volume+n.delta));
      const {water,...components}=n.cell.components??{};
      const fill=fillForVolume(n.bed,volume);
      if(fill>0)components.water={fill,flow_ft_s:water?.flow_ft_s??[0,0]};
      edits.push({address:n.address,value:{...n.cell,components}});
      volume=waterVolume(n.bed,fill);
    }
    after+=volume;
  }
  // Reject an unstable numerical step rather than silently losing water.
  if(Math.abs(after-before)>Math.max(1e-8,before*1e-10))throw Error("Water mass conservation check failed");
  const unit=g.horizontal_ft*g.horizontal_ft*Math.sqrt(3)/2*g.vertical_ft;
  return {edits,moved_ft3:moved*unit,before_ft3:before*unit,after_ft3:after*unit,unsupported};
}
export function stepWater(world){
  const plan=planWaterStep(world);if(plan.edits.length)world.apply(plan.edits);return plan;
}
// Simulation-clock boundaries, not visual-frame count, determine tick count.
export function waterTicks(before,after){
  if(!Number.isFinite(before)||!Number.isFinite(after)||before<0||after<before)throw Error("Invalid water clock interval");
  const ticks=Math.floor(after/WATER_TICK_SECONDS)-Math.floor(before/WATER_TICK_SECONDS);
  if(!Number.isSafeInteger(ticks)||ticks>24)throw Error("Water simulation tick budget exceeded");
  return ticks;
}
