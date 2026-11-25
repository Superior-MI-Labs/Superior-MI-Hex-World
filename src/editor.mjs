import {vertices,EDGE_NEIGHBORS,oppositeEdge} from "./geometry.mjs";
import {physicalPosition,validateCell} from "./core.mjs";
import {surface,withSurface} from "./materials.mjs";
import {validateWater} from "./environment.mjs";
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
  apply(edits,label="Cell edit",group=null){
    if(!Array.isArray(edits)||edits.length>4096)throw Error("Editor command exceeds cell budget");
    const seen=new Set(),before=edits.map(({address})=>{
      const key=address.join(",");if(seen.has(key))throw Error("Duplicate command address");seen.add(key);
      const value=this.#world.get(...address);if(!value)throw Error("Unknown command cell");return {address:[...address],value};
    });
    this.#world.apply(edits);
    const after=before.map(({address})=>({address,value:this.#world.get(...address)}));
    const changed=before.map((v,i)=>!sameCell(v.value,after[i].value));
    if(!changed.some(Boolean))return false;
    const entry={label,group,before:before.filter((_,i)=>changed[i]),after:after.filter((_,i)=>changed[i])},previous=this.#undo.at(-1);
    if(group&&previous?.group===group&&!this.#redo.length){
      const first=new Map(previous.before.map(v=>[v.address.join(","),v])),last=new Map(previous.after.map(v=>[v.address.join(","),v]));
      // Only merge contiguous edits; external changes break the gesture.
      if(entry.before.every(v=>!last.has(v.address.join(","))||sameCell(last.get(v.address.join(",")).value,v.value))&&new Set([...first.keys(),...entry.before.map(v=>v.address.join(","))]).size<=4096){
        for(const v of entry.before)if(!first.has(v.address.join(",")))first.set(v.address.join(","),v);
        for(const v of entry.after)last.set(v.address.join(","),v);
        const keys=[...first.keys()].filter(k=>!sameCell(first.get(k).value,last.get(k).value));
        if(keys.length){previous.before=keys.map(k=>first.get(k));previous.after=keys.map(k=>last.get(k));}else this.#undo.pop();
      }else this.#undo.push(entry);
    }else this.#undo.push(entry);
    if(this.#undo.length>40)this.#undo.shift();
    this.#redo=[];
    return true;
  }
  #replay(source,target,reverse){
    const command=source.at(-1);if(!command)return null;
    const expected=reverse?command.after:command.before,desired=reverse?command.before:command.after;
    // Simulation or another tool may have changed these cells since editing.
    // Refuse stale history rather than silently overwrite authoritative state.
    if(expected.some(e=>!sameCell(this.#world.get(...e.address),e.value)))throw Error("History conflict: cell changed since command");
    this.#world.apply(desired);source.pop();target.push(command);return command.label;
  }
  latestPlan(){const c=this.#undo.at(-1);return c?{schema:"smi-hex-edit-plan/1",world_id:this.#world.config.id,label:c.label,edits:c.before.map((v,i)=>({address:v.address,expected:v.value,value:c.after[i].value}))}:null;}
  undo(){return this.#replay(this.#undo,this.#redo,true);}
  redo(){return this.#replay(this.#redo,this.#undo,false);}
}

// Exact, portable JSON plans use optimistic expected values, not imperative code.
// Canonical structural equality avoids spurious conflicts due to key order.
function sameCell(a,b){
  if(a===b)return true;
  if(!a||!b||typeof a!=="object"||typeof b!=="object"||Array.isArray(a)!==Array.isArray(b))return false;
  const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(k=>Object.hasOwn(b,k)&&sameCell(a[k],b[k]));
}
export function makeEditPlan(world,edits,label="Cell edit"){
  return inspectEditPlan(world,{schema:"smi-hex-edit-plan/1",world_id:world.config.id,label,edits:edits.map(e=>({...e,expected:world.get(...e.address)}))}).plan;
}
export function inspectEditPlan(world,raw){
  if(raw?.schema!=="smi-hex-edit-plan/1"||raw.world_id!==world.config.id||typeof raw.label!=="string"||raw.label.length>128||!Array.isArray(raw.edits)||raw.edits.length>4096)throw Error("Invalid or incompatible edit plan");
  const seen=new Set(),conflicts=[],n=world.config.grid.geometry_subdivisions;
  const edits=raw.edits.map(e=>{
    if(!Array.isArray(e?.address)||e.address.length!==3||!e.address.every(Number.isSafeInteger))throw Error("Invalid plan address");
    const address=[...e.address],k=address.join(",");if(seen.has(k))throw Error("Duplicate plan address");seen.add(k);
    const expected=validateCell(e.expected,n),value=validateCell(e.value,n),actual=world.get(...address);
    if(!actual||!sameCell(actual,expected))conflicts.push({address,reason:actual?"changed":"unknown"});
    return {address,expected,value};
  });
  return {plan:{schema:raw.schema,world_id:raw.world_id,label:raw.label,edits},conflicts};
}
export function applyEditPlan(world,history,raw){
  const {plan,conflicts}=inspectEditPlan(world,raw);
  if(conflicts.length)throw Error("Edit plan blocked: "+conflicts[0].reason+" at "+conflicts[0].address.join(","));
  return history.apply(plan.edits,plan.label);
}
// These transforms are shared by the ordinary controls and brush planner.
export function cellShape(cell,shape,material){
  return shape.upper.some((h,i)=>h>shape.lower[i])?{...cell,material:cell.material==="air"?material:cell.material,shape}:{...cell,material:"air",shape,components:Object.fromEntries(Object.entries(cell.components??{}).filter(([k])=>k!=="surface"))};
}
export function cellMaterial(cell,material,vegetation){
  if(!cell.shape.upper.some((h,i)=>h>cell.shape.lower[i]))return cell;
  const s=surface(cell.components?.surface);return withSurface({...cell,material},vegetation?s:{...s,growth:0,burn:0});
}
export function cellWater(cell,water){
  const {water:old,...components}=cell.components??{};if(water?.fill)components.water=validateWater(water);return {...cell,components};
}
export function hexStroke(from,to){
  if(from[2]!==to[2])return [[...to]];
  const [dq,dr]=[to[0]-from[0],to[1]-from[1]],distance=Math.max(Math.abs(dq),Math.abs(dr),Math.abs(dq+dr));
  if(distance>128)throw Error("Brush stroke gap exceeds limit");
  return Array.from({length:distance+1},(_,i)=>{
    const t=distance?i/distance:0,q=from[0]+dq*t,r=from[1]+dr*t,s=-q-r;
    let a=Math.round(q),b=Math.round(r),c=Math.round(s);
    const da=Math.abs(a-q),db=Math.abs(b-r),dc=Math.abs(c-s);
    if(da>db&&da>dc)a=-b-c;else if(db>dc)b=-a-c;
    return [a,b,from[2]];
  });
}
