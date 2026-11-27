// Presentation profile: binds existing Atlas IDs to Hex World visual roles.
import {openAtlasPack} from "./assets.mjs";
import {stableUnit} from "./materials.mjs";
import {validateWindResponse,windState,SEASONS,validateLighting} from "./environment.mjs";
import {adoptSpatialProfile} from "./spatial-assets.mjs";
import {directionalBinding} from "./entities.mjs";
const assert=(ok,msg)=>{if(!ok)throw Error(msg);};
const positive=n=>Number.isFinite(n)&&n>0;
const id=s=>typeof s==="string"&&s.length>0&&s.length<=2048;
const own=(o,k)=>Object.hasOwn(o??{},k);
export function artBinding(value,defaultManifest){
  const b=typeof value==="string"?{asset:value,manifest:defaultManifest}:value&&{...value,manifest:value.manifest??defaultManifest};
  assert(b&&id(b.asset)&&id(b.manifest),"Invalid art binding");
  const url=new URL(b.manifest,"https://local.invalid/");assert(["http:","https:"].includes(url.protocol)&&!url.username&&!url.password,"Invalid art manifest URL");
  assert(b.state===undefined||b.state===null||id(b.state),"Invalid art state");
  assert(b.archive_sha256===undefined||typeof b.archive_sha256==="string"&&/^[a-f0-9]{64}$/.test(b.archive_sha256)&&url.pathname.toLowerCase().endsWith(".zip"),"Invalid style archive digest");
  return {asset:b.asset,manifest:b.manifest,...(b.archive_sha256?{archive_sha256:b.archive_sha256}:{}),...(b.state!=null?{state:b.state}:{})};
}
export function resolveStyleProfile(profile,baseURL){
  const s=validateStyle(profile),resolve=b=>{const x=artBinding(b,s.manifest);return {...x,manifest:new URL(x.manifest,baseURL).href};};
  s.detail.top=resolve(s.detail.top);s.detail.side=resolve(s.detail.side);
  for(const d of Object.values(s.detail.materials??{}))for(const role of ["top","side"])if(d[role]!==undefined)d[role]=resolve(d[role]);
  s.vegetation.assets=Object.fromEntries(Object.entries(s.vegetation.assets).map(([k,v])=>[k,resolve(v)]));
  for(const entries of Object.values(s.vegetation.seasonal??{}))for(const [k,v] of Object.entries(entries))entries[k]={...resolve(v),...(v.wind!==undefined?{wind:v.wind}:{})};
  for(const f of s.vegetation.families??[])for(const v of f.variants){v.asset=resolve(v.asset);for(const [season,b] of Object.entries(v.seasonal??{}))v.seasonal[season]=resolve(b);}
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
  const light=validateLighting(l);
  assert(v&&v.assets&&typeof v.assets==="object"&&!Array.isArray(v.assets)&&Object.keys(v.assets).length>0&&Object.keys(v.assets).length<=512&&Number.isInteger(v.samples_per_triangle)&&v.samples_per_triangle>=1&&v.samples_per_triangle<=8&&positive(v.min_height_ft)&&positive(v.max_height_ft)&&v.max_height_ft>=v.min_height_ft&&positive(v.far_px_per_ft)&&v.near_px_per_ft>v.far_px_per_ft,"Invalid vegetation profile");
  for(const b of Object.values(v.assets))artBinding(b,s.manifest);
  assert(v.wind===undefined||(v.wind&&typeof v.wind==="object"&&!Array.isArray(v.wind)),"Invalid vegetation wind map");
  const out=structuredClone(s);out.lighting=light;
  if(v.wind!==undefined){for(const [k,w] of Object.entries(v.wind)){assert(own(v.assets,k),"Unknown wind variant: "+k);out.vegetation.wind[k]=validateWindResponse(w);}}
  assert(v.seasonal===undefined||(v.seasonal&&typeof v.seasonal==="object"&&!Array.isArray(v.seasonal)),"Invalid seasonal bindings");
  for(const [season,entries] of Object.entries(v.seasonal??{})){
    assert(SEASONS.includes(season)&&entries&&typeof entries==="object"&&!Array.isArray(entries),"Invalid season");
    for(const [k,b] of Object.entries(entries)){assert(own(v.assets,k),"Unknown seasonal variant");artBinding(b,s.manifest);if(b.wind!==undefined)out.vegetation.seasonal[season][k]={...b,wind:validateWindResponse(b.wind)};}
  }
  if(v.families!==undefined)out.vegetation.families=validateFamilies(v.families,s.manifest);
  return out;
}
const range=(v,min,max)=>Array.isArray(v)&&v.length===2&&v.every(n=>Number.isFinite(n)&&n>=min&&n<=max)&&v[0]<=v[1];
const unit=n=>Number.isFinite(n)&&n>=0&&n<=1;
const familyId=s=>typeof s==="string"&&/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(s);
const record=v=>v&&typeof v==="object"&&!Array.isArray(v);
function validateFamilies(families,manifest){
  assert(Array.isArray(families)&&families.length<=16,"Too many scatter families");
  const ids=new Set();let budget=0,variants=0;
  return families.map(f=>{
    assert(record(f)&&familyId(f.id)&&!ids.has(f.id),"Invalid scatter family ID");ids.add(f.id);
    assert(Array.isArray(f.materials)&&f.materials.length>0&&f.materials.length<=64&&f.materials.every(familyId)&&new Set(f.materials).size===f.materials.length,"Invalid scatter materials");
    assert(unit(f.density)&&Number.isInteger(f.samples_per_triangle)&&f.samples_per_triangle>=1&&f.samples_per_triangle<=8,"Invalid scatter density");
    budget+=f.samples_per_triangle;assert(budget<=24,"Scatter candidate budget exceeded");
    assert(Number.isFinite(f.far_px_per_ft)&&f.far_px_per_ft>=0&&positive(f.near_px_per_ft)&&f.near_px_per_ft>f.far_px_per_ft,"Invalid scatter LOD");
    assert(f.max_grade===undefined||Number.isFinite(f.max_grade)&&f.max_grade>=0&&f.max_grade<=10,"Invalid scatter grade");
    assert(record(f.surface??{}),"Invalid scatter surface constraints");
    for(const [k,r] of Object.entries(f.surface??{}))assert(["growth","health","moisture","leaves","snow","scorch"].includes(k)&&range(r,0,1),"Invalid scatter surface range");
    assert(f.spacing_ft===undefined||Number.isFinite(f.spacing_ft)&&f.spacing_ft>=0&&f.spacing_ft<=5,"Invalid scatter spacing");
    assert(f.contact===undefined||typeof f.contact==="boolean","Invalid scatter contact");
    assert(f.shadow===undefined||typeof f.shadow==="boolean","Invalid scatter shadow");
    assert(Array.isArray(f.variants)&&f.variants.length>0&&f.variants.length<=32,"Invalid scatter variants");
    variants+=f.variants.length;assert(variants<=64,"Scatter variant budget exceeded");
    const keys=new Set();
    const vs=f.variants.map(v=>{
      assert(record(v)&&familyId(v.id)&&!keys.has(v.id)&&positive(v.weight)&&v.weight<=1e6,"Invalid scatter variant");keys.add(v.id);
      artBinding(v.asset,manifest);
      assert(v.height_ft===undefined||positive(v.height_ft)&&v.height_ft<=100,"Invalid scatter height");
      assert(range(v.height_scale??[1,1],.1,3),"Invalid scatter scale");
      assert(record(v.seasonal??{}),"Invalid scatter seasons");
      for(const [season,b] of Object.entries(v.seasonal??{})){assert(SEASONS.includes(season),"Unknown scatter season");artBinding(b,manifest);}
      return {...structuredClone(v),height_scale:v.height_scale??[1,1]};
    });
    return {...structuredClone(f),surface:f.surface??{},variants:vs};
  });
}
export async function loadStyle(profile,{baseURL=location.href,openPack=openAtlasPack}={}){
  const s=resolveStyleProfile(profile,baseURL),packs=new Map(),rasters=new Map();
  function session(binding){
    const {manifest,archive_sha256}=binding,key=JSON.stringify([manifest,archive_sha256??null]);
    if(!packs.has(key))packs.set(key,Promise.resolve().then(()=>openPack(manifest,undefined,archive_sha256)));
    return packs.get(key);
  }
  async function load(binding,regionOnly=false){
    const {manifest,archive_sha256,asset,state=null}=binding,key=JSON.stringify([manifest,archive_sha256??null,asset,state,regionOnly]);
    if(!rasters.has(key))rasters.set(key,(async()=>{const pack=await session(binding),r=pack.createRaster({asset,state,regionOnly,requireState:state!==null&&!regionOnly});await r.update(0);return r;})());
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
  const scatter=new Map(),scatterWarnings=[],scatterKeys=new Set();
  async function scatterVisual(source,height){
    const pack=await session(source),{binding,warnings}=adoptSpatialProfile({...source,...(height!==undefined?{height_ft:height}:{})},pack.describe(source.asset));
    scatterWarnings.push(...warnings.map(w=>source.asset+": "+w));
    const views=binding.views??[binding.asset],byView=new Map();
    for(const asset of new Set(views)){
      const states=new Map(),names=[...new Set([binding.state,...(binding.wind?.states??[]).map(w=>w.state)])];
      for(const state of names){
        scatterKeys.add(JSON.stringify([binding.manifest,binding.archive_sha256??null,asset,state]));
        assert(scatterKeys.size<=256,"Scatter raster budget exceeded");
        states.set(state,await load({...binding,asset,state}));
      }
      byView.set(asset,states);
    }
    return {binding,byView};
  }
  for(const f of s.vegetation.families??[]){
    const variants=new Map();scatter.set(f.id,variants);
    for(const v of f.variants){
      const base=await scatterVisual(v.asset,v.height_ft),seasonal=new Map();
      for(const [season,source] of Object.entries(v.seasonal??{}))seasonal.set(season,await scatterVisual(source,base.binding.height_ft));
      variants.set(v.id,{base,seasonal});
    }
  }
  return {profile:s,top,side,vegetation:new Map(entries),windRasters,materialRasters,seasonalRasters,seasonalWindRasters,scatter,scatterWarnings};
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
  if(catalog.materials){for(const k of Object.keys(profile.detail.materials??{}))assert(own(catalog.materials,k),"Unknown material binding: "+k);for(const f of profile.vegetation.families??[])for(const k of f.materials)assert(own(catalog.materials,k),"Unknown scatter material: "+k);}
  return profile;
}
export async function fetchStyle(reference,catalog,{fetcher=fetch,baseURL=location.href,openPack=openAtlasPack}={}){
  const url=new URL(reference,baseURL);assert(["http:","https:"].includes(url.protocol)&&!url.username&&!url.password,"Invalid style URL");
  const response=await fetcher(url,{credentials:"omit",redirect:"error"});assert(response.ok,"Style unavailable");
  const raw=await response.text();assert(raw.length<=1e6,"Style exceeds size limit");
  const profile=validateStyleVariants(validateStyle(JSON.parse(raw)),catalog);
  return loadStyle(profile,{baseURL:url.href,openPack});
}

// Shared sampling primitive: stable candidate positions on actual terrain triangles.
function triangleSample(face,seed,salt){
  const rand=k=>stableUnit(seed,face.address,salt+":"+k),a=Math.sqrt(rand("a")),b=rand("b"),weights=[1-a,a*(1-b),a*b];
  return {rand,point:[0,1,2].map(j=>face.points.reduce((sum,p,k)=>sum+p[j]*weights[k],0))};
}
const lodCount=(v,scale)=>Math.ceil(v.samples_per_triangle*Math.max(0,Math.min(1,(scale-v.far_px_per_ft)/(v.near_px_per_ft-v.far_px_per_ft))));
// Stable samples in the actual terrain triangle, not the cell's bounding box.
// Distance only prunes a stable subset; it never relocates surviving tufts.
export function vegetationSamples(face,seed,profile,scale){
  if(face.kind!=="top"||face.vegetation<=0)return [];
  const v=profile.vegetation,out=[],count=lodCount(v,scale);
  for(let i=0;i<count;i++){
    const {rand,point}=triangleSample(face,seed,"tuft:"+face.triangle+":"+i);
    if(rand("density")>face.vegetation)continue;
    const height=v.min_height_ft+(v.max_height_ft-v.min_height_ft)*face.vegetation*(.55+.45*rand("height"));
    out.push({point,height,variant:face.variant});
  }
  return out;
}

// Additional decorative families are independent of physical grass growth.
export function scatterSamples(face,seed,profile,scale){
  if(face.kind!=="top"||!profile.vegetation.families?.length)return [];
  const [a,b,c]=face.points,u=b.map((v,i)=>v-a[i]),v=c.map((x,i)=>x-a[i]);
  const normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],grade=Math.abs(normal[2])>1e-8?Math.hypot(normal[0],normal[1])/Math.abs(normal[2]):Infinity;
  const out=[];
  for(const f of profile.vegetation.families){
    if(!f.materials.includes(face.material)||grade>(f.max_grade??Infinity)||Object.entries(f.surface).some(([k,[lo,hi]])=>!Number.isFinite(face.surface?.[k])||face.surface[k]<lo||face.surface[k]>hi))continue;
    const total=f.variants.reduce((n,v)=>n+v.weight,0);
    for(let i=0;i<lodCount(f,scale);i++){
      const {rand,point}=triangleSample(face,seed,"scatter:"+f.id+":"+face.triangle+":"+i);
      if(rand("density")>=f.density)continue;
      let roll=rand("variant")*total,variant=f.variants.at(-1);
      for(const v of f.variants){roll-=v.weight;if(roll<0){variant=v;break;}}
      const [lo,hi]=variant.height_scale;
      out.push({family:f.id,variant:variant.id,address:[...face.address],slot:i,key:JSON.stringify([profile.id,f.id,face.triangle,i]),spacing:f.spacing_ft??0,lod_px:f.far_px_per_ft+i/f.samples_per_triangle*(f.near_px_per_ft-f.far_px_per_ft),rank:rand("spacing"),point,scale:lo+(hi-lo)*rand("height"),orientation:Math.floor(rand("orientation")*6),contact:!!f.contact,shadow:!!f.shadow});
    }
  }
  return out;
}
export function scatterRaster(style,sample,wind,season,yaw){
  const entry=style.scatter.get(sample.family)?.get(sample.variant);if(!entry)return null;
  const visual=entry.seasonal.get(season)??entry.base,b=directionalBinding(visual.binding,yaw,sample.orientation),state=windState(b.wind,wind,b.state),r=visual.byView.get(b.asset)?.get(state);
  return r?{r,height:entry.base.binding.height_ft*sample.scale,wind:b.wind,seasonal:visual!==entry.base,animatedState:state!==b.state}:null;
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

// Host pilot recipe, not a separate catalog or asset format.
export function woodlandPreviewStyle(fixture,entries,fixtureURL){
  const s=resolveStyleProfile(fixture,fixtureURL),byId=new Map(entries.map(e=>[e.id,e]));
  function bind(id){
    const e=byId.get(id);
    assert(e?.binding?.archive_sha256&&e.license==="CC0-1.0","Missing approved woodland asset: "+id);
    return artBinding(e.binding);
  }
  const grass="smi.world.fantasy.recovered.grass-20261125.",foliage="smi.world.fantasy.recovered.foliage-20261125.",
    trees="smi.world.fantasy.recovered.trees-20261125.",fern="smi.world.fantasy.woodland.seasonal-fern-20261125a.";
  s.id="published-woodland-preview";
  const v=s.vegetation;
  v.assets=Object.fromEntries([1,2,3].map(i=>["meadow-0"+i,bind(grass+"green-grass-0"+i)]));
  v.min_height_ft=.45;v.max_height_ft=.85;
  // Deliberate host wind override for static grass regions.
  v.wind=Object.fromEntries(Object.keys(v.assets).map(k=>[k,{bend:.4,reference_speed_ft_s:20}]));
  v.seasonal={autumn:Object.fromEntries([1,2,3].map(i=>["meadow-0"+i,bind(grass+"golden-dry-grass-0"+i)]))};
  v.families=[
    {id:"woodland-understory",materials:["soil"],density:.18,samples_per_triangle:1,far_px_per_ft:5,near_px_per_ft:14,max_grade:1,
      surface:{growth:[.2,1],scorch:[0,.5]},contact:true,shadow:true,spacing_ft:2,
      variants:[{id:"shrub",asset:bind(foliage+"natural-round-bush"),weight:1},
        {id:"fern",asset:bind(fern+"summer"),height_ft:1.5,weight:2,
          seasonal:Object.fromEntries(["spring","autumn","winter"].map(k=>[k,bind(fern+k)]))}]},
    {id:"woodland-trees",materials:["soil"],density:.035,samples_per_triangle:1,far_px_per_ft:2,near_px_per_ft:12,max_grade:.7,
      surface:{growth:[.4,1]},shadow:true,spacing_ft:5,
      variants:[{id:"broadleaf",asset:bind(trees+"painted-broadleaf-tree"),weight:1}]}
  ];
  return validateStyle(s);
}
