import test from "node:test";import assert from "node:assert/strict";import {viewportSize,project,unprojectPlane} from "../src/camera.mjs";
test("viewport follows aspect ratio and bounds render resolution",()=>{
 assert.deepEqual(viewportSize(820,760),{width:820,height:760});
 const large=viewportSize(3840,2160);assert.ok(large.width<=1600&&large.height<=1000&&large.width*large.height<=1200000);assert.ok(Math.abs(large.width/large.height-3840/2160)<.005);
 assert.equal(viewportSize(0,100),null);assert.equal(viewportSize(NaN,100),null);
});
test("resizing preserves the world point at the center and picking inverse",()=>{
 const a={...viewportSize(900,450),scale:24,panX:70,panY:50,yaw:2,alignment_deg:30},b={...a,...viewportSize(1200,800)};
 const p=unprojectPlane(a.width/2,a.height/2,5,a),q=project(p,b);assert.ok(Math.abs(q.x-b.width/2)<1e-8&&Math.abs(q.y-b.height/2)<1e-8);
});