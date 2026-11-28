import test from "node:test";import assert from "node:assert/strict";import {clampPanelSize} from "../src/panel-layout.mjs";
test("panel bounds preserve viewport and round CSS pixel sizes",()=>{assert.equal(clampPanelSize(100,240,480),240);assert.equal(clampPanelSize(900,240,480),480);assert.equal(clampPanelSize(319.7,240,480),320);assert.equal(clampPanelSize(300,240,200),240);});
