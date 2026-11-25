// Presentation profile: binds existing Atlas IDs to Hex World visual roles.
import {openAtlasPack} from "./assets.mjs";
import {stableUnit} from "./materials.mjs";
import {validateWindResponse,windState,SEASONS} from "./environment.mjs";
const assert=(ok,msg)=>{if(!ok)throw Error(msg);};
const positive=n=>Number.isFinite(n)&&n>0;
const id=s=>typeof s==="string"&&s.length>0&&s.length<=2048;
const own=(o,k)=>Object.hasOwn(o??{},k);
export function artBinding(value,defaultManifest){
  const b=typeof value==="string"?{asset:value,manifest:defaultManifest}:value&&{...value,manifest:value.manifest??defaultManifest};
  assert(b&&id(b.asset)&&id(b.manifest),"Invalid art binding");
  const url=new URL(b.manifest,"https://local.invalid/");assert(["http:","https:"].includes(url.protocol)&&!url.username&&!url.password,"Invalid art manifest URL");
  assert(b.state===undefined||b.state===null||id(b.state),"Invalid art state");
  return {asset:b.asset,manifest:b.manifest,...(b.state!=null?{state:b.state}:{})};
}
export function resolveStyleProfile(profile,baseURL){
  const s=validateStyle(profile),resolve=b=>{const x=artBinding(b,s.manifest);return {...x,manifest:new URL(x.manifest,baseURL).href};};
  s.detail.top=resolve(s.detail.top);s.detail.side=resolve(s.detail.side);
  for(const d of Object.values(s.detail.materials??{}))for(const role of ["top","side"])if(d[role]!==undefined)d[role]=resolve(d[role]);
  s.vegetation.assets=Object.fromEntries(Object.entries(s.vegetation.assets).map(([k,v])=>[k,resolve(v)]));
  for(const entries of Object.values(s.vegetation.seasonal??{}))for(const [k,v] of Object.entries(entries))entries[k]={...resolve(v),...(v.wind!==undefined?{wind:v.wind}:{})};
  return s;
}
export function validateStyle(s){
  assert(s?.schema==="smi-hex-style/1"&&id(s.id)&&(s.manifest===undefined||id(s.manifest)),"Invalid art style");
  const d=s.detail,l=s.lighting,v=s.vegetation;
  assert(d&&positive(d.repeat_ft)&&Number.isFinite(d.strength)&&d.strength>=0&&d.strength<=1,"Invalid detail binding");
  artBinding(d.top,s.manifest);artBinding(d.side,s.manifest);
  const mode=m=>m===undefined||["grayscale","rgb_detail","albedo"].includes(m);
  assert(mode(d.color_mode),"Invalid detail color mode");
  assert(d.materials===undefined||(d.materials&&typeof d.materials==="object"&&!Array.isArray(d.materials)&&Object.keys(d.materials).length<=64),"Invalid material textures");
  for(const [k,m] of Object.entries(d.materials??{})){
    assert(id(k)&&m&&typeof m==="object"&&!Array.isArray(m)&&mode(m.color_mode)&&(m.top!==undefined||m.side!==undefined),"Invalid material texture");
    for(const role of ["top","side"])if(m[role]!==undefined){const b=artBinding(m[role],s.manifest);assert(b.state===undefined,"Terrain textures must be static");}
  }
  assert(l&&Number.isFinite(l.ambient)&&l.ambient>=0&&l.ambient<=1&&Array.isArray(l.direction)&&l.direction.length===3&&l.direction.every(Number.isFinite)&&Math.hypot(...l.direction)>0,"Invalid lighting");
  assert(v&&v.assets&&typeof v.assets==="object"&&!Array.isArray(v.assets)&&Object.keys(v.assets).length>0&&Object.keys(v.assets).length<=512&&Number.isInteger(v.samples_per_triangle)&&v.samples_per_triangle>=1&&v.samples_per_triangle<=8&&positive(v.min_height_ft)&&positive(v.max_height_ft)&&v.max_height_ft>=v.min_height_ft&&positive(v.far_px_per_ft)&&v.near_px_per_ft>v.far_px_per_ft,"Invalid vegetation profile");
  for(const b of Object.values(v.assets))artBinding(b,s.manifest);
  assert(v.wind===undefined||(v.wind&&typeof v.wind==="object"&&!Array.isArray(v.wind)),"Invalid vegetation wind map");
  const out=structuredClone(s);
  if(v.wind!==undefined){for(const [k,w] of Object.entries(v.wind)){assert(own(v.assets,k),"Unknown wind variant: "+k);out.vegetation.wind[k]=validateWindResponse(w);}}
  assert(v.seasonal===undefined||(v.seasonal&&typeof v.seasonal==="object"&&!Array.isArray(v.seasonal)),"Invalid seasonal bindings");
  for(const [season,entries] of Object.entries(v.seasonal??{})){
    assert(SEASONS.includes(season)&&entries&&typeof entries==="object"&&!Array.isArray(entries),"Invalid season");
    for(const [k,b] of Object.entries(entries)){assert(own(v.assets,k),"Unknown seasonal variant");artBinding(b,s.manifest);if(b.wind!==undefined)out.vegetation.seasonal[season][k]={...b,wind:validateWindResponse(b.wind)};}
  }
  return out;
}
export async function loadStyle(profile,{baseURL=location.href,openPack=openAtlasPack}={}){
  const s=resolveStyleProfile(profile,baseURL),packs=new Map(),rasters=new Map();
  async function load(binding,regionOnly=false){
    const {manifest,asset,state=null}=binding,key=JSON.stringify([manifest,asset,state,regionOnly]);
    if(!packs.has(manifest))packs.set(manifest,Promise.resolve().then(()=>openPack(manifest)));
    if(!rasters.has(key))rasters.set(key,(async()=>{const pack=await packs.get(manifest),r=pack.createRaster({asset,state,regionOnly,requireState:state!==null&&!regionOnly});await r.update(0);return r;})());
    return rasters.get(key);
  }
  const [top,side,entries]=await Promise.all([load(s.detail.top,true),load(s.detail.side,true),Promise.all(Object.entries(s.vegetation.assets).map(async([key,asset])=>[key,await load(asset)]))]);
  const windRasters=new Map();
  await Promise.all(Object.entries(s.vegetation.wind??{}).map(async([key,w])=>{
    const entries=await Promise.all(w.states.map(async ({state})=>[state,await load({...s.vegetation.assets[key],state})]));
    windRasters.set(key,new Map(entries));
  }));
  const materialRasters=new Map(),seasonalRasters=new Map();
  await Promise.all(Object.entries(s.detail.materials??{}).map(async([material,d])=>{
    const rasters={};await Promise.all(["top","side"].filter(role=>d[role]!==undefined).map(async role=>{rasters[role]=await load(d[role],true);}));
    materialRasters.set(material,rasters);
  }));
  const seasonalWindRasters=new Map();
  await Promise.all(Object.entries(s.vegetation.seasonal??{}).map(async([season,bindings])=>{
    const winds=new Map();
    const items=await Promise.all(Object.entries(bindings).map(async([k,b])=>{
      if(b.wind?.states.length)winds.set(k,new Map(await Promise.all(b.wind.states.map(async({state})=>[state,await load({...b,state})]))));
      return [k,await load(b)];
    }));
    seasonalRasters.set(season,new Map(items));seasonalWindRasters.set(season,winds);
  }));
  return {profile:s,top,side,vegetation:new Map(entries),windRasters,materialRasters,seasonalRasters,seasonalWindRasters};
}
export function vegetationRaster(style,variant,wind,season="summer"){
  const seasonal=style.seasonalRasters?.get(season)?.get(variant);
  if(seasonal){const b=style.profile.vegetation.seasonal[season][variant],state=windState(b.wind,wind,b.state??null);return style.seasonalWindRasters?.get(season)?.get(variant)?.get(state)??seasonal;}
  const binding=style.profile.vegetation.assets[variant],response=style.profile.vegetation.wind?.[variant];
  const state=windState(response,wind,binding?.state??null);
  return style.windRasters.get(variant)?.get(state)??style.vegetation.get(variant);
}

