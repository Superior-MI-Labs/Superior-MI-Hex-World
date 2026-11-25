// Prefabs describe relative cell edits, not a second terrain representation.
import {shape,hasVolume} from "./geometry.mjs";
import {validAddress} from "./entities.mjs";
const assert=(ok,msg)=>{if(!ok)throw Error(msg);};
const id=s=>typeof s==="string"&&s.length>0&&s.length<=200;
export function validatePrefab(p){
  assert(p?.schema==="smi-hex-prefab/1"&&id(p.id)&&id(p.name)&&Array.isArray(p.cells)&&p.cells.length>0&&p.cells.length<=4096,"Invalid prefab");
  assert(p.grid?.geometry_subdivisions===2&&Number.isFinite(p.grid.horizontal_ft)&&p.grid.horizontal_ft>0&&Number.isFinite(p.grid.vertical_ft)&&p.grid.vertical_ft>0,"Invalid prefab grid");
  const seen=new Set();
  const cells=p.cells.map(c=>{
    assert(validAddress(c.offset)&&c.offset.every(v=>Math.abs(v)<=128),"Invalid prefab offset");
    const k=c.offset.join(",");assert(!seen.has(k),"Duplicate prefab cell");seen.add(k);
    assert(id(c.material)&&c.material!=="air","Invalid prefab material");
    const s=shape(c.shape,2);assert(hasVolume(s),"Prefab cell must contain volume");
    return {offset:[...c.offset],material:c.material,shape:s};
  });
  return {...structuredClone(p),cells};
}
export function rotateOffset([q,r,z],turns){
  assert(Number.isInteger(turns)&&turns>=0&&turns<6,"Invalid prefab rotation");
  for(let i=0;i<turns;i++)[q,r]=[-r,q+r];return [q,r,z];
}
export function rotateShape(s,turns){
  assert(Number.isInteger(turns)&&turns>=0&&turns<6,"Invalid prefab rotation");
  const rotate=v=>Array.from({length:7},(_,i)=>i===6?v[6]:v[(i-turns+6)%6]);
  return {lower:rotate(s.lower),upper:rotate(s.upper)};
}
// Preview and apply use the identical plan. Occupied cells are never silently overwritten.
export function planPrefab(world,prefab,anchor,turns=0){
  const p=validatePrefab(prefab),grid=world.config.grid;
  assert(validAddress(anchor),"Invalid anchor");
  assert(["horizontal_ft","vertical_ft","geometry_subdivisions"].every(k=>grid[k]===p.grid[k]),"Prefab grid mismatch");
  const edits=p.cells.map(c=>{
    const address=rotateOffset(c.offset,turns).map((v,i)=>v+anchor[i]);assert(validAddress(address),"Prefab address overflow");
    return {address,value:{material:c.material,shape:rotateShape(c.shape,turns)}};
  });
  const conflicts=[];
  for(const {address} of edits){
    const c=world.get(...address);
    if(!c)conflicts.push({address,reason:"unknown"});
    else if(hasVolume(c.shape))conflicts.push({address,reason:"occupied"});
  }
  return {edits,conflicts};
}
// Capture explicit cells, not a bounding box that accidentally includes terrain.
export function capturePrefab(world,addresses,anchor,{id,name}){
  assert(validAddress(anchor)&&Array.isArray(addresses)&&addresses.length>0&&addresses.length<=4096,"Invalid capture selection");
  const grid=world.config.grid,seen=new Set(),cells=[];
  for(const address of addresses){
    assert(validAddress(address),"Invalid capture address");
    const k=address.join(",");if(seen.has(k))continue;seen.add(k);
    const c=world.get(...address);assert(c,"Unknown capture cell");assert(hasVolume(c.shape),"Capture requires solid cells");
    cells.push({offset:address.map((v,i)=>v-anchor[i]),material:c.material,shape:c.shape});
  }
  return validatePrefab({schema:"smi-hex-prefab/1",id,name,grid:{horizontal_ft:grid.horizontal_ft,vertical_ft:grid.vertical_ft,geometry_subdivisions:grid.geometry_subdivisions},cells});
}
export function placePrefab(world,prefab,anchor,turns=0){
  const p=planPrefab(world,prefab,anchor,turns);
  assert(!p.conflicts.length,"Prefab blocked: "+p.conflicts[0]?.reason);
  world.apply(p.edits);return p.edits.map(e=>e.address);
}
