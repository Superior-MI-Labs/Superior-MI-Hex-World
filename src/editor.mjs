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

// Selection brushes operate on known cells only, at one explicit layer.
export function selectionBrush(world,center,radius,displayed=()=>true){
  if(!Number.isInteger(radius)||radius<0||radius>8)throw Error("Invalid brush radius");
  const [q,r,z]=center,out=[];
  for(let x=-radius;x<=radius;x++)for(let y=Math.max(-radius,-x-radius);y<=Math.min(radius,-x+radius);y++){
    const a=[q+x,r+y,z];if(a.every(Number.isSafeInteger)&&world.get(...a)&&displayed(a))out.push(a);
  }
  return out;
}
export function mergeSelection(current,brush,extend){
  if(brush.length===1)return selectCell(current,brush[0],extend);
  const out=new Map((extend?current:[]).map(a=>[a.join(","),a]));
  for(const a of brush)out.set(a.join(","),a);
  if(out.size>MAX_SELECTION)throw Error("Selection limit reached");
  return [...out.values()];
}
// The editor owns transient command history; the World remains authoritative.
// Commands contain just validated cell changes, not whole-world copies.
export class CellEditHistory{
  #undo=[];#redo=[];#world;
  constructor(world){this.#world=world;}
  get canUndo(){return !!this.#undo.length;}
  get canRedo(){return !!this.#redo.length;}
  get counts(){return {undo:this.#undo.length,redo:this.#redo.length};}
  apply(edits,label="Cell edit"){
    if(!Array.isArray(edits)||edits.length>4096)throw Error("Editor command exceeds cell budget");
    const seen=new Set(),before=edits.map(({address})=>{
      const key=address.join(",");if(seen.has(key))throw Error("Duplicate command address");seen.add(key);
      const value=this.#world.get(...address);if(!value)throw Error("Unknown command cell");return {address:[...address],value};
    });
    this.#world.apply(edits);
    const after=before.map(({address})=>({address,value:this.#world.get(...address)}));
    const changed=before.map((v,i)=>JSON.stringify(v.value)!==JSON.stringify(after[i].value));
    if(!changed.some(Boolean))return false;
    this.#undo.push({label,before:before.filter((_,i)=>changed[i]),after:after.filter((_,i)=>changed[i])});
    if(this.#undo.length>40)this.#undo.shift();
    this.#redo=[];
    return true;
  }
  #replay(source,target,reverse){
    const command=source.at(-1);if(!command)return null;
    const expected=reverse?command.after:command.before,desired=reverse?command.before:command.after;
    // Simulation or another tool may have changed these cells since editing.
    // Refuse stale history rather than silently overwrite authoritative state.
    if(expected.some(e=>JSON.stringify(this.#world.get(...e.address))!==JSON.stringify(e.value)))throw Error("History conflict: cell changed since command");
    this.#world.apply(desired);source.pop();target.push(command);return command.label;
  }
  undo(){return this.#replay(this.#undo,this.#redo,true);}
  redo(){return this.#replay(this.#redo,this.#undo,false);}
}