export function vegetationWind(profile,variant,season="summer"){
  const b=profile.vegetation.seasonal?.[season]?.[variant];return b?.wind??profile.vegetation.wind?.[variant];
}
export function validateStyleVariants(profile,catalog){
  for(const v of catalog.vegetation.variants)assert(own(profile.vegetation.assets,v.id),"Missing vegetation binding: "+v.id);
  if(catalog.materials)for(const k of Object.keys(profile.detail.materials??{}))assert(own(catalog.materials,k),"Unknown material binding: "+k);
  return profile;
}
export async function fetchStyle(reference,catalog,{fetcher=fetch,baseURL=location.href,openPack=openAtlasPack}={}){
  const url=new URL(reference,baseURL);assert(["http:","https:"].includes(url.protocol)&&!url.username&&!url.password,"Invalid style URL");
  const response=await fetcher(url,{credentials:"omit",redirect:"error"});assert(response.ok,"Style unavailable");
  const raw=await response.text();assert(raw.length<=1e6,"Style exceeds size limit");
  const profile=validateStyleVariants(validateStyle(JSON.parse(raw)),catalog);
  return loadStyle(profile,{baseURL:url.href,openPack});
}

// Stable samples in the actual terrain triangle, not the cell's bounding box.
// Distance only prunes a stable subset; it never relocates surviving tufts.
export function vegetationSamples(face,seed,profile,scale){
  if(face.kind!=="top"||face.vegetation<=0)return [];
  const v=profile.vegetation,ratio=Math.max(0,Math.min(1,(scale-v.far_px_per_ft)/(v.near_px_per_ft-v.far_px_per_ft)));
  const out=[],count=Math.ceil(v.samples_per_triangle*ratio);
  for(let i=0;i<count;i++){
    const salt="tuft:"+face.triangle+":"+i,rand=k=>stableUnit(seed,face.address,salt+":"+k);
    if(rand("density")>face.vegetation)continue;
    const a=Math.sqrt(rand("a")),b=rand("b"),weights=[1-a,a*(1-b),a*b];
    const point=[0,1,2].map(j=>face.points.reduce((sum,p,k)=>sum+p[j]*weights[k],0));
    const height=v.min_height_ft+(v.max_height_ft-v.min_height_ft)*face.vegetation*(.55+.45*rand("height"));
    out.push({point,height,variant:face.variant});
  }
  return out;
}

// A top triangle has at most four source cells (center and two corner
// neighborhoods). Collapse unused material bindings into the default layer.
export function terrainTexturePlan(face,style){
  const role=face.kind==="top"?"top":"side",d=style?.detail;
  const bindingFor=material=>material!=null&&own(d?.materials,material)&&d.materials[material][role]!==undefined?material:null;
  const weights=Array.from({length:3},(_,i)=>{
    const source=face.attributes?.[i]?.materialWeights??[[face.material??null,1]],map=new Map();
    for(const [m,w] of source){const key=bindingFor(m);map.set(key,(map.get(key)??0)+w);}return map;
  });
  const keys=[...new Set(weights.flatMap(w=>[...w.keys()]))].sort((a,b)=>a===b?0:a===null?-1:b===null?1:a<b?-1:1);
  assert(keys.length<=4,"Terrain triangle exceeds four material layers");
  const modes=keys.map(k=>k===null?d?.color_mode??"grayscale":d.materials[k].color_mode??d.color_mode??"grayscale");
  return {role,keys,modes,weights:weights.map(w=>Array.from({length:4},(_,i)=>w.get(keys[i])??0))};
}
