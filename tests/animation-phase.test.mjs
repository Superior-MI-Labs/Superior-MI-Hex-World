import test from "node:test";import assert from "node:assert/strict";
import {AnimationPhasePool,cyclicRegionPeriod} from "../src/assets.mjs";
const regions=new Map([["a",{kind:"region"}],["b",{kind:"region"}]]);
test("phase eligibility honors cyclic sequence duration and leaves one-shot/nested animation unchanged",()=>{
 const sequence={kind:"sequence",playback:"loop",default_fps:4,frames:[{asset:"a"},{asset:"b",duration_ms:150}]};
 assert.equal(cyclicRegionPeriod(sequence,regions),400);
 assert.equal(cyclicRegionPeriod({...sequence,playback:"pingpong"},regions),800);
 assert.equal(cyclicRegionPeriod({...sequence,playback:"once"},regions),0);
 assert.equal(cyclicRegionPeriod(sequence,new Map([["a",{kind:"composition"}],["b",{kind:"region"}]])),0);
});
test("four shared cohorts, byte/count limits, no allocation for static or exhausted budget",()=>{
 const pool=new AnimationPhasePool({maxEntries:2,maxBytes:128});
 let forks=0;const base={phasePeriod:400,pixelWidth:2,pixelHeight:2,fork(){return {id:++forks};}};
 assert.equal(pool.select(base,.1).raster,base);
 const a=pool.select(base,.3);assert.equal(a.offset,100);assert.equal(pool.select(base,.49),a);
 assert.equal(pool.select(base,.6).offset,200);assert.equal(pool.select(base,.9).raster,base);
 assert.deepEqual(pool.diagnostics(),{animation_phase_variants:2,animation_phase_canvas_bytes:64});
 pool.clear();assert.equal(pool.diagnostics().animation_phase_variants,0);
 assert.equal(pool.select(base,.9).offset,300);
 assert.equal(new AnimationPhasePool({maxBytes:1}).select(base,.9).raster,base);
});