// Scenario assembly uses ordinary world cells and existing prefab placement.
import {World} from "./core.mjs";
import {uniformShape} from "./geometry.mjs";
import {withSurface} from "./materials.mjs";
import {placePrefab} from "./prefabs.mjs";
import {placeObject} from "./entities.mjs";
import {hexRing,LEVELS} from "./region.mjs";
export const SETTLEMENT="settlement-v1";
export const settlementGround=Array.from({length:4},(_,r)=>hexRing(0,0,r)).flat().map(([q,r])=>[q,r,0]);
export const settlementDomain=settlementGround.flatMap(([q,r])=>LEVELS.map(z=>[q,r,z]));
export const settlementStart=Object.freeze([-2,0,0]);
export function settlementConfig(base){return {...structuredClone(base),id:base.id+"-settlement",scene:SETTLEMENT};}
export function buildSettlement(base,prefabs,visual){
  const w=new World(settlementConfig(base));
  for(let q=-1;q<=0;q++)for(let r=-1;r<=0;r++)for(let z=-1;z<=0;z++)w.defineChunk(q,r,z);
  for(const [q,r] of settlementGround){
    w.set(q,r,-1,{material:"soil",shape:uniformShape(2)});
    w.set(q,r,0,withSurface({material:"soil",shape:uniformShape(2)},{growth:.75}));
  }
  // The doorway faces west; the seven-column cottage sits on the same
  // floor as the outdoor path. No interior map or teleport.
  for(const [q,r] of [[-3,0],[-2,0],[-1,0],[0,0],[0,1],[-1,1],[1,0],[1,-1],[0,-1]])
    w.set(q,r,0,{material:"stone",shape:uniformShape(2)});
  const cottage=prefabs.find(p=>p.id==="stone-cottage");
  if(!cottage)throw Error("Settlement requires stone cottage recipe");
  placePrefab(w,cottage,[0,0,1]);
  // A low, accessible step at the edge of the meadow.
  w.set(2,-1,0,{material:"stone",shape:uniformShape(1)});
  placeObject(w,{id:"demo-actor",address:[...settlementStart],anchor:"surface",visual});
  placeObject(w,{id:"resident",address:[0,0,0],anchor:"surface",visual});
  return w;
}
