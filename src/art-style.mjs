// Presentation profile: binds existing Atlas IDs to Hex World visual roles.
import {openAtlasPack} from "./assets.mjs";
import {stableUnit} from "./materials.mjs";
const assert=(ok,msg)=>{if(!ok)throw Error(msg);};
const positive=n=>Number.isFinite(n)&&n>0;
const id=s=>typeof s==="string"&&s.length>0;
export function validateStyle(s){
  assert(s?.schema==="smi-hex-style/1"&&id(s.id)&&id(s.manifest),"Invalid art style");
  const d=s.detail,l=s.lighting,v=s.vegetation;
  assert(d&&id(d.top)&&id(d.side)&&positive(d.repeat_ft)&&Number.isFinite(d.strength)&&d.strength>=0&&d.strength<=1,"Invalid detail binding");
  assert(l&&Number.isFinite(l.ambient)&&l.ambient>=0&&l.ambient<=1&&Array.isArray(l.direction)&&l.direction.length===3&&l.direction.every(Number.isFinite)&&Math.hypot(...l.direction)>0,"Invalid lighting");
  assert(v&&v.assets&&Object.values(v.assets).every(id)&&Number.isInteger(v.samples_per_triangle)&&v.samples_per_triangle>=1&&v.samples_per_triangle<=8&&positive(v.min_height_ft)&&positive(v.max_height_ft)&&v.max_height_ft>=v.min_height_ft&&positive(v.far_px_per_ft)&&v.near_px_per_ft>v.far_px_per_ft,"Invalid vegetation profile");
  return structuredClone(s);
}
export async function loadStyle(profile){
  const s=validateStyle(profile),pack=await openAtlasPack(s.manifest),rasters=new Map();
  async function load(asset){
    if(!rasters.has(asset))rasters.set(asset,(async()=>{const r=pack.createRaster({asset,regionOnly:true});await r.update(0);return r;})());
    return rasters.get(asset);
  }
  const [top,side,entries]=await Promise.all([load(s.detail.top),load(s.detail.side),Promise.all(Object.entries(s.vegetation.assets).map(async([key,asset])=>[key,await load(asset)]))]);
  return {profile:s,top,side,vegetation:new Map(entries)};
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
