// A placed object is world data; rasters and animation frames are not.
import {hasVolume,sampleSurface} from "./geometry.mjs";
import {interactionTags} from "./interactions.mjs";
import {validateWindResponse} from "./environment.mjs";
const assert=(ok,msg)=>{if(!ok)throw Error(msg);};
const id=s=>typeof s==="string"&&s.length>0&&s.length<=200;
export const validAddress=a=>Array.isArray(a)&&a.length===3&&a.every(Number.isSafeInteger);
const own=(o,k)=>Object.hasOwn(o,k);
function selectionMap(value,valid,label){
  assert(value&&typeof value==="object"&&!Array.isArray(value)&&Object.keys(value).length<=64,"Invalid "+label);
  const pairs=Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0);
  for(const [k,v] of pairs)assert(id(k)&&!["__proto__","constructor","prototype"].includes(k)&&valid(v),"Invalid "+label+" entry");
  return Object.fromEntries(pairs);
}
export function visualSelection(s={}){
  assert(s&&typeof s==="object"&&!Array.isArray(s),"Invalid visual selection");
  const out={};
  if(s.preset!=null){assert(id(s.preset),"Invalid preset");out.preset=s.preset;}
  if(s.inputs!==undefined)out.inputs=selectionMap(s.inputs,v=>typeof v==="boolean"||typeof v==="number"&&Number.isFinite(v)||id(v),"visual inputs");
  if(s.slots!==undefined)out.slots=selectionMap(s.slots,id,"visual slots");
  return out;
}
export function spriteBinding(b){
  assert(b&&typeof b.manifest==="string"&&b.manifest.length<=2048&&id(b.asset),"Invalid sprite binding");
  const url=new URL(b.manifest,"https://local.invalid/");
  assert(["http:","https:"].includes(url.protocol)&&!url.username&&!url.password,"Invalid manifest URL");
  assert(b.state===null||b.state===undefined||id(b.state),"Invalid sprite state");
  const height_ft=b.height_ft??4;
  assert(Number.isFinite(height_ft)&&height_ft>0&&height_ft<=100,"Invalid sprite height");
  assert(b.walk_state===undefined||b.walk_state===null||id(b.walk_state),"Invalid walking state");
  assert(b.views===undefined||(Array.isArray(b.views)&&b.views.length===6&&b.views.every(id)),"Directional binding requires six Atlas asset IDs");
  assert(b.archive_sha256===undefined||typeof b.archive_sha256==="string"&&/^[a-f0-9]{64}$/.test(b.archive_sha256)&&url.pathname.toLowerCase().endsWith(".zip"),"Invalid archive digest");
  return {manifest:b.manifest,asset:b.asset,state:b.state??null,height_ft,...(b.archive_sha256?{archive_sha256:b.archive_sha256}:{}),...visualSelection(b),...(b.views!==undefined?{views:[...b.views]}:{}),...(b.walk_state?{walk_state:b.walk_state}:{}),...(b.wind!==undefined?{wind:validateWindResponse(b.wind)}:{})};
}
// Physical geometry belongs to the host, independent of sprite dimensions.
export function validateCollider(c){
  assert(c&&c.kind==="cylinder"&&Number.isFinite(c.radius_ft)&&c.radius_ft>=.05&&c.radius_ft<=20&&Number.isFinite(c.height_ft)&&c.height_ft>=.05&&c.height_ft<=100,"Invalid object collider");
  const out={kind:"cylinder",radius_ft:c.radius_ft,height_ft:c.height_ft};
  if(c.disabled_when!==undefined){
    const d=c.disabled_when;
    assert(d&&id(d.input)&&!["__proto__","constructor","prototype"].includes(d.input)&&(typeof d.equals==="boolean"||typeof d.equals==="number"&&Number.isFinite(d.equals)||id(d.equals)),"Invalid collider condition");
    out.disabled_when={input:d.input,equals:d.equals};
  }
  return out;
}
// A condition uses only an explicitly materialized canonical visual input.
export function colliderActive(e){
  if(!e.collider)return false;
  const d=e.collider.disabled_when;
  return !d||!own(e.visual.inputs??{},d.input)||e.visual.inputs[d.input]!==d.equals;
}
export function validateEntity(e){
  assert(e&&id(e.id)&&validAddress(e.address),"Invalid entity");
  assert(e.anchor==="surface"||e.anchor==="cell","Invalid anchor");
  const offset=e.offset_ft??[0,0,0];
  assert(Array.isArray(offset)&&offset.length===3&&offset.every(v=>Number.isFinite(v)&&Math.abs(v)<=100),"Invalid entity offset");
  assert(e.orientation_steps===undefined||(Number.isInteger(e.orientation_steps)&&e.orientation_steps>=0&&e.orientation_steps<6),"Invalid object orientation");
  const collider=e.collider===undefined?{}:{collider:validateCollider(e.collider)};
  const visual=spriteBinding(e.visual),d=collider.collider?.disabled_when;
  if(d)assert(own(visual.inputs??{},d.input)&&typeof visual.inputs[d.input]===typeof d.equals,"Conditional collider requires explicit matching-type visual input");
  return {...structuredClone(e),...collider,address:[...e.address],offset_ft:[...offset],...(e.orientation_steps!==undefined?{orientation_steps:e.orientation_steps}:{}),visual,...(e.interaction_tags!==undefined?{interaction_tags:interactionTags(e.interaction_tags)}:{})};
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

// Camera yaw 0 looks from world +Y. Positive steps advance the camera
// towards +X. View 0 is the front of an object facing its declared heading.
// Resolve only the visual binding; never mutate world orientation.
export function directionalBinding(visual,cameraYaw,orientation=0){
  assert(Number.isInteger(cameraYaw)&&Number.isInteger(orientation),"Invalid view orientation");
  const {views,...binding}=spriteBinding(visual);
  return views?{...binding,asset:views[((cameraYaw-orientation)%6+6)%6]}:binding;
}
