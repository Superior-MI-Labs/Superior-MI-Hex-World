import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {woodlandPreviewStyle,resolveStyleProfile} from "../src/art-style.mjs";
const fixture=JSON.parse(readFileSync(new URL("../examples/meadow-style.json",import.meta.url)));
const base="https://example.org/hex/examples/meadow-style.json";
const grass="smi.world.fantasy.recovered.grass-20261125.",foliage="smi.world.fantasy.recovered.foliage-20261125.",trees="smi.world.fantasy.recovered.trees-20261125.",fern="smi.world.fantasy.woodland.seasonal-fern-20261125a.";
const ids=[...["green","golden-dry"].flatMap(k=>[1,2,3].map(i=>grass+k+"-grass-0"+i)),foliage+"natural-round-bush",trees+"painted-broadleaf-tree",...["spring","summer","autumn","winter"].map(k=>fern+k)];
const entries=ids.map(id=>({id,license:"CC0-1.0",binding:{asset:id,manifest:"https://example.org/atlas/demo/preview.zip",archive_sha256:"a".repeat(64)}}));
test("woodland recipe pins assets and retains fixture terrain",()=>{
 const previous=structuredClone(fixture),s=woodlandPreviewStyle(fixture,entries,base);
 assert.deepEqual(fixture,previous);assert.equal(s.id,"published-woodland-preview");
 assert.equal(s.detail.top.manifest,"https://example.org/hex/examples/meadow-art/manifest.json");
 assert.equal(s.vegetation.assets["meadow-01"].archive_sha256,"a".repeat(64));
 assert.equal(s.vegetation.families[0].variants[1].seasonal.winter.asset,fern+"winter");
 assert.deepEqual(resolveStyleProfile(s,base).vegetation.assets,s.vegetation.assets);
});
test("missing, unpinned and wrong-license assets fail closed",()=>{
 assert.throws(()=>woodlandPreviewStyle(fixture,entries.slice(1),base),/Missing approved woodland asset/);
 assert.throws(()=>woodlandPreviewStyle(fixture,[{...entries[0],license:"restricted"},...entries.slice(1)],base),/Missing approved woodland asset/);
 assert.throws(()=>woodlandPreviewStyle(fixture,[{...entries[0],binding:{...entries[0].binding,archive_sha256:undefined}},...entries.slice(1)],base),/Missing approved woodland asset/);
});
