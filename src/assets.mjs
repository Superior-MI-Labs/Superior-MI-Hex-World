// Atlas owns visual semantics. This adapter passes a validated subset to
// the pinned canonical renderer, then exposes a raster for the GPU billboard.
import {AssetRegistry} from "./core.mjs";
const assert=(ok,msg)=>{if(!ok)throw Error(msg);};
const pair=a=>Array.isArray(a)&&a.length===2&&a.every(Number.isFinite);
const safePath=p=>typeof p==="string"&&/^[a-zA-Z0-9_./-]+$/.test(p)&&!p.startsWith("/")&&p.split("/").every(x=>x&&x!=="."&&x!=="..");
const id=s=>typeof s==="string"&&s.length>0&&s.length<=200;
export function validateSpritePack(pack,entry){
  assert(pack?.schema==="smi-visual-pack/1"&&id(pack.pack_id)&&id(pack.version)&&id(pack.license)&&pack.textures&&Array.isArray(pack.assets),"Invalid Atlas pack");
  assert(pack.assets.length<=10000,"Pack exceeds asset limit");
  const map=new Map();for(const a of pack.assets){assert(id(a?.id)&&!map.has(a.id),"Duplicate/invalid asset ID");map.set(a.id,a);}
  const visited=new Set(),active=new Set();
  function visit(key){
    assert(!active.has(key),"Cyclic asset reference");if(visited.has(key))return;
    const a=map.get(key);assert(a,"Missing asset "+key);active.add(key);
    if(a.pivot)assert(pair(a.pivot)&&a.pivot.every(v=>v>=0&&v<=1),"Invalid pivot");
    if(a.kind==="region"){
      assert(typeof a.texture==="string"&&Object.hasOwn(pack.textures,a.texture),"Missing texture");const t=pack.textures[a.texture],r=a.rect_px;
      assert(safePath(t.path)&&[t.width_px,t.height_px].every(v=>Number.isInteger(v)&&v>0&&v<=8192),"Invalid texture");
      assert(Array.isArray(r)&&r.length===4&&r.every(Number.isInteger)&&r[0]>=0&&r[1]>=0&&r[2]>0&&r[3]>0&&r[0]+r[2]<=t.width_px&&r[1]+r[3]<=t.height_px,"Invalid region bounds");
      if(a.logical_size_px)assert(pair(a.logical_size_px)&&a.logical_size_px.every(v=>v>0&&v<=4096),"Invalid logical size");
      if(a.trim_offset_px)assert(pair(a.trim_offset_px)&&pair(a.logical_size_px)&&a.trim_offset_px.every(v=>v>=0)&&a.trim_offset_px[0]+r[2]<=a.logical_size_px[0]&&a.trim_offset_px[1]+r[3]<=a.logical_size_px[1],"Invalid trim");
      assert(!a.nine_slice_px,"Nine-slice is not a world sprite");
    }else if(a.kind==="sequence"){
      assert(Array.isArray(a.frames)&&a.frames.length>0&&a.frames.length<=1024&&Number.isFinite(a.default_fps)&&a.default_fps>0&&["loop","once","pingpong"].includes(a.playback),"Invalid sequence");
      for(const f of a.frames){assert(f.duration_ms===undefined||Number.isFinite(f.duration_ms)&&f.duration_ms>0,"Invalid frame duration");if(f.offset_px)assert(pair(f.offset_px),"Invalid frame offset");visit(f.asset);}
    }else if(a.kind==="state_set"){
      assert(a.states&&Object.hasOwn(a.states,a.default_state),"Invalid state set");for(const key of Object.values(a.states))visit(key);
    }else throw Error("Unsupported world sprite kind: "+a.kind);
    active.delete(key);visited.add(key);
  }
  visit(entry);return map;
}
export function httpProvider(fetcher=fetch){
  return {async loadPack(reference){
    const url=new URL(reference,globalThis.location?.href);assert(["http:","https:"].includes(url.protocol)&&!url.username&&!url.password,"Unsupported pack URL");
    const r=await fetcher(url,{credentials:"omit",redirect:"error"});assert(r.ok,"Atlas manifest unavailable");
    const text=await r.text();assert(text.length<=5e6,"Manifest exceeds size limit");return JSON.parse(text);
  }};
}
export async function createAtlasRaster({manifest,asset,state=null,regionOnly=false},registry=new AssetRegistry()) {
  const url=new URL(manifest,location.href);
  // Default provider is only installed on this private registry.
  registry.register("http",httpProvider());
  const pack=await registry.load("http",url.href),map=validateSpritePack(pack,asset);
  if(regionOnly)assert(map.get(asset).kind==="region","Transition mask must reference a static Atlas region");
  const images=new Map();
  async function getImage(key){
    if(images.has(key))return images.get(key);
    const t=pack.textures[key],target=new URL(t.path,url);assert(target.origin===url.origin&&target.href.startsWith(new URL(".",url).href),"Texture escapes pack directory");
    const p=new Promise((resolve,reject)=>{const i=new Image();i.crossOrigin="anonymous";i.onload=()=>{try{assert(i.naturalWidth===t.width_px&&i.naturalHeight===t.height_px,"Texture dimensions mismatch");resolve(i);}catch(e){reject(e);}};i.onerror=()=>reject(Error("Texture unavailable: "+key));i.src=target.href;});images.set(key,p);return p;
  }
  const renderer=globalThis.VisualAtlasRenderer.create({getAsset:id=>map.get(id),getImage,slots:globalThis.VisualAtlasSlots,timeline:globalThis.VisualAtlasTimeline,visualCore:globalThis.VisualAtlasVisualCore});
  const [w,h]=renderer.sizeFor(asset),canvas=document.createElement("canvas"),back=document.createElement("canvas");canvas.width=back.width=w;canvas.height=back.height=h;const ctx=back.getContext("2d");
  let revision=0,busy=false,last=-Infinity,pivot=[.5,1];
  return {image:canvas,pixelWidth:w,pixelHeight:h,get pivot(){return pivot;},get revision(){return revision;},
    async update(time){
      if(busy||time-last<80)return false;busy=true;
      try{ctx.clearRect(0,0,w,h);await renderer.drawAsset(asset,ctx,0,0,w,h,time,{},state);pivot=renderer.pivotFor(asset,time,state)??[.5,1];const out=canvas.getContext("2d");out.clearRect(0,0,w,h);out.drawImage(back,0,0);revision++;last=time;return true;}finally{busy=false;}
    }};
}

export async function createAtlasSprite({height_ft=4,...binding},registry){
  if(!Number.isFinite(height_ft)||height_ft<=0)throw Error("Invalid sprite height");
  const raster=await createAtlasRaster(binding,registry);
  return Object.assign(raster,{width:height_ft*raster.pixelWidth/raster.pixelHeight,height:height_ft});
}
export async function createAtlasMask(binding){
  const raster=await createAtlasRaster({...binding,regionOnly:true});
  await raster.update(0);return raster.image;
}
