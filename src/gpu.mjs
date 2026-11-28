// WebGL2 depth-tested triangles; all positions originate in the terrain mesh.
import {terrainTexturePlan} from "./art-style.mjs";
import {spriteShade,MAX_POINT_LIGHTS,POINT_SHADOW_WIDTH,POINT_SHADOW_HEIGHT,POINT_SHADOW_LIMIT} from "./lighting.mjs";
const VS=`#version 300 es
in vec3 a_position; in vec3 a_color; in vec2 a_uv; in vec3 a_cover; in float a_rim; in vec2 a_mask_uv; in vec4 a_weights; in float a_shade; in vec3 a_world;
out vec3 v_color; out vec2 v_uv; out vec3 v_cover; out float v_rim; out vec2 v_mask_uv; out vec4 v_weights; out float v_shade; out vec3 v_world;
void main(){gl_Position=vec4(a_position,1.0);v_color=a_color;v_uv=a_uv;v_cover=a_cover;v_rim=a_rim;v_mask_uv=a_mask_uv;v_weights=a_weights;v_shade=a_shade;v_world=a_world;}`;
const FS=`#version 300 es
precision highp float;
in vec3 v_color; in vec2 v_uv; in vec3 v_cover; in float v_rim; in vec2 v_mask_uv; in vec4 v_weights; in float v_shade; in vec3 v_world; uniform float u_water_time; uniform int u_light_count; uniform vec4 u_light_pos[${MAX_POINT_LIGHTS}]; uniform vec4 u_light_rgb[${MAX_POINT_LIGHTS}]; uniform int u_light_shadow[${MAX_POINT_LIGHTS}]; uniform sampler2D u_point_shadow; uniform sampler2D u_texture; uniform sampler2D u_layer1; uniform sampler2D u_layer2; uniform sampler2D u_layer3; uniform sampler2D u_mask; uniform sampler2D u_emissive_mask; uniform int u_mode; uniform float u_detail_strength; uniform ivec4 u_color_modes; uniform bool u_mask_enabled; uniform bool u_debug; uniform float u_mask_scale; uniform float u_softness; uniform float u_bleed; uniform vec3 u_leaf_color; uniform vec3 u_snow_color; uniform vec3 u_scorch_color; out vec4 color;
float hash(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
float noise2(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
float coverage(float amount,float noise){
  if(amount<=0.0)return 0.0;if(amount>=1.0)return 1.0;
  float width=max(.0001,min(u_softness,min(amount,1.0-amount)));
  return smoothstep(1.0-amount-width,1.0-amount+width,noise);
}
vec3 materialColor(vec3 tex,int mode){
  if(mode==2)return mix(v_color,tex,u_detail_strength);
  vec3 detail=mode==1?tex:vec3(tex.r);
  return v_color*mix(vec3(1.0),detail,u_detail_strength);
}
float pointVisibility(int index,vec3 delta,float distance,float radius){
  int slot=u_light_shadow[index]-1;if(slot<0||distance<.0001)return 1.0;
  vec3 direction=delta/distance;
  float azimuth=length(direction.xy)<.0001?0.0:atan(direction.y,direction.x);
  float elevation=asin(clamp(direction.z,-1.0,1.0));
  vec2 cell=vec2((azimuth/6.28318530718+.5)*float(${POINT_SHADOW_WIDTH}), (elevation/3.14159265359+.5)*float(${POINT_SHADOW_HEIGHT}))-.5;
  ivec2 base=ivec2(floor(cell));vec2 blend=fract(cell);
  float result=0.0;
  // Blend four angular samples after comparing depths, not the distances.
  // The bias reduces self-shadowing from coarse directions and quantization.
  float bias=.35+distance*.12+radius/255.0;
  for(int y=0;y<2;y++)for(int x=0;x<2;x++){
    int sx=(base.x+x+${POINT_SHADOW_WIDTH})%${POINT_SHADOW_WIDTH};
    int sy=clamp(base.y+y,0,${POINT_SHADOW_HEIGHT}-1)+slot*${POINT_SHADOW_HEIGHT};
    float depth=texelFetch(u_point_shadow,ivec2(sx,sy),0).r*radius;
    float weight=(x==0?1.0-blend.x:blend.x)*(y==0?1.0-blend.y:blend.y);
    result+=weight*float(distance<=depth+bias);
  }
  return result;
}
vec3 localLight(){
  vec3 sum=vec3(0.0);
  for(int i=0;i<${MAX_POINT_LIGHTS};i++){
    if(i>=u_light_count)break;
    vec3 delta=v_world-u_light_pos[i].xyz;float distance=length(delta),radius=u_light_pos[i].w;
    float falloff=max(0.0,1.0-distance/radius);
    if(falloff>0.0)sum+=u_light_rgb[i].rgb*u_light_rgb[i].a*falloff*falloff*pointVisibility(i,delta,distance,radius);
  }
  return sum;
}
vec3 spriteLight(vec3 base){
  float emission=clamp(v_cover.x,0.0,1.0);
  if(v_cover.y>0.5){vec4 mask=texture(u_emissive_mask,v_uv);emission*=mask.r*mask.a;}
  return base*(mix(v_color,vec3(1.0),emission)+localLight());
}
void main(){
  vec4 t=texture(u_texture,v_uv);
  if(u_mode==2){if(t.a<0.5)discard;color=vec4(spriteLight(t.rgb),1.0);}
  else if(u_mode==3){if(t.a<0.98)discard;color=vec4(spriteLight(t.rgb),1.0);}
  else if(u_mode==4){if(t.a<=0.02||t.a>=0.98)discard;color=vec4(spriteLight(t.rgb),t.a);}
  else if(u_mode==8){if(t.a<=0.02)discard;color=vec4(mix(t.rgb,v_color,.22),t.a*v_cover.z);}
  else if(u_mode==6){
    float depth=max(0.0,v_cover.z);
    vec2 p=v_world.xy-v_cover.xy*u_water_time;
    float ripple=0.5+0.5*sin(p.x*2.2+p.y*1.7+u_water_time*1.8)*sin(p.y*2.8-p.x*.9-u_water_time*1.3);
    float deep=1.0-exp(-depth*.5);
    vec3 base=mix(vec3(.25,.66,.63),vec3(.035,.23,.42),deep);
    base+=vec3(.12,.20,.23)*pow(ripple,6.0);
    if(v_rim<0.0)base=mix(base,vec3(.78,.93,.91),(1.0-smoothstep(.02,.28,depth))*.48*pow(ripple,2.0));
    else base=mix(base,vec3(.55,.84,.88),.15+.15*ripple);
    color=vec4(base*(vec3(v_shade)+localLight()),mix(.34,.86,deep));
  }
  else if(u_mode==7){color=vec4(.13,.88,1.0,.58*pow(1.0-v_uv.y,1.5));}
  else if(u_mode==5){if(any(lessThan(v_uv,vec2(0.0)))||any(greaterThan(v_uv,vec2(1.0))))discard;color=vec4(0.0,0.0,0.0,t.a*v_color.r);}
  else {
    vec3 base=v_color;
    if(u_mode==1){
      base=materialColor(t.rgb,u_color_modes.x)*v_weights.x;
      base+=materialColor(texture(u_layer1,v_uv).rgb,u_color_modes.y)*v_weights.y;
      base+=materialColor(texture(u_layer2,v_uv).rgb,u_color_modes.z)*v_weights.z;
      base+=materialColor(texture(u_layer3,v_uv).rgb,u_color_modes.w)*v_weights.w;
    }
    float noise=noise2(v_mask_uv*u_mask_scale);
    if(u_mask_enabled)noise=mix(noise,texture(u_mask,v_mask_uv).r,.65);
    float rim=v_rim<0.0?1.0:(u_bleed<=0.0?0.0:1.0-smoothstep(0.0,u_bleed,v_rim));
    vec3 cover=clamp(v_cover*rim,0.0,1.0);
    if(u_debug){color=vec4(cover,1.0);return;}
    float leaf=coverage(cover.x,noise),snow=coverage(cover.y,noise2(v_mask_uv*u_mask_scale+vec2(19.3,7.7))*.35+noise*.65);
    if(v_rim>=0.0)base=mix(base,u_scorch_color,cover.z*.85);
    base=mix(base,u_leaf_color,leaf*.85);
    base=mix(base,u_snow_color,snow);
    color=vec4(base*(vec3(v_shade)+localLight()),1.0);
  }
}`;
function shader(gl,type,src){const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;}
export function createRenderer(canvas){
  const gl=canvas.getContext("webgl2",{alpha:false,antialias:true});
  if(!gl)throw Error("WebGL2 unavailable; GPU laboratory cannot start");
  const program=gl.createProgram(),vs=shader(gl,gl.VERTEX_SHADER,VS),fs=shader(gl,gl.FRAGMENT_SHADER,FS);
  gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);
  if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
  gl.deleteShader(vs);gl.deleteShader(fs);gl.useProgram(program);
  function geometryBuffer(){const vao=gl.createVertexArray(),buffer=gl.createBuffer();gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
  for(const [name,size,offset] of [["a_position",3,0],["a_color",3,12],["a_uv",2,24],["a_cover",3,32],["a_rim",1,44],["a_mask_uv",2,48],["a_weights",4,56],["a_shade",1,72],["a_world",3,76]]){
    const loc=gl.getAttribLocation(program,name);gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,size,gl.FLOAT,false,88,offset);
  }
  return {vao,buffer};}
  const {vao,buffer}=geometryBuffer();let terrainCache=null,projectionCache=null,terrainUploads=0,terrainCacheHit=false,drawCalls=0,terrainBytes=0;
  // Optional nonblocking GPU timing, enabled only for explicit captures.
  const timer=gl.getExtension("EXT_disjoint_timer_query_webgl2");
  let timingEnabled=false,timingPending=[],timingSamples=[],timingDiscarded=0;
  function setTimingEnabled(enabled){
    enabled=!!enabled;if(enabled===timingEnabled)return;timingEnabled=enabled;
    for(const q of timingPending)gl.deleteQuery(q);timingPending=[];timingSamples=[];timingDiscarded=0;
  }
  function beginTiming(){
    timingSamples=[];if(!timer||!timingEnabled)return null;
    if(gl.getParameter(timer.GPU_DISJOINT_EXT)){timingDiscarded+=timingPending.length;for(const q of timingPending)gl.deleteQuery(q);timingPending=[];return null;}
    while(timingPending.length&&gl.getQueryParameter(timingPending[0],gl.QUERY_RESULT_AVAILABLE)){
      const q=timingPending.shift(),ns=gl.getQueryParameter(q,gl.QUERY_RESULT);gl.deleteQuery(q);
      if(Number.isFinite(ns)&&ns>=0)timingSamples.push(ns/1e6);
    }
    if(timingPending.length>=4)return null;
    const q=gl.createQuery();if(!q)return null;gl.beginQuery(timer.TIME_ELAPSED_EXT,q);return q;
  }
  function endTiming(q){if(q){gl.endQuery(timer.TIME_ELAPSED_EXT);timingPending.push(q);}}
  function releaseTerrain(){if(terrainCache)for(const b of terrainCache.batches.values())if(b.gpu){gl.deleteVertexArray(b.gpu.vao);gl.deleteBuffer(b.gpu.buffer);}terrainCache=null;terrainBytes=0;}
  const waterTime=gl.getUniformLocation(program,"u_water_time");
  const mode=gl.getUniformLocation(program,"u_mode"),lightCount=gl.getUniformLocation(program,"u_light_count"),lightPos=gl.getUniformLocation(program,"u_light_pos[0]"),lightRGB=gl.getUniformLocation(program,"u_light_rgb[0]"),lightShadow=gl.getUniformLocation(program,"u_light_shadow[0]");
  const uniforms=Object.fromEntries(["u_detail_strength","u_color_modes","u_mask_enabled","u_debug","u_mask_scale","u_softness","u_bleed","u_leaf_color","u_snow_color","u_scorch_color"].map(k=>[k,gl.getUniformLocation(program,k)]));
  gl.uniform1i(gl.getUniformLocation(program,"u_texture"),0);gl.uniform1i(gl.getUniformLocation(program,"u_mask"),1);gl.uniform1i(gl.getUniformLocation(program,"u_emissive_mask"),5);gl.uniform1i(gl.getUniformLocation(program,"u_point_shadow"),6);
  const units=[0,2,3,4];for(let i=1;i<4;i++)gl.uniform1i(gl.getUniformLocation(program,"u_layer"+i),units[i]);
  function texture(){const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);return t;}
  const ground=texture(),pixels=new Uint8Array(64*64*4);
  // Periodic procedural swatch, not final Atlas artwork.
  for(let y=0;y<64;y++)for(let x=0;x<64;x++){
    const a=x*Math.PI/32,b=y*Math.PI/32,v=Math.round(195+28*Math.sin(3*a+2*b)+20*Math.cos(5*a-4*b)+10*Math.sin(11*a+7*b)),i=(y*64+x)*4;
    pixels.set([v,v,v,255],i);
  }
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,64,64,0,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.REPEAT);
  for(let i=1;i<4;i++){gl.activeTexture(gl.TEXTURE0+units[i]);gl.bindTexture(gl.TEXTURE_2D,ground);}
  gl.activeTexture(gl.TEXTURE5);gl.bindTexture(gl.TEXTURE_2D,ground);gl.activeTexture(gl.TEXTURE0);
  gl.activeTexture(gl.TEXTURE6);const pointShadowTexture=texture();let lastShadowData=null;
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.R8,POINT_SHADOW_WIDTH,POINT_SHADOW_HEIGHT*POINT_SHADOW_LIMIT,0,gl.RED,gl.UNSIGNED_BYTE,new Uint8Array(POINT_SHADOW_WIDTH*POINT_SHADOW_HEIGHT*POINT_SHADOW_LIMIT).fill(255));
  gl.activeTexture(gl.TEXTURE0);
  const mask=texture();let maskEnabled=false;
  gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,mask);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([128,128,128,255]));
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.REPEAT);gl.activeTexture(gl.TEXTURE0);
  function setTransitionMask(image){
    gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,mask);
    try{if(image){gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);maskEnabled=true;}else maskEnabled=false;}
    finally{gl.activeTexture(gl.TEXTURE0);}
  }
  let detailTextures=new Map();
  const detailKey=(kind,material)=>JSON.stringify([kind,material]);
  function uploadDetail(image){
    const tex=texture();gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.REPEAT);
    gl.generateMipmap(gl.TEXTURE_2D);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);
    return tex;
  }
  function setTerrainDetail(kind,image,material=null){
    if(!["top","side"].includes(kind))throw Error("Invalid detail role");
    const key=detailKey(kind,material),next=image?uploadDetail(image):null;
    const old=detailTextures.get(key);detailTextures.delete(key);if(old&&![...detailTextures.values()].includes(old))gl.deleteTexture(old);
    if(next)detailTextures.set(key,next);
  }
  function setTerrainStyle(art){
    const next=new Map(),shared=new Map();
    function add(role,material,r){if(!shared.has(r.image))shared.set(r.image,uploadDetail(r.image));next.set(detailKey(role,material),shared.get(r.image));}
    try{add("top",null,art.top);add("side",null,art.side);for(const [material,rasters] of art.materialRasters)for(const [role,r] of Object.entries(rasters))add(role,material,r);}
    catch(e){for(const tex of shared.values())gl.deleteTexture(tex);throw e;}
    for(const tex of new Set(detailTextures.values()))gl.deleteTexture(tex);detailTextures=next;
  }
  const shadowTexture=texture(),shadowPixels=new Uint8Array(64*64*4);
  for(let y=0;y<64;y++)for(let x=0;x<64;x++){const d=Math.hypot((x+.5)/32-1,(y+.5)/32-1),a=Math.max(0,1-d*d);shadowPixels[(y*64+x)*4+3]=Math.round(255*a*a);}
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,64,64,0,gl.RGBA,gl.UNSIGNED_BYTE,shadowPixels);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  const spriteTextures=new Map();let spriteUploads=0,spriteFrame=0,spriteBytes=0,activeSpriteTextures=0,spriteEvictions=0;
  const spriteTextureBudget=64*1024*1024,spriteTextureCount=128;
  function spriteTexture(actor){
    let record=spriteTextures.get(actor.image);
    if(!record){const tex=texture();gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);record={tex,revision:-1,bytes:0,lastUsed:0};spriteTextures.set(actor.image,record);}
    if(record.revision!==actor.revision){gl.bindTexture(gl.TEXTURE_2D,record.tex);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,actor.image);spriteBytes-=record.bytes;record.bytes=actor.image.width*actor.image.height*4;spriteBytes+=record.bytes;spriteUploads++;record.revision=actor.revision;}
    record.lastUsed=spriteFrame;return record.tex;
  }
  function draw(data,tex,m){if(!data.length)return;drawCalls++;gl.bindTexture(gl.TEXTURE_2D,tex);gl.uniform1i(mode,m);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(data),gl.DYNAMIC_DRAW);gl.drawArrays(gl.TRIANGLES,0,data.length/22);}
  function drawTerrain(batch,tex,m,persistent){
    if(!batch.gpu&&!persistent){if(batch.data.length){terrainUploads++;draw(batch.data,tex,m);}return;}
    if(!batch.gpu){
      if(!batch.data.length)return;
      const data=new Float32Array(batch.data);batch.count=data.length/22;batch.gpu=geometryBuffer();
      gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW);terrainUploads++;terrainBytes+=data.byteLength;batch.data=null;
    }
    drawCalls++;gl.bindVertexArray(batch.gpu.vao);gl.bindTexture(gl.TEXTURE_2D,tex);gl.uniform1i(mode,m);gl.drawArrays(gl.TRIANGLES,0,batch.count);
    gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
  }
  function render(faces,view,{projectionKey=null,cacheStaticTerrain=true,selected=null,pattern=true,sprites=[],previews=[],sprite:actor=null,transitions={},debug=false,style=null,lighting=style?.lighting??null,pointLights=[],pointShadow=null,softSprites=false,shadows=[],water=[],selectionWalls=[],visualTime=0}={}){
    const query=beginTiming();
    // Keep the auxiliary sampler complete even when a previous masked sprite was evicted.
    gl.activeTexture(gl.TEXTURE5);gl.bindTexture(gl.TEXTURE_2D,ground);gl.activeTexture(gl.TEXTURE0);
    gl.viewport(0,0,canvas.width,canvas.height);gl.clearColor(.105,.16,.20,1);gl.clearDepth(1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    gl.uniform1f(waterTime,visualTime);
    const lights=pointLights.slice(0,MAX_POINT_LIGHTS);
    if(pointShadow&&pointShadow.data!==lastShadowData){
      gl.activeTexture(gl.TEXTURE6);gl.bindTexture(gl.TEXTURE_2D,pointShadowTexture);
      gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,POINT_SHADOW_WIDTH,POINT_SHADOW_HEIGHT*POINT_SHADOW_LIMIT,gl.RED,gl.UNSIGNED_BYTE,pointShadow.data);
      gl.activeTexture(gl.TEXTURE0);lastShadowData=pointShadow.data;
    }
    if(lights.length)gl.uniform1iv(lightShadow,new Int32Array(lights.map(l=>pointShadow?(pointShadow.ids.indexOf(l.id)+1):0)));
    gl.uniform1i(lightCount,lights.length);if(lights.length){gl.uniform4fv(lightPos,lights.flatMap(l=>[...l.point,l.radius]));gl.uniform4fv(lightRGB,lights.flatMap(l=>[...l.color,l.intensity]));}
    gl.uniform1f(uniforms.u_detail_strength,style?.detail.strength??.25);
    gl.uniform4iv(uniforms.u_color_modes,[0,0,0,0]);
    gl.uniform1i(uniforms.u_mask_enabled,maskEnabled?1:0);gl.uniform1i(uniforms.u_debug,debug?1:0);
    gl.uniform1f(uniforms.u_mask_scale,transitions.mask_scale??8);gl.uniform1f(uniforms.u_softness,transitions.mask_softness??.13);gl.uniform1f(uniforms.u_bleed,transitions.cliff_bleed_ft??1.25);
    gl.uniform3fv(uniforms.u_leaf_color,transitions.leaf_color??[.65,.34,.12]);gl.uniform3fv(uniforms.u_snow_color,transitions.snow_color??[.91,.94,.97]);gl.uniform3fv(uniforms.u_scorch_color,transitions.scorch_color??[.15,.13,.11]);
    gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.depthMask(true);gl.disable(gl.BLEND);
    terrainUploads=0;terrainCacheHit=false;drawCalls=0;spriteUploads=0;spriteEvictions=0;spriteFrame++;
    const reusable=projectionKey!==null&&projectionCache?.key===projectionKey&&projectionCache.faces===faces;
    if(!reusable){const projected=faces.map(f=>({f,p:f.points.map(view)}));let low=Infinity,high=-Infinity;for(const f of projected)for(const p of f.p){low=Math.min(low,p.depth);high=Math.max(high,p.depth);}projectionCache={key:projectionKey,faces,projected,low,high};}
    const projected=projectionCache.projected,actors=[...sprites,...(actor?[actor]:[])].map(a=>({actor:a,quad:a.points.map(view)})),ghosts=debug?[]:previews.map(a=>({actor:a,quad:a.points.map(view)}));
    const waterProjected=water.map(f=>({f,p:f.points.map(view)})),walls=selectionWalls.map(f=>({f,p:f.points.map(view)}));
    let {low,high}=projectionCache;
    for(const items of [actors,ghosts])for(const a of items)for(const p of a.quad){low=Math.min(low,p.depth);high=Math.max(high,p.depth);}
    for(const items of [waterProjected,walls])for(const {p:points} of items)for(const p of points){low=Math.min(low,p.depth);high=Math.max(high,p.depth);}
    if(!Number.isFinite(low)){low=0;high=1;}
    // Stable padded bounds avoid repacking terrain for small sprite motion.
    if(projectionKey!==null){low=Math.floor(low/5)*5;high=Math.ceil(high/5)*5;}
    const range=Math.max(1,high-low),center=(low+high)/2;
    const pack=(out,p,color,uv,cover=[0,0,0],rim=-1,maskUV=uv,weights=[1,0,0,0],shade=1,world=[0,0,0])=>out.push(2*p.x/canvas.width-1,1-2*p.y/canvas.height,-(p.depth-center)*1.8/range,...color,...uv,...cover,rim,...maskUV,...weights,shade,...world);
    const terrainKey=JSON.stringify([projectionKey,low,high,selected,lighting,canvas.width,canvas.height]);
    const cacheHit=projectionKey!==null&&terrainCache?.faces===faces&&terrainCache.style===style&&terrainCache.key===terrainKey;
    terrainCacheHit=cacheHit;
    if(!cacheHit){releaseTerrain();terrainCache={key:terrainKey,faces,style,batches:new Map()};}
    const batchesTerrain=terrainCache.batches,repeat=style?.detail.repeat_ft??5;
    const light=lighting,lightLength=light?Math.hypot(...light.direction):1,spriteTint=Array(3).fill(spriteShade(light));
    if(!cacheHit)for(const {f,p} of projected){
      const active=selected&&f.address?.every((v,i)=>v===selected[i]),color=f.color??(f.kind==="top"?(active?[.68,.77,.43]:[.45,.61,.35]):f.kind==="bottom"?[.34,.27,.22]:[.57,.42,.30]);
      const plan=terrainTexturePlan(f,style),key=JSON.stringify([plan.role,plan.keys]);
      if(!batchesTerrain.has(key))batchesTerrain.set(key,{...plan,data:[]});const data=batchesTerrain.get(key).data;
      let shade=1;
      if(light){
        const [a,b,c]=f.points,u=b.map((x,i)=>x-a[i]),v=c.map((x,i)=>x-a[i]),n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],len=Math.hypot(...n);
        if(len>0)shade=light.ambient+(1-light.ambient)*Math.max(0,n.reduce((sum,x,i)=>sum+x*light.direction[i],0)/(len*lightLength));
      }
      const angle=(150+(f.edge??0)*60)*Math.PI/180;
      for(let i=0;i<3;i++){const [x,y,z]=f.points[i],a=f.attributes?.[i],uv=f.kind==="side"?[(x*Math.cos(angle)+y*Math.sin(angle))/repeat,z/repeat]:[x/repeat,y/repeat];pack(data,p[i],a?.color??color,uv,a?.cover??f.cover,a?.rim??-1,[(x+Math.max(0,a?.rim??0)*.35)/5,(y+Math.max(0,a?.rim??0)*.5)/5],plan.weights[i],shade*(1-(light?.occlusion??0)*(f.occlusion?.[i]??0)),f.points[i]);}
    }
    for(let i=1;i<4;i++){gl.activeTexture(gl.TEXTURE0+units[i]);gl.bindTexture(gl.TEXTURE_2D,ground);}gl.activeTexture(gl.TEXTURE0);
    for(const batch of batchesTerrain.values()){
      const {role,keys,modes}=batch;
      const textures=keys.map(k=>style?(detailTextures.get(detailKey(role,k))??detailTextures.get(detailKey(role,null))??ground):ground);
      for(let i=1;i<4;i++){gl.activeTexture(gl.TEXTURE0+units[i]);gl.bindTexture(gl.TEXTURE_2D,textures[i]??ground);}
      gl.activeTexture(gl.TEXTURE0);gl.uniform4iv(uniforms.u_color_modes,Array.from({length:4},(_,i)=>modes[i]==="albedo"?2:modes[i]==="rgb_detail"?1:0));
      drawTerrain(batch,textures[0]??ground,pattern?1:0,projectionKey!==null&&cacheStaticTerrain);
    }
    if(shadows.length&&!debug){const data=[];for(const f of shadows){const p=f.points.map(view);for(let i=0;i<3;i++)pack(data,p[i],[f.opacity,0,0],f.uv[i]);}gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.depthMask(false);draw(data,shadowTexture,5);gl.depthMask(true);gl.disable(gl.BLEND);}
    const batches=new Map(),cutouts=new Map(),used=new Set(),uv=[[0,0],[1,0],[1,1],[0,1]];
    const texturePairs=new Map(),frameTextures=new Map();
    function frameTexture(actor){
      used.add(actor.image);const cached=frameTextures.get(actor.image);
      if(cached&&cached.revision===actor.revision)return cached.tex;
      const tex=spriteTexture(actor);frameTextures.set(actor.image,{tex,revision:actor.revision});return tex;
    }
    function spritePair(actor){
      const tex=frameTexture(actor);
      let mask=null;if(actor.emissiveMask)mask=frameTexture({image:actor.emissiveMask,revision:0});
      if(!texturePairs.has(tex))texturePairs.set(tex,new Map());const pairs=texturePairs.get(tex);
      if(!pairs.has(mask))pairs.set(mask,{tex,mask});return pairs.get(mask);
    }
    function packSprite(batch,actor,quad){for(const i of [0,1,2,0,2,3])pack(batch,quad[i],actor.previewColor??spriteTint,uv[i],[actor.emissive??0,actor.emissiveMask?1:0,actor.previewOpacity??0],undefined,undefined,undefined,1,actor.points[i]);}
    function drawSprite(batch,pair,m){
      gl.activeTexture(gl.TEXTURE5);gl.bindTexture(gl.TEXTURE_2D,pair.mask??ground);gl.activeTexture(gl.TEXTURE0);
      draw(batch,pair.tex,m);
    }
    for(const entry of actors){const {actor,quad}=entry,pair=entry.pair=spritePair(actor),target=softSprites&&!actor.hardAlpha?batches:cutouts,batch=target.get(pair)??[];packSprite(batch,actor,quad);target.set(pair,batch);}
    for(const [pair,batch] of cutouts)drawSprite(batch,pair,2);
    for(const [pair,batch] of batches)drawSprite(batch,pair,3);
    if(softSprites&&batches.size){
      // Opaque sprite cores write depth. Translucent fringes retain terrain
      // depth testing and blend back-to-front, without writing depth.
      gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.depthMask(false);
      const ordered=actors.filter(a=>!a.actor.hardAlpha).map(a=>({...a,depth:a.quad.reduce((s,p)=>s+p.depth,0)})).sort((a,b)=>a.depth-b.depth);
      let current=null,batch=[];
      for(const {actor,quad,pair} of ordered){
        if(current!==pair){if(current)drawSprite(batch,current,4);batch=[];current=pair;}
        packSprite(batch,actor,quad);
      }
      if(current)drawSprite(batch,current,4);gl.depthMask(true);gl.disable(gl.BLEND);
    }
    if(waterProjected.length&&!debug){
      const data=[],shade=light?light.ambient+(1-light.ambient)*Math.max(0,light.direction[2]/lightLength):1;
      waterProjected.sort((a,b)=>a.p.reduce((s,p)=>s+p.depth,0)-b.p.reduce((s,p)=>s+p.depth,0));
      for(const {f,p} of waterProjected)for(let i=0;i<3;i++)pack(data,p[i],[1,1,1],[0,0],[...f.flow,f.depth[i]],f.kind==="water-side"?0:-1,undefined,undefined,shade,f.points[i]);
      gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.depthMask(false);draw(data,ground,6);gl.depthMask(true);gl.disable(gl.BLEND);
    }
    // Same qualified texture/vertex path, depth-tested without writing depth.
    if(ghosts.length){
      gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.depthMask(false);
      const ordered=ghosts.map(a=>({...a,depth:a.quad.reduce((s,p)=>s+p.depth,0)})).sort((a,b)=>a.depth-b.depth);
      let current=null,batch=[];for(const {actor,quad} of ordered){const pair=spritePair(actor);if(pair!==current){if(current)drawSprite(batch,current,8);current=pair;batch=[];}packSprite(batch,actor,quad);}
      if(current)drawSprite(batch,current,8);gl.depthMask(true);gl.disable(gl.BLEND);
    }
    if(walls.length){const data=[];for(const {f,p} of walls)for(let i=0;i<3;i++)pack(data,p[i],[1,1,1],[0,f.fade[i]]);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.depthMask(false);draw(data,ground,7);gl.depthMask(true);gl.disable(gl.BLEND);}
    activeSpriteTextures=used.size;
    // Retain recently used idle textures across pans/season changes, bounded
    // by count and estimated RGBA bytes. Active resources are never evicted.
    if(spriteBytes>spriteTextureBudget||spriteTextures.size>spriteTextureCount){
      const idle=[...spriteTextures].filter(([image])=>!used.has(image)).sort((a,b)=>a[1].lastUsed-b[1].lastUsed);
      for(const [image,record] of idle){
        if(spriteBytes<=spriteTextureBudget&&spriteTextures.size<=spriteTextureCount)break;
        gl.deleteTexture(record.tex);spriteTextures.delete(image);spriteBytes-=record.bytes;spriteEvictions++;
      }
    }
    endTiming(query);
  }
  return Object.freeze({render,setTransitionMask,setTerrainDetail,setTerrainStyle,setTimingEnabled,takeTimingSamples(){const result=timingSamples;timingSamples=[];return result;},diagnostics(){return {gpu_timer_supported:!!timer,gpu_timer_discarded:timingDiscarded,gpu_timer_pending:timingPending.length,terrain_buffer_bytes:terrainBytes,terrain_uploads:terrainUploads,terrain_cache_hit:terrainCacheHit,draw_calls:drawCalls,sprite_uploads:spriteUploads,sprite_evictions:spriteEvictions,sprite_textures:spriteTextures.size,active_sprite_textures:activeSpriteTextures,sprite_texture_bytes_estimate:spriteBytes};},readPixel(x,y){const p=new Uint8Array(4);gl.readPixels(x,canvas.height-1-y,1,1,gl.RGBA,gl.UNSIGNED_BYTE,p);return [...p];}});
}
