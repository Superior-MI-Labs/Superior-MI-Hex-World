import {physicalPosition,neighbors,addressKey} from "./core.mjs";
import {cornerRefs,EDGE_NEIGHBORS,oppositeEdge,edgeProfile,exposedEdge,mesh,vertices,hasVolume} from "./geometry.mjs";
const assert=(ok,msg)=>{if(!ok)throw Error(msg);};
// Connected editing is an explicit atomic operation, not permanent welding.
// It includes the other two solid cells at the same corner; known air is skipped.
function vertexEditPlan(world,address,index,layer,connected){
  const n=world.config.grid.geometry_subdivisions;
  assert(["upper","lower"].includes(layer),"Invalid vertex layer");
  const refs=cornerRefs(...address,index).slice(0,connected?3:1),targets=[];
  let min=0,max=n;
  for(const [i,ref] of refs.entries()){
    const value=world.get(...ref.address);assert(value,"Unknown neighbor: load before editing");
    if(i>0&&!hasVolume(value.shape))continue;
    const s=value.shape,k=ref.index;
    if(layer==="upper")min=Math.max(min,s.lower[k]);else max=Math.min(max,s.upper[k]);
    targets.push({ref,value});
  }
  return {targets,min,max};
}
export function vertexLimits(world,address,index,layer,{connected=false}={}){
  const {min,max}=vertexEditPlan(world,address,index,layer,connected);return {min,max};
}
export function editVertex(world,address,index,layer,height,{connected=false,material="soil"}={}){
  const n=world.config.grid.geometry_subdivisions;
  assert(Number.isInteger(height)&&height>=0&&height<=n,"Invalid edit height");
  const {targets,min,max}=vertexEditPlan(world,address,index,layer,connected);
  const h=Math.min(max,Math.max(min,height));
  const edits=targets.map(({ref,value})=>{
    value.shape[layer][ref.index]=h;
    if(value.material==="air"&&hasVolume(value.shape))value.material=material;
    if(!hasVolume(value.shape)){value.material="air";if(value.components)delete value.components.surface;}
    return {address:ref.address,value};
  });
  world.apply(edits);return {height:h,addresses:edits.map(e=>e.address)};
}
// Mesh is derived from world state; no duplicate terrain store.
export function cellFaces(world,address,grid=world.config.grid){
  const cell=world.get(...address);if(!cell||!hasVolume(cell.shape))return [];
  const [q,r,z]=address,n=grid.geometry_subdivisions,s=cell.shape,v=vertices(s,grid);
  const above=world.get(q,r,z+1),below=world.get(q,r,z-1);
  const capVisible=(f)=>{
    const neighbor=f.kind==="top"?above:below;
    const ownLayer=f.kind==="top"?s.upper:s.lower,boundary=f.kind==="top"?n:0;
    const triangle=f.triangle,ids=[6,triangle,(triangle+1)%6];
    if(!ids.every(i=>ownLayer[i]===boundary))return true;
    if(!neighbor)return false;
    const other=neighbor.shape,contact=f.kind==="top"?other.lower:other.upper;
    return !(ids.every(i=>contact[i]===(f.kind==="top"?0:n))&&ids.some(i=>other.upper[i]>other.lower[i]));
  };
  const result=mesh(s,grid).filter(f=>f.kind!=="side"&&capVisible(f));
  for(let e=0;e<6;e++){
    const [dq,dr]=EDGE_NEIGHBORS[e],other=world.get(q+dq,r+dr,z);
    const profile=other?edgeProfile(other.shape,n,oppositeEdge(e)):undefined;
    if(profile){profile.lower.reverse();profile.upper.reverse();}
    const a=v.lower[e],b=v.lower[(e+1)%6];
    const point=([t,h])=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,h*grid.vertical_ft/n];
    for(const quad of exposedEdge(edgeProfile(s,n,e),profile)){
      const p=quad.map(point);
      for(const [i,j,k] of [[0,1,2],[0,2,3]]){
        // A zero-width end of a wedge collapses exactly; omit that triangle.
        const u=p[j].map((x,l)=>x-p[i][l]),w=p[k].map((x,l)=>x-p[i][l]);
        if(Math.hypot(u[1]*w[2]-u[2]*w[1],u[2]*w[0]-u[0]*w[2],u[0]*w[1]-u[1]*w[0])>1e-10)result.push({kind:"side",edge:e,points:[p[i],p[j],p[k]]});
      }
    }
  }
  const origin=physicalPosition(q,r,z,grid);
  return result.map(f=>({...f,address:[...address],material:cell.material,points:f.points.map(([x,y,z])=>[x+origin.x,y+origin.y,z+origin.z])}));
}

// Derived mesh cache. Geometry/material edits invalidate touched chunks and
// their affected neighbors; surface-only changes never invalidate topology.
export class TerrainFaceCache{
  #world;#grid;#entries=new Map();
  constructor(world,{maxEntries=12000}={}){this.#world=world;this.#grid=world.config.grid;assert(Number.isInteger(maxEntries)&&maxEntries>0,"Invalid cache limit");this.maxEntries=maxEntries;}
  get size(){return this.#entries.size;}
  get(address){
    const key=addressKey(...address),signature=[address,...neighbors(...address)].map(a=>this.#world.geometryRevisionAt(...a)).join("|");
    const old=this.#entries.get(key);if(old?.signature===signature){this.#entries.delete(key);this.#entries.set(key,old);return old.faces;}
    const faces=cellFaces(this.#world,address,this.#grid);this.#entries.delete(key);this.#entries.set(key,{signature,faces});
    if(this.#entries.size>this.maxEntries)this.#entries.delete(this.#entries.keys().next().value);return faces;
  }
  clear(){this.#entries.clear();}
}
