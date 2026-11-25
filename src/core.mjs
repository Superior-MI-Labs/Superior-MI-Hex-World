import {shape, uniformShape, validateSubdivisions} from "./geometry.mjs";
import {surface} from "./materials.mjs";
import {validateEntity,validAddress,visualSelection,anchorHeight,colliderActive} from "./entities.mjs";
import {interactionTags} from "./interactions.mjs";
import {validateEnvironment,validateWater} from "./environment.mjs";
export {shape} from "./geometry.mjs";
// Game-neutral spatial and time contracts. No DOM or wall-clock dependency.
const int = Number.isSafeInteger;
const positive = n => Number.isFinite(n) && n > 0;
const requireThat = (ok, msg) => { if (!ok) throw new Error(msg); };
const copy = value => structuredClone(value);
export const DIRECTIONS = Object.freeze([[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]].map(Object.freeze));
export const addressKey = (q,r,z) => { requireThat([q,r,z].every(int),"Invalid address"); return [q,r,z].join(","); };
export function validateWorld(config) {
  requireThat(config?.schema === "smi-hex-world/1" && typeof config.id === "string" && config.id.length > 0,"Invalid world");
  const g=config.grid;
  requireThat(positive(g?.horizontal_ft)&&positive(g?.vertical_ft),"Invalid grid scale");
  validateSubdivisions(g.geometry_subdivisions);
  requireThat(g.geometry_subdivisions===2,"This world profile requires two geometry subdivisions");
  requireThat(Array.isArray(g.chunk_size)&&g.chunk_size.length===3&&g.chunk_size.every(n=>int(n)&&n>0&&n<=256),"Invalid chunk dimensions");
  requireThat(["frozen","manual","turn-based","real-time","scaled"].includes(config.simulation?.mode)&&positive(config.simulation?.rate),"Invalid clock configuration");
  const out=copy(config);if(out.environment!==undefined)out.environment=validateEnvironment(out.environment);return out;
}
export function chunkOf(q,r,z,size=[16,16,16]) {
  addressKey(q,r,z);
  requireThat(size.length===3&&size.every(n=>int(n)&&n>0&&n<=256),"Invalid chunk dimensions");
  const coords=[q,r,z],chunk=coords.map((n,i)=>Math.floor(n/size[i]));
  // modulo avoids overflow of intermediate chunk*size near safe-integer limits.
  const local=coords.map((n,i)=>((n%size[i])+size[i])%size[i]);
  return {chunk,local};
}
export function physicalPosition(q,r,z,grid) {
  addressKey(q,r,z);
  return {x:grid.horizontal_ft*(q+r/2),y:grid.horizontal_ft*Math.sqrt(3)*r/2,z:z*grid.vertical_ft};
}
export function neighbors(q,r,z) {
  addressKey(q,r,z);
  return [...DIRECTIONS.map(([a,b])=>[q+a,r+b,z]),[q,r,z+1],[q,r,z-1]].filter(a=>a.every(int));
}
export function validateCell(value, subdivisions) {
  requireThat(typeof value?.material==="string"&&value.material.length>0,"Invalid material");
  const geometry=shape(value.shape,subdivisions);
  requireThat(value.material!=="air"||geometry.upper.every((h,i)=>h===geometry.lower[i]),"Air cannot contain solid geometry");
  const result={...copy(value),shape:geometry};
  if(result.components?.surface!==undefined)result.components.surface=surface(result.components.surface);
  if(result.components?.interaction_tags!==undefined)result.components.interaction_tags=interactionTags(result.components.interaction_tags);
  if(result.components?.water!==undefined)result.components.water=validateWater(result.components.water);
  if(result.components?.scatter_hidden!==undefined)result.components.scatter_hidden=validateScatterKeys(result.components.scatter_hidden);
  return result;
}
function validateScatterKeys(keys){
  requireThat(Array.isArray(keys)&&keys.length<=512&&keys.every(k=>typeof k==="string"&&k.length>0&&k.length<=4096)&&new Set(keys).size===keys.length,"Invalid scatter suppression keys");return [...keys].sort();
}
export class World {
  #config; #chunks=new Map(); #revision=0; #burning=new Set(); #burningDefaults=new Set(); #wet=new Set(); #wetDefaults=new Set(); #entities=new Map(); #collisionRevision=0; #effects=new Map(); #clockState=null;
  constructor(config){this.#config=validateWorld(config);}
  get config(){return copy(this.#config);}
  get environment(){return validateEnvironment(this.#config.environment);}
  setEnvironment(value){this.#config.environment=validateEnvironment(value);}
  get chunkCount(){return this.#chunks.size;}
  get entityCount(){return this.#entities.size;}
  get collisionRevision(){return this.#collisionRevision;}
  effects(){return [...this.#effects.values()].map(copy);}
  putEffect(value){const e=validatePlacedEffect(value);requireThat(this.get(...e.address),"Unknown effect cell");requireThat(!this.#effects.has(e.id),"Duplicate effect ID");this.#effects.set(e.id,e);}
  removeEffect(id){return this.#effects.delete(id);}
  setClockState(state){this.#clockState=Clock.restore(state).snapshot();}
  get clockState(){return this.#clockState?copy(this.#clockState):null;}
  entities(){return [...this.#entities.values()].map(copy);}
  getEntity(id){const value=this.#entities.get(id);return value&&copy(value);}
  putEntity(value){const e=validateEntity(value);requireThat(this.get(...e.address),"Unknown entity cell");requireThat(!this.#entities.has(e.id),"Duplicate entity ID");this.#entities.set(e.id,e);if(e.collider)this.#collisionRevision++;}
  removeEntity(id){const old=this.#entities.get(id),removed=this.#entities.delete(id);if(old?.collider)this.#collisionRevision++;return removed;}
  setEntityCollider(id,collider,selection=null){
    const old=this.#entities.get(id);requireThat(old,"Unknown entity");
    const {collider:previous,...rest}=old,{inputs,slots,preset,...base}=old.visual;
    const visual=selection===null?old.visual:{...base,...visualSelection(selection)};
    const next=validateEntity({...rest,visual,...(collider===null?{}:{collider})});
    this.#entities.set(id,next);
    if(JSON.stringify(previous)!==JSON.stringify(next.collider)||colliderActive(old)!==colliderActive(next))this.#collisionRevision++;
  }
  promoteScatter(key,value){
    const e=validateEntity(value),c=this.get(...e.address);requireThat(c&&e.anchor==="surface"&&anchorHeight(e,c,this.#config.grid)!==undefined,"Scatter needs supporting terrain");requireThat(!this.#entities.has(e.id),"Duplicate entity ID");
    const hidden=c.components?.scatter_hidden??[];requireThat(!hidden.includes(key),"Scatter already promoted");
    const keys=validateScatterKeys([...hidden,key]);
    // Both records are validated before the synchronous commit; no partial entity on failure.
    this.set(...e.address,{...c,components:{...c.components,scatter_hidden:keys}});this.#entities.set(e.id,e);if(e.collider)this.#collisionRevision++;
  }
  setEntityAppearance(id,selection){
    const e=this.#entities.get(id);requireThat(e,"Unknown entity");
    const {inputs,slots,preset,...visual}=e.visual;
    const next=validateEntity({...e,visual:{...visual,...visualSelection(selection)}});this.#entities.set(id,next);
    if(colliderActive(e)!==colliderActive(next))this.#collisionRevision++;
  }
  setEntityLight(id,light){const e=this.#entities.get(id);requireThat(e,"Unknown entity");const {light:previous,...rest}=e;this.#entities.set(id,validateEntity(light===null?rest:{...rest,light}));}
  setEntityOrientation(id,orientation_steps){const e=this.#entities.get(id);requireThat(e,"Unknown entity");this.#entities.set(id,validateEntity({...e,orientation_steps}));}
  setEntityTags(id,tags){const e=this.#entities.get(id);requireThat(e,"Unknown entity");this.#entities.set(id,validateEntity({...e,interaction_tags:tags}));}
  relocateEntity(id,address){const old=this.#entities.get(id);requireThat(old,"Unknown entity");const next=validateEntity({...old,address});requireThat(this.get(...next.address),"Unknown entity cell");this.#entities.set(id,next);if(old.collider&&old.address.some((v,i)=>v!==address[i]))this.#collisionRevision++;}
  #location(q,r,z){const {chunk,local}=chunkOf(q,r,z,this.#config.grid.chunk_size);return [addressKey(...chunk),addressKey(...local)];}
  defineChunk(cq,cr,cz,defaultCell={material:"air",shape:uniformShape(0)}){
    const key=addressKey(cq,cr,cz);requireThat(!this.#chunks.has(key),"Chunk already defined");
    const value=validateCell(defaultCell,this.#config.grid.geometry_subdivisions);
    this.#chunks.set(key,{defaultCell:value,cells:new Map(),geometryRevision:++this.#revision});
    if(value.components?.surface?.burn>0)this.#burningDefaults.add(key);
    if(value.components?.water?.fill>0)this.#wetDefaults.add(key);
  }
  get(q,r,z){const [key,local]=this.#location(q,r,z),chunk=this.#chunks.get(key);return chunk ? copy(chunk.cells.get(local)??chunk.defaultCell):undefined;}
  geometryRevisionAt(q,r,z){const [key]=this.#location(q,r,z);return this.#chunks.get(key)?.geometryRevision??null;}
  set(q,r,z,value){this.apply([{address:[q,r,z],value}]);}
  apply(edits){
    const pending=edits.map(({address,value})=>{requireThat(Array.isArray(address)&&address.length===3&&address.every(int),"Invalid edit address");const [key,local]=this.#location(...address),chunk=this.#chunks.get(key);requireThat(chunk,"Unknown chunk");return {chunk,local,key:addressKey(...address),value:validateCell(value,this.#config.grid.geometry_subdivisions)};});
    const changed=new Set();
    for(const {chunk,local,key,value} of pending){
      const old=chunk.cells.get(local)??chunk.defaultCell;
      if(old.material!==value.material||["lower","upper"].some(k=>old.shape[k].some((h,i)=>h!==value.shape[k][i])))changed.add(chunk);
      chunk.cells.set(local,value);
      if(value.components?.surface?.burn>0)this.#burning.add(key);else this.#burning.delete(key);
      if(value.components?.water?.fill>0)this.#wet.add(key);else this.#wet.delete(key);
    }
    for(const chunk of changed)chunk.geometryRevision=++this.#revision;
  }
  *burningAddresses(){yield* this.#componentAddresses(this.#burning,this.#burningDefaults);}
  *waterAddresses(){yield* this.#componentAddresses(this.#wet,this.#wetDefaults);}
  *#componentAddresses(explicit,defaults){
    for(const key of explicit)yield key.split(",").map(Number);
    const size=this.#config.grid.chunk_size;
    for(const key of defaults){
      const c=this.#chunks.get(key),origin=key.split(",").map((v,i)=>Number(v)*size[i]);
      for(let q=0;q<size[0];q++)for(let r=0;r<size[1];r++)for(let z=0;z<size[2];z++){
        if(c.cells.has(addressKey(q,r,z)))continue;
        const a=[q+origin[0],r+origin[1],z+origin[2]];if(a.every(int))yield a;
      }
    }
  }
  snapshot(){
    return {schema:"smi-hex-save/1",world:this.config,entities:this.entities(),effects:this.effects(),clock:this.clockState,chunks:[...this.#chunks].map(([key,c])=>({address:key.split(",").map(Number),defaultCell:copy(c.defaultCell),cells:[...c.cells].map(([local,value])=>({local:local.split(",").map(Number),value:copy(value)}))}))};
  }
  static restore(data){
    requireThat(data?.schema==="smi-hex-save/1"&&Array.isArray(data.chunks),"Invalid world save");
    const w=new World(data.world),size=w.#config.grid.chunk_size;
    const validAddress=a=>Array.isArray(a)&&a.length===3&&a.every(int);
    for(const c of data.chunks){
      requireThat(validAddress(c.address)&&c.defaultCell&&Array.isArray(c.cells),"Invalid chunk record");
      w.defineChunk(...c.address,c.defaultCell);
      const seen=new Set();
      for(const e of c.cells){
        requireThat(validAddress(e.local)&&e.local.every((v,i)=>v>=0&&v<size[i]),"Invalid local address");
        const k=addressKey(...e.local);requireThat(!seen.has(k),"Duplicate cell");seen.add(k);
        const address=e.local.map((v,i)=>c.address[i]*size[i]+v);
        requireThat(address.every(int)&&chunkOf(...address,size).chunk.every((v,i)=>v===c.address[i]),"Invalid global address");
        w.set(...address,e.value);
      }
    }
    requireThat(data.entities===undefined||Array.isArray(data.entities),"Invalid saved entities");
    for(const e of data.entities??[])w.putEntity(e);
    requireThat(data.effects===undefined||Array.isArray(data.effects),"Invalid saved effects");
    for(const e of data.effects??[])w.putEffect(e);
    if(data.clock!=null)w.setClockState(data.clock);
    return w;
  }
}
export class Clock {
  #mode; #rate; #simulation=0; #visual=0;
  constructor({mode="frozen",rate=1}={}){this.configure(mode,rate);}
  configure(mode,rate=1){requireThat(["frozen","manual","turn-based","real-time","scaled"].includes(mode)&&positive(rate),"Invalid clock");this.#mode=mode;this.#rate=rate;}
  get simulation(){return this.#simulation;} get visual(){return this.#visual;}
  snapshot(){return {mode:this.#mode,rate:this.#rate,simulation:this.#simulation};}
  static restore(state){requireThat(state&&Number.isFinite(state.simulation)&&state.simulation>=0,"Invalid simulation clock");const c=new Clock({mode:state.mode,rate:state.rate});c.#simulation=state.simulation;return c;}
  advance(seconds,source="manual"){requireThat(Number.isFinite(seconds)&&seconds>=0,"Invalid delta");
    const allowed=(source==="manual"&&["manual","turn-based"].includes(this.#mode))||(source==="realtime"&&["real-time","scaled"].includes(this.#mode));
    if(allowed){const next=this.#simulation+seconds*(this.#mode==="scaled"?this.#rate:1);requireThat(Number.isFinite(next),"Clock overflow");this.#simulation=next;}return this.#simulation;}
  animate(seconds){requireThat(Number.isFinite(seconds)&&seconds>=0&&Number.isFinite(this.#visual+seconds),"Invalid delta");return this.#visual+=seconds;}
}
export function effect(definition,startedAt=0){
  requireThat(["persistent","decorative","timed","reactive"].includes(definition?.behavior)&&Number.isFinite(startedAt)&&startedAt>=0,"Invalid effect");
  if(definition.behavior==="timed")requireThat(positive(definition.duration),"Invalid duration");
  return {...copy(definition),startedAt};
}
export function effectActive(instance,simulationTime){return simulationTime>=instance.startedAt&&(instance.behavior!=="timed"||simulationTime-instance.startedAt<instance.duration);}
export function validatePlacedEffect(e){
  requireThat(e&&typeof e.id==="string"&&e.id.length>0&&e.id.length<=200&&validAddress(e.address),"Invalid placed effect");
  requireThat(e.kind==="fire"&&["persistent","decorative","timed"].includes(e.instance?.behavior),"Unsupported placed effect");
  requireThat(Number.isFinite(e.instance.startedAt)&&e.instance.startedAt>=0,"Invalid effect start");
  return {...copy(e),instance:effect(e.instance,e.instance.startedAt)};
}
export class AssetRegistry {
  #providers=new Map();
  register(id,provider){requireThat(typeof id==="string"&&id.length>0&&!this.#providers.has(id)&&typeof provider?.loadPack==="function","Invalid provider");this.#providers.set(id,provider);}
  async load(id,reference){const provider=this.#providers.get(id);requireThat(provider,"Unknown provider");const pack=await provider.loadPack(reference);requireThat(pack?.schema==="smi-visual-pack/1","Unsupported visual pack");return copy(pack);}
}
