import test from "node:test";
import assert from "node:assert/strict";
import {resolveCatalog,searchCatalog,catalogBrowseOptions} from "../src/catalog.mjs";
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

test("Atlas projected taxonomy combines exact category, perspective, medium and family filters without requiring taxonomy metadata",()=>{
 const tree={id:"tree",pack:"p",domain:"world-environment",category_path:["world","world.vegetation","world.vegetation.trees"],perspective:["isometric"],theme:["fantasy"],medium:["raster-2d"],family:"painterly-fantasy"};
 const assets=[...Array.from({length:205},(_,i)=>({id:"old-"+i,pack:"p"})),tree,{...tree,id:"top-down-tree",perspective:["top-down"]},{...tree,id:"hidden-tree",discovery:"hidden"}];
 const entries=resolveCatalog({...index,assets},url);
 assert.deepEqual(catalogBrowseOptions(entries).perspective,["isometric","top-down"]);
 const results=searchCatalog(entries,"painterly","",false,"world-environment",{category_path:"world.vegetation",perspective:"isometric",theme:"fantasy",medium:"raster-2d",family:"painterly-fantasy"});
 assert.deepEqual(results.map(e=>e.id),["tree"]);
 assert.equal(searchCatalog(entries,"old-0").length,1);
 assert.equal(searchCatalog(entries,"","",false,"",{category_path:"world.props"}).length,0);
 assert.deepEqual(catalogBrowseOptions(resolveCatalog(index,url)).category_path,[]);
});

test("safe Atlas preview paths and authored metadata are projected without changing bindings",()=>{
 const digest="c".repeat(64),assets=[{id:"pine",pack:"p",name:"Conifer",tags:["evergreen"],subjects:["woodland"],aliases:["pine tree"],style:"fantasy",thumbnail:"previews/"+digest+".png"},{id:"external",pack:"p",thumbnail:"https://other.test/track.png"},{id:"escape",pack:"p",thumbnail:"../previews/"+digest+".png"}];
 const entries=resolveCatalog({...index,assets},url);assert.equal(entries[0].thumbnail,"https://example.org/atlas/previews/"+digest+".png");assert.equal(entries[1].thumbnail,null);assert.equal(entries[2].thumbnail,null);assert.equal(searchCatalog(entries,"fantasy evergreen pine").length,1);assert.equal(entries[0].binding.archive_sha256,"a".repeat(64));
});
