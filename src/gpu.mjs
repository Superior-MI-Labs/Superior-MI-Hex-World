// WebGL2 depth-tested triangles; all positions originate in the terrain mesh.
const VS=`#version 300 es
in vec3 a_position; in vec3 a_color; in vec2 a_uv; in vec3 a_cover; in float a_rim; in vec2 a_mask_uv;
out vec3 v_color; out vec2 v_uv; out vec3 v_cover; out float v_rim; out vec2 v_mask_uv;
void main(){gl_Position=vec4(a_position,1.0);v_color=a_color;v_uv=a_uv;v_cover=a_cover;v_rim=a_rim;v_mask_uv=a_mask_uv;}`;
const FS=`#version 300 es
precision highp float;
in vec3 v_color; in vec2 v_uv; in vec3 v_cover; in float v_rim; in vec2 v_mask_uv; uniform sampler2D u_texture; uniform sampler2D u_mask; uniform int u_mode; uniform bool u_mask_enabled; uniform bool u_debug; uniform float u_mask_scale; uniform float u_softness; uniform float u_bleed; uniform vec3 u_leaf_color; uniform vec3 u_snow_color; uniform vec3 u_scorch_color; out vec4 color;
float hash(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
float noise2(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
float coverage(float amount,float noise){
  if(amount<=0.0)return 0.0;if(amount>=1.0)return 1.0;
  float width=max(.0001,min(u_softness,min(amount,1.0-amount)));
  return smoothstep(1.0-amount-width,1.0-amount+width,noise);
}
void main(){
  vec4 t=texture(u_texture,v_uv);
  if(u_mode==2){if(t.a<0.5)discard;color=vec4(t.rgb,1.0);}
  else {
    vec3 base=v_color*(u_mode==1?0.75+0.25*t.r:1.0);
    float noise=noise2(v_mask_uv*u_mask_scale);
    if(u_mask_enabled)noise=mix(noise,texture(u_mask,v_mask_uv).r,.65);
    float rim=v_rim<0.0?1.0:(u_bleed<=0.0?0.0:1.0-smoothstep(0.0,u_bleed,v_rim));
    vec3 cover=clamp(v_cover*rim,0.0,1.0);
    if(u_debug){color=vec4(cover,1.0);return;}
    float leaf=coverage(cover.x,noise),snow=coverage(cover.y,noise2(v_mask_uv*u_mask_scale+vec2(19.3,7.7))*.35+noise*.65);
    if(v_rim>=0.0)base=mix(base,u_scorch_color,cover.z*.85);
    base=mix(base,u_leaf_color,leaf*.85);
    base=mix(base,u_snow_color,snow);
    color=vec4(base,1.0);
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
  const vao=gl.createVertexArray(),buffer=gl.createBuffer();gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
  for(const [name,size,offset] of [["a_position",3,0],["a_color",3,12],["a_uv",2,24],["a_cover",3,32],["a_rim",1,44],["a_mask_uv",2,48]]){
    const loc=gl.getAttribLocation(program,name);gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,size,gl.FLOAT,false,56,offset);
  }
  const mode=gl.getUniformLocation(program,"u_mode");
  const uniforms=Object.fromEntries(["u_mask_enabled","u_debug","u_mask_scale","u_softness","u_bleed","u_leaf_color","u_snow_color","u_scorch_color"].map(k=>[k,gl.getUniformLocation(program,k)]));
  gl.uniform1i(gl.getUniformLocation(program,"u_texture"),0);gl.uniform1i(gl.getUniformLocation(program,"u_mask"),1);
  function texture(){const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);return t;}
  const ground=texture(),pixels=new Uint8Array(64*64*4);
  // Periodic procedural swatch, not final Atlas artwork.
  for(let y=0;y<64;y++)for(let x=0;x<64;x++){
    const a=x*Math.PI/32,b=y*Math.PI/32,v=Math.round(195+28*Math.sin(3*a+2*b)+20*Math.cos(5*a-4*b)+10*Math.sin(11*a+7*b)),i=(y*64+x)*4;
    pixels.set([v,v,v,255],i);
  }
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,64,64,0,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.REPEAT);
  const mask=texture();let maskEnabled=false;
  gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,mask);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([128,128,128,255]));
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.REPEAT);gl.activeTexture(gl.TEXTURE0);
  function setTransitionMask(image){
    gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,mask);
    try{if(image){gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);maskEnabled=true;}else maskEnabled=false;}
    finally{gl.activeTexture(gl.TEXTURE0);}
  }
  const spriteTextures=new Map();
  function spriteTexture(actor){
    let record=spriteTextures.get(actor.image);
    if(!record){const tex=texture();gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);record={tex,revision:-1};spriteTextures.set(actor.image,record);}
    if(record.revision!==actor.revision){gl.bindTexture(gl.TEXTURE_2D,record.tex);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,actor.image);record.revision=actor.revision;}
    return record.tex;
  }
  function draw(data,tex,m){if(!data.length)return;gl.bindTexture(gl.TEXTURE_2D,tex);gl.uniform1i(mode,m);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(data),gl.DYNAMIC_DRAW);gl.drawArrays(gl.TRIANGLES,0,data.length/14);}
  function render(faces,view,{selected=null,pattern=true,sprites=[],sprite:actor=null,transitions={},debug=false}={}){
    gl.viewport(0,0,canvas.width,canvas.height);gl.clearColor(.105,.16,.20,1);gl.clearDepth(1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    gl.uniform1i(uniforms.u_mask_enabled,maskEnabled?1:0);gl.uniform1i(uniforms.u_debug,debug?1:0);
    gl.uniform1f(uniforms.u_mask_scale,transitions.mask_scale??8);gl.uniform1f(uniforms.u_softness,transitions.mask_softness??.13);gl.uniform1f(uniforms.u_bleed,transitions.cliff_bleed_ft??1.25);
    gl.uniform3fv(uniforms.u_leaf_color,transitions.leaf_color??[.65,.34,.12]);gl.uniform3fv(uniforms.u_snow_color,transitions.snow_color??[.91,.94,.97]);gl.uniform3fv(uniforms.u_scorch_color,transitions.scorch_color??[.15,.13,.11]);
    gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.depthMask(true);gl.disable(gl.BLEND);
    const projected=faces.map(f=>({f,p:f.points.map(view)})),actors=[...sprites,...(actor?[actor]:[])].map(a=>({actor:a,quad:a.points.map(view)}));
    let low=Infinity,high=-Infinity;
    for(const p of [...projected.flatMap(f=>f.p),...actors.flatMap(a=>a.quad)]){low=Math.min(low,p.depth);high=Math.max(high,p.depth);}
    const range=Math.max(1,high-low),center=(low+high)/2;
    const pack=(out,p,color,uv,cover=[0,0,0],rim=-1,maskUV=uv)=>out.push(2*p.x/canvas.width-1,1-2*p.y/canvas.height,-(p.depth-center)*1.8/range,...color,...uv,...cover,rim,...maskUV);
    const data=[];
    for(const {f,p} of projected){
      const active=selected&&f.address?.every((v,i)=>v===selected[i]),color=f.color??(f.kind==="top"?(active?[.68,.77,.43]:[.45,.61,.35]):f.kind==="bottom"?[.34,.27,.22]:[.57,.42,.30]);
      for(let i=0;i<3;i++){const [x,y,z]=f.points[i],a=f.attributes?.[i];pack(data,p[i],a?.color??color,f.kind==="side"?[(x+y)/5,z/5]:[x/5,y/5],a?.cover??f.cover,a?.rim??-1,[(x+Math.max(0,a?.rim??0)*.35)/5,(y+Math.max(0,a?.rim??0)*.5)/5]);}
    }
    draw(data,ground,pattern?1:0);
    const batches=new Map(),used=new Set(),uv=[[0,0],[1,0],[1,1],[0,1]];
    for(const {actor,quad} of actors){used.add(actor.image);const tex=spriteTexture(actor),batch=batches.get(tex)??[];for(const i of [0,1,2,0,2,3])pack(batch,quad[i],[1,1,1],uv[i]);batches.set(tex,batch);}
    for(const [tex,batch] of batches)draw(batch,tex,2);
    for(const [image,record] of spriteTextures)if(!used.has(image)){gl.deleteTexture(record.tex);spriteTextures.delete(image);}

  }
  return Object.freeze({render,setTransitionMask,readPixel(x,y){const p=new Uint8Array(4);gl.readPixels(x,canvas.height-1-y,1,1,gl.RGBA,gl.UNSIGNED_BYTE,p);return [...p];}});
}
