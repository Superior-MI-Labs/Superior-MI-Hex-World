import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {create}=require("../vendor/atlas/asset-renderer.js");
const renderer=create({});
test("upstream fractional default frame periods loop exactly at the intended boundary",()=>{
  for(const fps of [12,24,30,60]){
    const a={id:"loop",frames:Array.from({length:fps},(_,i)=>({asset:String(i)})),default_fps:fps,playback:"loop"};
    assert.equal(renderer.frameAt(a,1000/fps).asset,"1");
    assert.equal(renderer.frameAt(a,999.999).asset,String(fps-1));
    assert.equal(renderer.frameAt(a,1000).asset,"0");
    assert.equal(renderer.frameAt({...a,playback:"pingpong"},1000).asset,String(fps-1));
    assert.equal(renderer.frameAt({...a,playback:"pingpong"},2000).asset,"0");
  }
  const mixed={id:"mixed",default_fps:12,playback:"loop",frames:[{asset:"hold",duration_ms:250},...Array.from({length:9},(_,i)=>({asset:String(i)}))]};
  assert.equal(renderer.frameAt(mixed,250).asset,"0");
  assert.equal(renderer.frameAt(mixed,1000).asset,"hold");
});
