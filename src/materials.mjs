// Physical substrate and persistent surface state are independent of appearance.
// Catalog entries are data; no executable rules or Atlas image IDs are inferred.
const assert=(ok,msg)=>{if(!ok)throw Error(msg);};
const unit=v=>Number.isFinite(v)&&v>=0&&v<=1;
const rgb=v=>Array.isArray(v)&&v.length===3&&v.every(unit);
const mix=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);
export const TRANSITION_DEFAULT=Object.freeze({edge_strength:1,mask_scale:8,mask_softness:.13,cliff_bleed_ft:1.25,leaf_color:Object.freeze([.65,.34,.12]),snow_color:Object.freeze([.91,.94,.97]),scorch_color:Object.freeze([.15,.13,.11])});
export function transitionSettings(value={}){
  assert(value&&typeof value==="object"&&!Array.isArray(value),"Invalid transitions");
  const s={...TRANSITION_DEFAULT,...value};
  assert(unit(s.edge_strength)&&Number.isFinite(s.mask_scale)&&s.mask_scale>0&&s.mask_scale<=64&&unit(s.mask_softness)&&s.mask_softness<=.5&&Number.isFinite(s.cliff_bleed_ft)&&s.cliff_bleed_ft>=0&&s.cliff_bleed_ft<=20,"Invalid transition parameters");
  for(const k of ["leaf_color","snow_color","scorch_color"])assert(rgb(s[k]),"Invalid transition color");
  if(s.mask!==undefined)assert(s.mask&&typeof s.mask.manifest==="string"&&s.mask.manifest.length>0&&typeof s.mask.asset==="string"&&s.mask.asset.length>0,"Invalid mask binding");
  return structuredClone(s);
}
export const SURFACE_DEFAULT=Object.freeze({growth:0,health:1,moisture:0,leaves:0,snow:0,scorch:0,burn:0});
export function surface(value={}){
  assert(value&&typeof value==="object"&&!Array.isArray(value),"Invalid surface state");
  const out={...SURFACE_DEFAULT,...value};
  for(const k of ["growth","health","moisture","leaves","snow","scorch"])assert(unit(out[k]),"Invalid surface "+k);
  assert(Number.isFinite(out.burn)&&out.burn>=0,"Invalid remaining burn time");
  return out;
}
export function validateMaterials(m){
  assert(m?.schema==="smi-hex-materials/1"&&m.materials&&Object.keys(m.materials).length>0,"Invalid materials");
  for(const d of Object.values(m.materials))assert(rgb(d.top)&&rgb(d.side)&&typeof d.vegetation==="boolean","Invalid material definition");
  const v=m.vegetation;
  assert(v&&typeof v.family==="string"&&Array.isArray(v.variants)&&v.variants.length>0&&Number.isFinite(v.burn_seconds)&&v.burn_seconds>0,"Invalid vegetation family");
  const ids=new Set();
  for(const a of v.variants){assert(typeof a.id==="string"&&!ids.has(a.id)&&rgb(a.color)&&Number.isFinite(a.weight)&&a.weight>0,"Invalid variant");ids.add(a.id);}
  assert(Number.isFinite(v.variants.reduce((sum,a)=>sum+a.weight,0)),"Invalid total weight");
  return {...structuredClone(m),transitions:transitionSettings(m.transitions)};
}
export function stableUnit(seed,address,salt=""){
  let hash=2166136261;
  for(const c of JSON.stringify([seed,address,salt])){hash=Math.imul(hash^c.charCodeAt(0),16777619);}
  return (hash>>>0)/4294967296;
}
export function variantFor(catalog,seed,address){
  const list=catalog.vegetation.variants,total=list.reduce((sum,a)=>sum+a.weight,0);
  let n=stableUnit(seed,address,"grass")*total;
  for(const a of list){n-=a.weight;if(n<0)return a;}
  return list.at(-1);
}
export function appearance(catalog,seed,address,cell,kind){
  const d=Object.hasOwn(catalog.materials,cell.material)?catalog.materials[cell.material]:null;
  const fallback={top:[.6,.2,.6],side:[.4,.15,.4],vegetation:false},m=d??fallback,s=surface(cell.components?.surface);
  if(kind!=="top")return {color:m.side,cover:[0,0,0],vegetation:0};
  const grass=variantFor(catalog,seed,address);
  const plant=m.vegetation?s.growth:0,green=mix([.61,.48,.26],grass.color,s.health);
  const color=mix(mix(m.top,green,plant),(catalog.transitions??TRANSITION_DEFAULT).scorch_color,s.scorch*.85).map(v=>v*(1-.22*s.moisture));
  return {color,cover:[s.leaves,s.snow,s.scorch],vegetation:plant*(1-s.snow)*(1-s.scorch),variant:grass.id};
}
export function ignite(catalog,cell){
  const s=surface(cell.components?.surface);
  if(!Object.hasOwn(catalog.materials,cell.material)||!catalog.materials[cell.material].vegetation||s.growth+s.leaves<=0||s.moisture>=.9||s.snow>=.95)return s;
  return {...s,burn:catalog.vegetation.burn_seconds};
}
export function advanceSurface(s,seconds,burnSeconds){
  s=surface(s);assert(Number.isFinite(seconds)&&seconds>=0&&Number.isFinite(burnSeconds)&&burnSeconds>0,"Invalid simulation step");
  if(!s.burn||!seconds)return s;
  const dt=Math.min(s.burn,seconds),fraction=dt/burnSeconds;
  return {...s,burn:Math.max(0,s.burn-dt),growth:Math.max(0,s.growth-fraction),leaves:Math.max(0,s.leaves-fraction),health:Math.max(0,s.health-fraction),snow:Math.max(0,s.snow-fraction),scorch:Math.min(1,s.scorch+fraction)};
}
export function withSurface(cell,state){return {...cell,components:{...cell.components,surface:surface(state)}};}
