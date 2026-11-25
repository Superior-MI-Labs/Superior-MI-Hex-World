import {vertices,EDGE_NEIGHBORS,oppositeEdge} from "./geometry.mjs";
import {physicalPosition} from "./core.mjs";
// Logical editable faces are not render triangles. A clipped side still
// exposes its owning cell's four original control vertices.
export function faceKey(face){
  if(face?.kind==="top")return "upper";
  if(face?.kind==="bottom")return "lower";
  if(face?.kind==="side"&&Number.isInteger(face.edge)&&face.edge>=0&&face.edge<6)return "side:"+face.edge;
  throw Error("Invalid face");
}
export function faceHandles(key){
  if(key==="upper"||key==="lower")return Array.from({length:7},(_,index)=>({layer:key,index}));
  if(!/^side:[0-5]$/.test(key))throw Error("Invalid editable face");
  const i=Number(key.slice(5)),j=(i+1)%6;
  return [{layer:"upper",index:i},{layer:"upper",index:j},{layer:"lower",index:j},{layer:"lower",index:i}];
}
export const handleKey=({layer,index})=>layer+":"+index;
export function handleLabel({layer,index}){return (layer==="upper"?"Upper":"Lower")+" "+(index===6?"center":index+1);}
export function nearestHandle(handles,x,y,preferred,radius=15){
  let best=null,d=radius;
  for(const h of handles){
    const dist=Math.hypot(x-h.x,y-h.y);
    if(dist<d-1e-8||(best&&Math.abs(dist-d)<=1e-8&&handleKey(h)===preferred)){best=h;d=dist;}
  }
  return best;
}

export const MAX_SELECTION=512;
export function selectCell(current,address,extend=false){
  const k=address.join(","),next=extend?current.filter(a=>a.join(",")!==k):[];
  if(!extend||next.length===current.length){
    if(next.length>=MAX_SELECTION)throw Error("Selection limit reached");
    next.push([...address]);
  }
  return next.length?next:[[...address]];
}
export function selectionEdges(world,addresses,grid){
  const cells=new Map(),out=[];
  for(const a of addresses){const c=world.get(...a);if(c)cells.set(a.join(","),{address:a,v:vertices(c.shape,grid).upper});}
  for(const {address:a,v} of cells.values()){
    const o=physicalPosition(...a,grid);
    for(let i=0;i<6;i++){
      const j=(i+1)%6,[dq,dr]=EDGE_NEIGHBORS[i],other=cells.get([a[0]+dq,a[1]+dr,a[2]].join(",")),k=oppositeEdge(i);
      if(other&&v[i][2]===other.v[(k+1)%6][2]&&v[j][2]===other.v[k][2])continue;
      out.push([v[i],v[j]].map(([x,y,z])=>[o.x+x,o.y+y,o.z+z]));
    }
  }
  return out;
}
