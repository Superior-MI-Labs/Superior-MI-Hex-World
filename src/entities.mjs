// A placed object is world data; rasters and animation frames are not.
import {hasVolume,sampleSurface} from "./geometry.mjs";
const assert=(ok,msg)=>{if(!ok)throw Error(msg);};
const id=s=>typeof s==="string"&&s.length>0&&s.length<=200;
export const validAddress=a=>Array.isArray(a)&&a.length===3&&a.every(Number.isSafeInteger);
export function spriteBinding(b){
  assert(b&&typeof b.manifest==="string"&&b.manifest.length<=2048&&id(b.asset),"Invalid sprite binding");
  const url=new URL(b.manifest,"https://local.invalid/");
  assert(["http:","https:"].includes(url.protocol)&&!url.username&&!url.password,"Invalid manifest URL");
  assert(b.state===null||b.state===undefined||id(b.state),"Invalid sprite state");
  const height_ft=b.height_ft??4;
  assert(Number.isFinite(height_ft)&&height_ft>0&&height_ft<=100,"Invalid sprite height");
  return {manifest:b.manifest,asset:b.asset,state:b.state??null,height_ft};
}
export function validateEntity(e){
  assert(e&&id(e.id)&&validAddress(e.address),"Invalid entity");
  assert(e.anchor==="surface"||e.anchor==="cell","Invalid anchor");
  const offset=e.offset_ft??[0,0,0];
  assert(Array.isArray(offset)&&offset.length===3&&offset.every(v=>Number.isFinite(v)&&Math.abs(v)<=100),"Invalid entity offset");
  return {...structuredClone(e),address:[...e.address],offset_ft:[...offset],visual:spriteBinding(e.visual)};
}
// Surface anchored objects follow terrain edits; if their support is removed,
// they remain saved but unresolved. Gravity/collision belong to later systems.
export function anchorHeight(entity,cell,grid){
  if(!cell)return undefined;
  if(entity.anchor==="cell")return entity.offset_ft[2];
  if(!hasVolume(cell.shape))return undefined;
  const [x,y,z]=entity.offset_ft,top=sampleSurface(cell.shape,grid,x,y),bottom=sampleSurface(cell.shape,grid,x,y,"lower");
  return top!==undefined&&top>bottom?top+z:undefined;
}
export function placeObject(world,entity){
  const e=validateEntity(entity),c=world.get(...e.address);
  assert(anchorHeight(e,c,world.config.grid)!==undefined,"Object needs a known supporting surface");
  world.putEntity(e);return e;
}
export const visualKey=b=>JSON.stringify(spriteBinding(b));
