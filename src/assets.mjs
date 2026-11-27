// Atlas owns visual semantics. This adapter passes a bounded fixed-canvas subset to
// the pinned canonical renderer, then exposes a raster for the GPU billboard.
import {AssetRegistry} from "./core.mjs";
import {visualSelection} from "./entities.mjs";
import {adoptSpatialProfile} from "./spatial-assets.mjs";
const assert=(ok,msg)=>{if(!ok)throw Error(msg);};
const pair=a=>Array.isArray(a)&&a.length===2&&a.every(Number.isFinite);
const safePath=p=>typeof p==="string"&&/^[a-zA-Z0-9_./-]+$/.test(p)&&!p.startsWith("/")&&p.split("/").every(x=>x&&x!=="."&&x!=="..");
const id=s=>typeof s==="string"&&s.length>0&&s.length<=200;
export function validateSpritePack(pack,entry){
  assert(pack?.schema==="smi-visual-pack/1"&&id(pack.pack_id)&&id(pack.version)&&id(pack.license)&&pack.textures&&Array.isArray(pack.assets),"Invalid Atlas pack");
  assert(pack.assets.length<=10000,"Pack exceeds asset limit");
  const map=new Map();for(const a of pack.assets){assert(id(a?.id)&&!map.has(a.id),"Duplicate/invalid asset ID");map.set(a.id,a);}
  const visited=new Set(),active=new Set(),costs=new Map();
  let needsSlotValidation=false;
  const size=a=>pair(a)&&a.every(v=>Number.isInteger(v)&&v>0&&v<=4096);
  const bounded=n=>Number.isFinite(n)&&Math.abs(n)<=16384;
  function visit(key){
    assert(!active.has(key),"Cyclic asset reference");if(visited.has(key))return costs.get(key);
    assert(active.size<32,"Asset nesting exceeds world limit");let cost=1;
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
      for(const f of a.frames){assert(f.duration_ms===undefined||Number.isFinite(f.duration_ms)&&f.duration_ms>0,"Invalid frame duration");if(f.offset_px)assert(pair(f.offset_px),"Invalid frame offset");cost+=visit(f.asset);}
    }else if(a.kind==="state_set"){
      assert(a.states&&Object.hasOwn(a.states,a.default_state),"Invalid state set");for(const key of Object.values(a.states))cost+=visit(key);
    }else if(a.kind==="composition"){
      needsSlotValidation=true;
      assert(size(a.size_px)&&Array.isArray(a.layers)&&a.layers.length>0&&a.layers.length<=128,"Invalid fixed world composition");
      const slotCore=globalThis.VisualAtlasSlots;assert(slotCore,"Missing Atlas slot resolver");
      if(a.behavior!==undefined){const interaction=globalThis.VisualAtlasInteraction;assert(interaction,"Missing Atlas interaction resolver");const errors=interaction.check(a);assert(!errors.length,"Invalid Atlas behavior: "+errors[0]);}
      assert(a.inputs===undefined||a.inputs&&typeof a.inputs==="object"&&!Array.isArray(a.inputs)&&Object.keys(a.inputs).length<=64,"Invalid composition inputs");
      for(const def of Object.values(a.inputs??{}))assert(slotCore.accepts(def,def?.default),"Invalid composition input default");
      assert(a.duration_ms===undefined||Number.isInteger(a.duration_ms)&&a.duration_ms>0&&a.duration_ms<=600000,"Invalid composition duration");
      for(const l of a.layers){
        assert(l&&((typeof l.asset==="string")!==(typeof l.slot==="string"))&&!l.repeat,"World composition needs fixed non-repeated layers");
        assert(l.size_px===undefined||size(l.size_px),"Invalid layer size");
        for(const k of ["x","y","rotation_deg","scale_x","scale_y","opacity"])assert(l[k]===undefined||bounded(l[k]),"Invalid layer transform");
        assert(l.offset_px===undefined||pair(l.offset_px)&&l.offset_px.every(bounded),"Invalid layer offset");
        const choices=l.asset?[l.asset]:a.slots?.[l.slot]?.options;
        assert(Array.isArray(choices)&&choices.length>0&&choices.length<=128,"Invalid world slot");
        for(const ref of choices)cost+=visit(ref);
      }
    }else throw Error("Unsupported world sprite kind: "+a.kind);
    if(a.spatial!==undefined){
      needsSlotValidation=true;
      const slots=globalThis.VisualAtlasSlots;assert(slots?.spatialErrors,"Missing Atlas spatial validator");
      const errors=slots.spatialErrors(a,id=>map.get(id));assert(!errors.length,"Invalid Atlas spatial profile: "+errors[0]);
      for(const ref of slots.spatialRefs(a))cost+=visit(ref);
    }
    assert(cost<=4096,"World sprite dependency expansion exceeds limit");
    active.delete(key);visited.add(key);costs.set(key,cost);return cost;
  }
  visit(entry);
  if(needsSlotValidation){const errors=globalThis.VisualAtlasSlots.validate({...pack,assets:[...visited].map(id=>map.get(id))});assert(!errors.length,"Invalid Atlas composition: "+errors[0]);}
  return map;
}
export function httpProvider(fetcher=fetch){
  return {async loadPack(reference){
    const url=new URL(reference,globalThis.location?.href);assert(["http:","https:"].includes(url.protocol)&&!url.username&&!url.password,"Unsupported pack URL");
    const r=await fetcher(url,{credentials:"omit",redirect:"error"});assert(r.ok,"Atlas manifest unavailable");
    const text=await r.text();assert(text.length<=5e6,"Manifest exceeds size limit");return JSON.parse(text);
  }};
}
// Both hosted manifests and approved collection ZIPs enter the same renderer.
export async function openAtlasPack(manifest,registry=new AssetRegistry(),digest=null) {
  const url=new URL(manifest,location.href);
  assert(["http:","https:"].includes(url.protocol)&&!url.username&&!url.password,"Unsupported pack URL");
  let pack,archive=null;
  if(url.pathname.toLowerCase().endsWith(".zip")){
    const r=await fetch(url,{credentials:"omit",redirect:"error"});assert(r.ok,"Atlas ZIP unavailable");
    const limit=globalThis.VisualAtlasZip.MAX_BYTES;
    assert(Number(r.headers.get("content-length")??0)<=limit,"Atlas ZIP exceeds size limit");
    // Bound streamed bytes even when the server omits Content-Length.
    const reader=r.body.getReader(),parts=[];let length=0;
    try{for(;;){const {value,done}=await reader.read();if(done)break;length+=value.byteLength;assert(length<=limit,"Atlas ZIP exceeds size limit");parts.push(value);}}
    catch(e){await reader.cancel();throw e;}
    const blob=new Blob(parts);
    if(digest){const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",await blob.arrayBuffer())),x=>x.toString(16).padStart(2,"0")).join("");assert(hash===digest,"Atlas archive SHA-256 mismatch");}
    const result=await globalThis.VisualAtlasZip.read(blob,{JSZip:globalThis.JSZip,Collections:globalThis.VisualAtlasCollections,name:url.pathname.split("/").at(-1)});
    pack=result.resolved.pack;archive=result.zip;
  }else{
    assert(!digest,"Archive digest requires ZIP");
    registry.register("http",httpProvider());
    pack=await registry.load("http",url.href);
  }
  const images=new Map();
  async function getImage(key){
    if(images.has(key))return images.get(key);
    const t=pack.textures[key];assert(t&&safePath(t.path),"Unsafe texture path");
    const p=(async()=>{
      let target,temporary=false;
      if(archive){const member=archive.file(t.path);assert(member,"Missing archive texture: "+key);target=URL.createObjectURL(await member.async("blob"));temporary=true;}
      else{target=new URL(t.path,url);assert(target.origin===url.origin&&target.href.startsWith(new URL(".",url).href),"Texture escapes pack directory");}
      try{return await new Promise((resolve,reject)=>{const i=new Image();i.crossOrigin="anonymous";i.onload=()=>{try{assert(i.naturalWidth===t.width_px&&i.naturalHeight===t.height_px,"Texture dimensions mismatch");resolve(i);}catch(e){reject(e);}};i.onerror=()=>reject(Error("Texture unavailable: "+key));i.src=String(target);});}
      finally{if(temporary)URL.revokeObjectURL(target);}
    })().catch(e=>{if(images.get(key)===p)images.delete(key);throw e;});images.set(key,p);return p;
  }
  return {describe(asset){return structuredClone(validateSpritePack(pack,asset).get(asset));},createRaster({asset,state=null,regionOnly=false,requireState=false,...options}){
  const map=validateSpritePack(pack,asset);
  const root=map.get(asset);
  if(regionOnly)assert(root.kind==="region","Static texture must reference an Atlas region");
  if(requireState)assert(root.kind==="state_set"&&state!==null,"Wind state needs an Atlas state set");
  if(state!==null&&root.kind==="state_set")assert(Object.hasOwn(root.states,state),"Unknown Atlas state: "+state);
  const selection=visualSelection(options),slots=globalThis.VisualAtlasSlots;
  const explicit=Object.keys(selection).length>0;
  assert(!explicit||root.kind==="composition","Visual inputs, slots and presets require a root composition");
  const resolved=root.kind==="composition"?slots.resolve(root,selection.preset,selection.slots):{inputs:{}};
  for(const [key,value] of Object.entries(selection.inputs??{}))assert(Object.hasOwn(root.inputs??{},key)&&slots.accepts(root.inputs[key],value),"Invalid composition input: "+key);
  const values={...resolved.inputs,...selection.inputs};
  const renderer=globalThis.VisualAtlasRenderer.create({getAsset:id=>map.get(id),getImage,slots:globalThis.VisualAtlasSlots,timeline:globalThis.VisualAtlasTimeline,visualCore:globalThis.VisualAtlasVisualCore});
  const [w,h]=renderer.sizeFor(asset,new Set(),values,selection.preset,selection.slots);assert([w,h].every(v=>Number.isInteger(v)&&v>0&&v<=4096),"World sprite raster exceeds limit");
  const selected=root.kind==="state_set"?map.get(root.states[state??root.default_state]):root;
  // Only direct cyclic sequences of regions can be safely phase-shifted.
  // One-shot sequences, compositions and nested timelines retain their normal clock.
  const phasePeriod=cyclicRegionPeriod(selected,map);
  function makeRaster(){
  const canvas=document.createElement("canvas"),back=document.createElement("canvas");canvas.width=back.width=w;canvas.height=back.height=h;const ctx=back.getContext("2d");
  let revision=0,busy=false,last=-Infinity,pivot=[.5,1];
  return {image:canvas,pixelWidth:w,pixelHeight:h,animated:root.kind!=="region",phasePeriod,...(phasePeriod?{fork:makeRaster}:{}),contract:structuredClone({kind:root.kind,inputs:root.inputs??{},slots:root.slots??{},presets:root.presets??{},default_preset:root.default_preset,behavior:root.behavior}),get pivot(){return pivot;},get revision(){return revision;},
    async update(time){
      if(busy||(root.kind==="region"&&revision>0)||(time>=last&&time-last<80))return false;busy=true;
      try{ctx.clearRect(0,0,w,h);await renderer.drawAsset(asset,ctx,0,0,w,h,time,values,state,new Set(),selection.slots,selection.preset);pivot=renderer.pivotFor(asset,time,state)??[.5,1];const out=canvas.getContext("2d");out.clearRect(0,0,w,h);out.drawImage(back,0,0);revision++;last=time;return true;}finally{busy=false;}
    }};
  }
  return makeRaster();
  }};
}
// Canonical Atlas frame timing: authored holds plus default-rate frames.
// No change to the vendor renderer or asset schema.
export function cyclicRegionPeriod(sequence,assets){
  if(sequence?.kind!=="sequence"||!["loop","pingpong"].includes(sequence.playback)||sequence.frames.length<2||!sequence.frames.every(f=>assets.get(f.asset)?.kind==="region"))return 0;
  let holds=0,defaults=0;
  for(const f of sequence.frames){if(f.duration_ms)holds+=f.duration_ms;else defaults++;}
  const total=(holds+defaults*1000/sequence.default_fps)*(sequence.playback==="pingpong"?2:1);
  return Number.isFinite(total)&&total>0&&total<=600000?total:0;
}
// Four shared deterministic cohorts, not one canvas per world instance.
// The auxiliary CPU canvas allocation is bounded; over-budget sprites
// fall back to the normal shared phase. Clearing changes no world records.
export class AnimationPhasePool{
  #groups=new Map();#count=0;#bytes=0;
  constructor({maxEntries=24,maxBytes=32*1024*1024}={}){
    assert(Number.isSafeInteger(maxEntries)&&maxEntries>=0&&Number.isSafeInteger(maxBytes)&&maxBytes>=0,"Invalid phase budget");
    this.maxEntries=maxEntries;this.maxBytes=maxBytes;
  }
  select(base,unit){
    const cohort=Math.max(0,Math.min(3,Math.floor(unit*4)));
    if(!cohort||!base.phasePeriod||!base.fork)return {raster:base,offset:0};
    const group=this.#groups.get(base),existing=group?.get(cohort);
    if(existing)return existing;
    const bytes=base.pixelWidth*base.pixelHeight*8;
    if(this.#count>=this.maxEntries||this.#bytes+bytes>this.maxBytes)return {raster:base,offset:0};
    const next={raster:base.fork(),offset:base.phasePeriod*cohort/4};
    if(!group)this.#groups.set(base,new Map());
    this.#groups.get(base).set(cohort,next);this.#count++;this.#bytes+=bytes;
    return next;
  }
  clear(){this.#groups.clear();this.#count=0;this.#bytes=0;}
  diagnostics(){return {animation_phase_variants:this.#count,animation_phase_canvas_bytes:this.#bytes};}
}

// Share decoded sheets and archive resolution across object variants.
// Failed sessions are retryable; bound the session cache, not world records.
const packSessions=new Map();
export async function atlasPackSession(manifest,registry,archive_sha256=null){
  if(registry)return openAtlasPack(manifest,registry,archive_sha256);
  const key=JSON.stringify([new URL(manifest,location.href).href,archive_sha256??null]);
  if(!packSessions.has(key)){
    const p=openAtlasPack(manifest,undefined,archive_sha256).catch(e=>{if(packSessions.get(key)===p)packSessions.delete(key);throw e;});packSessions.set(key,p);
    if(packSessions.size>16)packSessions.delete(packSessions.keys().next().value);
  }
  return packSessions.get(key);
}
export async function createAtlasRaster({manifest,archive_sha256,...binding},registry){
  return (await atlasPackSession(manifest,registry,archive_sha256)).createRaster(binding);
}
export async function resolveAtlasBinding(raw){
  const pack=await atlasPackSession(raw.manifest,undefined,raw.archive_sha256);return adoptSpatialProfile(raw,pack.describe(raw.asset));
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
