import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {validateStyle,vegetationSamples} from "../src/art-style.mjs";
import {validateSpritePack} from "../src/assets.mjs";
import {visibleTriangle} from "../src/camera.mjs";
const profile=validateStyle(JSON.parse(readFileSync(new URL("../examples/meadow-style.json",import.meta.url))));
const pack=JSON.parse(readFileSync(new URL("../examples/meadow-art/manifest.json",import.meta.url)));
test("art style references real static Atlas regions",()=>{for(const id of [profile.detail.top,profile.detail.side,...Object.values(profile.vegetation.assets)])assert.equal(validateSpritePack(pack,id).get(id).kind,"region");});
test("art style rejects broken visual parameters",()=>{assert.throws(()=>validateStyle({...profile,lighting:{ambient:.5,direction:[0,0,0]}}));assert.throws(()=>validateStyle({...profile,vegetation:{...profile.vegetation,samples_per_triangle:100}}));});
test("stable vegetation samples conform to slope and LOD retains a subset",()=>{
  const f={kind:"top",triangle:2,address:[-4,3,0],points:[[0,0,0],[5,0,5],[0,5,5]],vegetation:1,variant:"meadow-01"};
  const full=vegetationSamples(f,"w",profile,24),mid=vegetationSamples(f,"w",profile,12);
  assert.equal(full.length,3);assert.deepEqual(full,vegetationSamples(f,"w",profile,24));assert.deepEqual(mid,full.slice(0,mid.length));assert.equal(vegetationSamples(f,"w",profile,8).length,0);
  for(const {point:[x,y,z]} of full){assert.ok(x>=0&&y>=0&&x+y<=5+1e-9);assert.ok(Math.abs(z-x-y)<1e-9);}
});
test("conservative viewport culling keeps crossing triangles and padded sprites",()=>{const view=([x,y])=>({x,y});const f={points:[[-10,50],[110,50],[50,-10]]};assert.equal(visibleTriangle(f,view,100,100),true);const g={points:[[105,5],[110,5],[108,10]]};assert.equal(visibleTriangle(g,view,100,100),false);assert.equal(visibleTriangle(g,view,100,100,10),true);});
