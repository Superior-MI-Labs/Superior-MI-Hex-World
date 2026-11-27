import test from "node:test";
import assert from "node:assert/strict";
import {resolveCatalog,searchCatalog} from "../src/catalog.mjs";
const url="https://example.org/atlas/public-catalog.json",index={schema:"smi-public-catalog/1",packs:[{id:"p",zip:"demo/p.zip",archive_sha256:"a".repeat(64)},{id:"old",zip:null}],assets:[{id:"chest",name:"Chest",pack:"p",kind:"composition",capabilities:["world-use"]},{id:"gem",pack:"p",discovery:"component",capabilities:["slot-component"]},{id:"legacy",pack:"old",legacy:true}]};
test("catalog only exposes pinned approved ZIP records, filters by affordance",()=>{const entries=resolveCatalog(index,url);assert.equal(entries.length,2);assert.equal(entries[0].binding.manifest,"https://example.org/atlas/demo/p.zip");assert.equal(entries[0].binding.archive_sha256,"a".repeat(64));assert.equal(searchCatalog(entries,"chest","world-use").length,1);assert.equal(searchCatalog(entries,"gem").length,0);assert.equal(searchCatalog(entries,"gem","slot-component",true).length,1);assert.throws(()=>resolveCatalog({...index,packs:[{...index.packs[0],zip:"../p.zip"}]},url));});

test("domain filter precedes cap and retains preview metadata",()=>{
  const assets=Array.from({length:205},(_,i)=>({id:"hud-"+i,pack:"p",domain:"gui"}));
  assets.push({id:"world-tree",pack:"p",domain:"world-environment",visual_qa:"pending"});
  const entries=resolveCatalog({...index,assets},url);
  assert.equal(searchCatalog(entries).length,200);
  const [tree]=searchCatalog(entries,"","",false,"world-environment");
  assert.equal(tree.id,"world-tree");assert.equal(tree.pack,"p");assert.equal(tree.visual_qa,"pending");
});
