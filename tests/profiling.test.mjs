import test from "node:test";import assert from "node:assert/strict";
import {FrameSamples} from "../src/profiling.mjs";
test("actual frame intervals and optional GPU timing are aggregated separately",()=>{
 const p=new FrameSamples(4);
 p.add({frame_ms:5,frame_interval_ms:0},{terrain_uploads:1,terrain_cache_hit:false});
 p.add({frame_ms:10,frame_interval_ms:20},{sprite_uploads:2,terrain_cache_hit:true},[4]);
 p.add({frame_ms:15,frame_interval_ms:40},{terrain_cache_hit:true},[6]);
 p.add({frame_ms:20,frame_interval_ms:60},{terrain_cache_hit:true});
 assert.equal(p.add({frame_ms:999,frame_interval_ms:999}),false);
 const s=p.summary();assert.equal(s.samples,4);assert.equal(s.interval_samples,3);assert.equal(s.frame_ms,12.5);assert.equal(s.frame_interval_ms,40);assert.equal(s.fps,25);assert.equal(s.interval_p95_ms,60);assert.equal(s.intervals_over_33ms,2);assert.equal(s.intervals_over_50ms,1);assert.equal(s.gpu_samples,2);assert.equal(s.gpu_ms,5);assert.equal(s.terrain_uploads_total,1);assert.equal(s.sprite_uploads_total,2);assert.equal(s.terrain_cache_hit_fraction,.75);
});
test("unavailable GPU timing is null and invalid samples are ignored",()=>{
 const p=new FrameSamples();assert.equal(p.summary().gpu_ms,null);assert.equal(p.summary().fps,0);
 p.add({frame_interval_ms:NaN},{},[NaN,-1]);assert.equal(p.summary().interval_samples,0);assert.equal(p.summary().gpu_samples,0);
 assert.throws(()=>new FrameSamples(5000),/sample limit/);
});