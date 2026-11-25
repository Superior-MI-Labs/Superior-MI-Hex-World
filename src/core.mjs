import {shape, uniformShape, validateSubdivisions} from "./geometry.mjs";
import {surface} from "./materials.mjs";
import {validateEntity} from "./entities.mjs";
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
  return copy(config);
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
function cell(value, subdivisions) {
  requireThat(typeof value?.material==="string"&&value.material.length>0,"Invalid material");
  const geometry=shape(value.shape,subdivisions);
  requireThat(value.material!=="air"||geometry.upper.every((h,i)=>h===geometry.lower[i]),"Air cannot contain solid geometry");
  const result={...copy(value),shape:geometry};
  if(result.components?.surface!==undefined)result.components.surface=surface(result.components.surface);
  return result;
}
export class World {
  #config; #chunks=new Map(); #revision=0; #burning=new Set(); #burningDefaults=new Set(); #entities=new Map();
  constructor(config){this.#config=validateWorld(config);}
  get config(){return copy(this.#config);}
  get chunkCount(){return this.#chunks.size;}
  get entityCount(){return this.#entities.size;}
  entities(){return [...this.#entities.values()].map(copy);}
  getEntity(id){const value=this.#entities.get(id);return value&&copy(value);}
  putEntity(value){const e=validateEntity(value);requireThat(this.get(...e.address),"Unknown entity cell");requireThat(!this.#entities.has(e.id),"Duplicate entity ID");this.#entities.set(e.id,e);}
  removeEntity(id){return this.#entities.delete(id);}
  #location(q,r,z){const {chunk,local}=chunkOf(q,r,z,this.#config.grid.chunk_size);return [addressKey(...chunk),addressKey(...local)];}
  defineChunk(cq,cr,cz,defaultCell={material:"air",shape:uniformShape(0)}){
    const key=addressKey(cq,cr,cz);requireThat(!this.#chunks.has(key),"Chunk already defined");
    const value=cell(defaultCell,this.#config.grid.geometry_subdivisions);
    this.#chunks.set(key,{defaultCell:value,cells:new Map(),geometryRevision:++this.#revision});
    if(value.components?.surface?.burn>0)this.#burningDefaults.add(key);
  }
  get(q,r,z){const [key,local]=this.#location(q,r,z),chunk=this.#chunks.get(key);return chunk ? copy(chunk.cells.get(local)??chunk.defaultCell):undefined;}
  geometryRevisionAt(q,r,z){const [key]=this.#location(q,r,z);return this.#chunks.get(key)?.geometryRevision??null;}
  set(q,r,z,value){this.apply([{address:[q,r,z],value}]);}
  apply(edits){
    const pending=edits.map(({address,value})=>{requireThat(Array.isArray(address)&&address.length===3&&address.every(int),"Invalid edit address");const [key,local]=this.#location(...address),chunk=this.#chunks.get(key);requireThat(chunk,"Unknown chunk");return {chunk,local,key:addressKey(...address),value:cell(value,this.#config.grid.geometry_subdivisions)};});
    const changed=new Set();
    for(const {chunk,local,key,value} of pending){
      const old=chunk.cells.get(local)??chunk.defaultCell;
      if(old.material!==value.material||["lower","upper"].some(k=>old.shape[k].some((h,i)=>h!==value.shape[k][i])))changed.add(chunk);
      chunk.cells.set(local,value);
      if(value.components?.surface?.burn>0)this.#burning.add(key);else this.#burning.delete(key);
    }
    for(const chunk of changed)chunk.geometryRevision=++this.#revision;
  }
  *burningAddresses(){
    for(const key of this.#burning)yield key.split(",").map(Number);
    const size=this.#config.grid.chunk_size;
    for(const key of this.#burningDefaults){
      const c=this.#chunks.get(key),origin=key.split(",").map((v,i)=>Number(v)*size[i]);
      for(let q=0;q<size[0];q++)for(let r=0;r<size[1];r++)for(let z=0;z<size[2];z++){
        if(c.cells.has(addressKey(q,r,z)))continue;
        const a=[q+origin[0],r+origin[1],z+origin[2]];if(a.every(int))yield a;
      }
    }
  }
  snapshot(){
    return {schema:"smi-hex-save/1",world:this.config,entities:this.entities(),chunks:[...this.#chunks].map(([key,c])=>({address:key.split(",").map(Number),defaultCell:copy(c.defaultCell),cells:[...c.cells].map(([local,value])=>({local:local.split(",").map(Number),value:copy(value)}))}))};
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
    return w;
  }
}
export class Clock {
  #mode; #rate; #simulation=0; #visual=0;
  constructor({mode="frozen",rate=1}={}){this.configure(mode,rate);}
  configure(mode,rate=1){requireThat(["frozen","manual","turn-based","real-time","scaled"].includes(mode)&&positive(rate),"Invalid clock");this.#mode=mode;this.#rate=rate;}
  get simulation(){return this.#simulation;} get visual(){return this.#visual;}
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
export function effectActive(instance,simulationTime){return instance.behavior!=="timed"||simulationTime-instance.startedAt<instance.duration;}
export class AssetRegistry {
  #providers=new Map();
  register(id,provider){requireThat(typeof id==="string"&&id.length>0&&!this.#providers.has(id)&&typeof provider?.loadPack==="function","Invalid provider");this.#providers.set(id,provider);}
  async load(id,reference){const provider=this.#providers.get(id);requireThat(provider,"Unknown provider");const pack=await provider.loadPack(reference);requireThat(pack?.schema==="smi-visual-pack/1","Unsupported visual pack");return copy(pack);}
}
