// World residency is authoritative; viewport selection and generation are explicit host operations.
import {chunkOf,addressKey} from "./core.mjs";
import {uniformShape} from "./geometry.mjs";
import {withSurface} from "./materials.mjs";
import {unprojectPlane} from "./camera.mjs";
const assert=(ok,msg)=>{if(!ok)throw Error(msg);};
export const EXPLORATION_PROFILE="meadow-v1";
export const LEVELS=Object.freeze([-2,-1,0,1,2]);
export function explorationConfig(base){
  return {...structuredClone(base),id:base.id+"-exploration",generation:{profile:EXPLORATION_PROFILE,seed:base.id}};
}
function validateGeneration(world){
  const config=world.config,g=config.generation;
  assert(g?.profile===EXPLORATION_PROFILE&&typeof g.seed==="string"&&g.seed.length>0,"Unsupported generation profile");return config;
}
// Integer lattice coordinates identify the same corner in all three cells.
// Heights are global half-cell units; adjacent prisms evaluate the same field.
const offsets=[[1,1],[0,2],[-1,1],[-1,-1],[0,-2],[1,-1],[0,0]];
function height(q,r,i,phase){
  const [dx,dy]=offsets[i],x=2*q+r+dx,y=3*r+dy;
  if(Math.hypot(x,y/Math.sqrt(3))<=8)return 2;
  return Math.max(0,Math.min(4,Math.round(2+1.25*Math.sin(x*.13+phase)+.75*Math.cos(y*.11-phase))));
}
function phaseFor(seed){let h=0;for(const c of seed)h=(Math.imul(h,31)+c.charCodeAt(0))|0;return (h>>>0)/4294967296*Math.PI*2;}
export function generatedCell(config,q,r,z){
  const n=config.grid.geometry_subdivisions;
  assert(n===2,"Meadow generation requires two subdivisions");
  const upper=z===-1?Array(7).fill(n):z>=0&&z<=1?offsets.map((_,i)=>Math.max(0,Math.min(n,height(q,r,i,phaseFor(config.generation.seed))-z*n))):Array(7).fill(0);
  if(!upper.some(Boolean))return {material:"air",shape:uniformShape(0)};
  const value={material:"soil",shape:{lower:Array(7).fill(0),upper}};
  return z>=0?withSurface(value,{growth:.65}):value;
}
export function ensureChunk(world,address){
  const config=validateGeneration(world),size=config.grid.chunk_size,origin=address.map((x,i)=>x*size[i]);
  addressKey(...origin);assert(origin.every((v,i)=>Number.isSafeInteger(v+size[i]-1)),"Chunk exceeds safe coordinates");
  if(world.geometryRevisionAt(...origin)!==null)return false;
  world.defineChunk(...address);
  const edits=[];
  for(let q=origin[0];q<origin[0]+size[0];q++)for(let r=origin[1];r<origin[1]+size[1];r++)for(let z=Math.max(-1,origin[2]);z<=Math.min(1,origin[2]+size[2]-1);z++){
    const value=generatedCell(config,q,r,z);if(value.material!=="air")edits.push({address:[q,r,z],value});
  }
  world.apply(edits);return true;
}
export function hexRing(q,r,radius){
  assert(Number.isSafeInteger(q)&&Number.isSafeInteger(r)&&Number.isSafeInteger(radius)&&radius>=0&&radius<=128,"Invalid ring");
  const cells=[];for(let dq=-radius;dq<=radius;dq++)for(let dr=Math.max(-radius,-dq-radius);dr<=Math.min(radius,-dq+radius);dr++)if(Math.max(Math.abs(dq),Math.abs(dr),Math.abs(dq+dr))===radius)cells.push([q+dq,r+dr]);
  return cells;
}
export function viewportBounds(camera,grid,levels=LEVELS,padding=48){
  const points=[];
  for(const z of [Math.min(...levels)*grid.vertical_ft,(Math.max(...levels)+1)*grid.vertical_ft])
    for(const x of [-padding,camera.width+padding])for(const y of [-padding,camera.height+padding]){
      const [px,py]=unprojectPlane(x,y,z,camera),r=2*py/(Math.sqrt(3)*grid.horizontal_ft),q=px/grid.horizontal_ft-r/2;points.push([q,r]);
    }
  // One-cell halo covers hex corners, independent of yaw.
  const range=i=>[Math.floor(Math.min(...points.map(p=>p[i])))-1,Math.ceil(Math.max(...points.map(p=>p[i])))+1];
  return {q:range(0),r:range(1),z:[Math.min(...levels),Math.max(...levels)]};
}
export function addressesIn(bounds){
  const size=(bounds.q[1]-bounds.q[0]+1)*(bounds.r[1]-bounds.r[0]+1)*(bounds.z[1]-bounds.z[0]+1);
  assert(Number.isSafeInteger(size)&&size>=0&&size<=30000,"Viewport exceeds detailed cell budget; zoom in");
  const out=[];for(let q=bounds.q[0];q<=bounds.q[1];q++)for(let r=bounds.r[0];r<=bounds.r[1];r++)for(let z=bounds.z[0];z<=bounds.z[1];z++)out.push([q,r,z]);return out;
}
export function requiredChunks(bounds,grid,halo=1){
  const lo=chunkOf(bounds.q[0]-halo,bounds.r[0]-halo,bounds.z[0]-halo,grid.chunk_size).chunk;
  const hi=chunkOf(bounds.q[1]+halo,bounds.r[1]+halo,bounds.z[1]+halo,grid.chunk_size).chunk;
  const out=[];for(let q=lo[0];q<=hi[0];q++)for(let r=lo[1];r<=hi[1];r++)for(let z=lo[2];z<=hi[2];z++)out.push([q,r,z]);return out;
}
export function loadViewport(world,bounds){
  const addresses=addressesIn(bounds),chunks=requiredChunks(bounds,world.config.grid);let loaded=0;
  for(const a of chunks)if(ensureChunk(world,a))loaded++;
  return {addresses,chunks,loaded};
}
