// Decoration is derived from real terrain, never from cutaway geometry or camera LOD.
import {scatterSamples} from "./art-style.mjs";
import {surface} from "./materials.mjs";
import {physicalPosition} from "./core.mjs";
import {TerrainFaceCache} from "./terrain.mjs";
const cellKey=a=>a.join(",");
const identity=s=>JSON.stringify([s.address,s.key]);
export function thinScatter(samples){
  let size=1;for(const s of samples)size=Math.max(size,s.spacing);const buckets=new Map();
  function bucket(s,dx=0,dy=0){return [Math.floor(s.point[0]/size)+dx,Math.floor(s.point[1]/size)+dy,s.address[2]].join(",");}
  for(const s of samples){if(!s.spacing)continue;const k=bucket(s),list=buckets.get(k)??[];list.push(s);buckets.set(k,list);}
  // Local priority minima, not a greedy traversal: adding a distant candidate
  // cannot cascade through an arbitrarily long chain. Hidden samples still reserve spacing.
  return samples.filter(s=>{
    if(!s.spacing)return true;
    const key=identity(s);
    for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(const other of buckets.get(bucket(s,x,y))??[]){
      if(other===s||other.rank>s.rank||other.rank===s.rank&&identity(other)>=key)continue;
      if(Math.hypot(other.point[0]-s.point[0],other.point[1]-s.point[1])<Math.max(s.spacing,other.spacing))return false;
    }
    return true;
  });
}
export function buildScatterPlan(world,addresses,profile,{cache=new TerrainFaceCache(world)}={}){
  const families=profile.vegetation.families??[];if(!families.length)return [];
  const active=new Set(addresses.map(cellKey)),grid=world.config.grid,seed=world.config.id;
  const spacing=Math.max(0,...families.map(f=>f.spacing_ft??0)),radius=spacing?Math.ceil(spacing/grid.horizontal_ft)+2:0;
  if(radius>8)throw Error("Scatter spacing exceeds supported grid neighborhood");
  const expanded=new Map(addresses.map(a=>[cellKey(a),a]));
  // Only boundary addresses need a halo; use actual known terrain and do not generate cells.
  if(radius)for(const [q,r,z] of addresses)for(let x=-radius;x<=radius;x++)for(let y=Math.max(-radius,-x-radius);y<=Math.min(radius,-x+radius);y++){
    const a=[q+x,r+y,z],k=cellKey(a);if(a.every(Number.isSafeInteger)&&!expanded.has(k))expanded.set(k,a);
  }
  const candidates=[];
  for(const address of expanded.values()){
    const c=world.get(...address);if(!c||c.material==="air"||!families.some(f=>f.materials.includes(c.material)))continue;
    const hidden=new Set(c.components?.scatter_hidden??[]),state=surface(c.components?.surface);
    for(const f of cache.get(address)){
      if(f.kind!=="top")continue;
      for(const s of scatterSamples({...f,surface:state},seed,profile,Infinity))candidates.push({...s,hidden:hidden.has(s.key)});
    }
  }
  return thinScatter(candidates).filter(s=>active.has(cellKey(s.address))&&!s.hidden);
}
export function promoteSample(world,style,sample,id){
  const entry=style.scatter.get(sample.family)?.get(sample.variant);
  if(!entry)throw Error("Scatter asset unavailable");
  const o=physicalPosition(...sample.address,world.config.grid);
  // Persist the current base binding; seasonal decoration is a host presentation rule.
  const visual={...entry.base.binding,height_ft:entry.base.binding.height_ft*sample.scale};
  world.promoteScatter(sample.key,{id,address:sample.address,anchor:"surface",offset_ft:[sample.point[0]-o.x,sample.point[1]-o.y,0],orientation_steps:sample.orientation,visual,interaction_tags:sample.contact?["flexible"]:[]});
}
