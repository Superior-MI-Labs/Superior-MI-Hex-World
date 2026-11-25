// Presentation profile: binds existing Atlas IDs to Hex World visual roles.
import {openAtlasPack} from "./assets.mjs";
import {stableUnit} from "./materials.mjs";
const assert=(ok,msg)=>{if(!ok)throw Error(msg);};
const positive=n=>Number.isFinite(n)&&n>0;
const id=s=>typeof s==="string"&&s.length>0&&s.length<=2048;
const own=(o,k)=>Object.hasOwn(o??{},k);
export function artBinding(value,defaultManifest){
  const b=typeof value==="string"?{asset:value,manifest:defaultManifest}:value;
  assert(b&&id(b.asset)&&id(b.manifest),"Invalid art binding");
  const url=new URL(b.manifest,"https://local.invalid/");assert(["http:","https:"].includes(url.protocol)&&!url.username&&!url.password,"Invalid art manifest URL");
  return {asset:b.asset,manifest:b.manifest};
}
export function resolveStyleProfile(profile,baseURL){
  const s=validateStyle(profile),resolve=b=>{const x=artBinding(b,s.manifest);return {...x,manifest:new URL(x.manifest,baseURL).href};};
  s.detail.top=resolve(s.detail.top);s.detail.side=resolve(s.detail.side);
  s.vegetation.assets=Object.fromEntries(Object.entries(s.vegetation.assets).map(([k,v])=>[k,resolve(v)]));
  return s;
}
export function validateStyle(s){
  assert(s?.schema==="smi-hex-style/1"&&id(s.id)&&(s.manifest===undefined||id(s.manifest)),"Invalid art style");
  const d=s.detail,l=s.lighting,v=s.vegetation;
  assert(d&&positive(d.repeat_ft)&&Number.isFinite(d.strength)&&d.strength>=0&&d.strength<=1,"Invalid detail binding");
  artBinding(d.top,s.manifest);artBinding(d.side,s.manifest);
  assert(d.color_mode===undefined||["grayscale","rgb_detail"].includes(d.color_mode),"Invalid detail color mode");
  assert(l&&Number.isFinite(l.ambient)&&l.ambient>=0&&l.ambient<=1&&Array.isArray(l.direction)&&l.direction.length===3&&l.direction.every(Number.isFinite)&&Math.hypot(...l.direction)>0,"Invalid lighting");
  assert(v&&v.assets&&typeof v.assets==="object"&&!Array.isArray(v.assets)&&Object.keys(v.assets).length>0&&Object.keys(v.assets).length<=512&&Number.isInteger(v.samples_per_triangle)&&v.samples_per_triangle>=1&&v.samples_per_triangle<=8&&positive(v.min_height_ft)&&positive(v.max_height_ft)&&v.max_height_ft>=v.min_height_ft&&positive(v.far_px_per_ft)&&v.near_px_per_ft>v.far_px_per_ft,"Invalid vegetation profile");
  for(const b of Object.values(v.assets))artBinding(b,s.manifest);
  return structuredClone(s);
}
export async function loadStyle(profile,{baseURL=location.href,openPack=openAtlasPack}={}){
  const s=resolveStyleProfile(profile,baseURL),packs=new Map(),rasters=new Map();
  async function load(binding){
    const {manifest,asset}=binding,key=JSON.stringify([manifest,asset]);
    if(!packs.has(manifest))packs.set(manifest,Promise.resolve().then(()=>openPack(manifest)));
    if(!rasters.has(key))rasters.set(key,(async()=>{const pack=await packs.get(manifest),r=pack.createRaster({asset,regionOnly:true});await r.update(0);return r;})());
    return rasters.get(key);
  }
  const [top,side,entries]=await Promise.all([load(s.detail.top),load(s.detail.side),Promise.all(Object.entries(s.vegetation.assets).map(async([key,asset])=>[key,await load(asset)]))]);
  return {profile:s,top,side,vegetation:new Map(entries)};
}
export function validateStyleVariants(profile,catalog){
  for(const v of catalog.vegetation.variants)assert(own(profile.vegetation.assets,v.id),"Missing vegetation binding: "+v.id);
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
