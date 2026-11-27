// One frame aggregator for live diagnostics and explicit hardware captures.
const round=v=>Math.round(v*10)/10;
const percentile=(a,p)=>a[Math.max(0,Math.ceil(a.length*p)-1)]??0;
export class FrameSamples{
  #sum={};#intervals=[];#gpu=[];#count=0;#terrainUploads=0;#spriteUploads=0;#cacheHits=0;
  constructor(limit=4096){if(!Number.isSafeInteger(limit)||limit<1||limit>4096)throw Error("Invalid sample limit");this.limit=limit;}
  get count(){return this.#count;}
  add(timing,diagnostics={},gpu=[]){
    if(this.#count>=this.limit)return false;
    for(const [key,value] of Object.entries(timing))if(Number.isFinite(value)&&value>=0&&key!=="frame_interval_ms")this.#sum[key]=(this.#sum[key]??0)+value;
    if(Number.isFinite(timing.frame_interval_ms)&&timing.frame_interval_ms>0)this.#intervals.push(timing.frame_interval_ms);
    for(const value of gpu)if(Number.isFinite(value)&&value>=0&&this.#gpu.length<this.limit)this.#gpu.push(value);
    this.#terrainUploads+=diagnostics.terrain_uploads??0;this.#spriteUploads+=diagnostics.sprite_uploads??0;this.#cacheHits+=Number(diagnostics.terrain_cache_hit===true);this.#count++;return true;
  }
  summary(){
    const a=[...this.#intervals].sort((a,b)=>a-b),g=[...this.#gpu].sort((a,b)=>a-b),mean=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:0,ms=mean(a);
    return {...Object.fromEntries(Object.entries(this.#sum).map(([k,v])=>[k,round(v/this.#count)])),samples:this.#count,interval_samples:a.length,frame_interval_ms:round(ms),fps:ms?round(1000/ms):0,interval_p50_ms:round(percentile(a,.5)),interval_p95_ms:round(percentile(a,.95)),interval_max_ms:round(a.at(-1)??0),intervals_over_33ms:a.filter(v=>v>1000/30).length,intervals_over_50ms:a.filter(v=>v>50).length,gpu_samples:g.length,gpu_ms:g.length?round(mean(g)):null,gpu_p95_ms:g.length?round(percentile(g,.95)):null,terrain_uploads_total:this.#terrainUploads,sprite_uploads_total:this.#spriteUploads,terrain_cache_hit_fraction:this.#count?this.#cacheHits/this.#count:0};
  }
}
