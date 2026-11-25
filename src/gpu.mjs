// WebGL2 depth-tested triangles; all positions originate in the terrain mesh.
const VS=`#version 300 es
in vec3 a_position; in vec3 a_color; in vec2 a_uv;
out vec3 v_color; out vec2 v_uv;
void main(){gl_Position=vec4(a_position,1.0);v_color=a_color;v_uv=a_uv;}`;
const FS=`#version 300 es
precision highp float;
in vec3 v_color; in vec2 v_uv; uniform sampler2D u_texture; uniform int u_mode; out vec4 color;
void main(){
  vec4 t=texture(u_texture,v_uv);
  if(u_mode==2){if(t.a<0.5)discard;color=vec4(t.rgb,1.0);}
  else if(u_mode==1)color=vec4(v_color*(0.75+0.25*t.r),1.0);
  else color=vec4(v_color,1.0);
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
  for(const [name,size,offset] of [["a_position",3,0],["a_color",3,12],["a_uv",2,24]]){
    const loc=gl.getAttribLocation(program,name);gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,size,gl.FLOAT,false,32,offset);
  }
  const mode=gl.getUniformLocation(program,"u_mode");gl.uniform1i(gl.getUniformLocation(program,"u_texture"),0);
  function texture(){const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);return t;}
  const ground=texture(),pixels=new Uint8Array(64*64*4);
  // Periodic procedural swatch, not final Atlas artwork.
  for(let y=0;y<64;y++)for(let x=0;x<64;x++){
    const a=x*Math.PI/32,b=y*Math.PI/32,v=Math.round(195+28*Math.sin(3*a+2*b)+20*Math.cos(5*a-4*b)+10*Math.sin(11*a+7*b)),i=(y*64+x)*4;
    pixels.set([v,v,v,255],i);
  }
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,64,64,0,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.REPEAT);
  const sprite=texture();gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  let source=null,revision=-1;
  function draw(data,tex,m){if(!data.length)return;gl.bindTexture(gl.TEXTURE_2D,tex);gl.uniform1i(mode,m);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(data),gl.DYNAMIC_DRAW);gl.drawArrays(gl.TRIANGLES,0,data.length/8);}
  function render(faces,view,{selected=null,pattern=true,sprite:actor=null}={}){
    gl.viewport(0,0,canvas.width,canvas.height);gl.clearColor(.105,.16,.20,1);gl.clearDepth(1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.depthMask(true);gl.disable(gl.BLEND);
    const projected=faces.map(f=>({f,p:f.points.map(view)})),quad=actor?.points.map(view);
    let low=Infinity,high=-Infinity;
    for(const p of [...projected.flatMap(f=>f.p),...(quad??[])]){low=Math.min(low,p.depth);high=Math.max(high,p.depth);}
    const range=Math.max(1,high-low),center=(low+high)/2;
    const pack=(out,p,color,uv)=>out.push(2*p.x/canvas.width-1,1-2*p.y/canvas.height,-(p.depth-center)*1.8/range,...color,...uv);
    const data=[];
    for(const {f,p} of projected){
      const active=selected&&f.address?.every((v,i)=>v===selected[i]),color=f.color??(f.kind==="top"?(active?[.68,.77,.43]:[.45,.61,.35]):f.kind==="bottom"?[.34,.27,.22]:[.57,.42,.30]);
      for(let i=0;i<3;i++){const [x,y,z]=f.points[i];pack(data,p[i],color,f.kind==="side"?[(x+y)/5,z/5]:[x/5,y/5]);}
    }
    draw(data,ground,pattern?1:0);
    if(actor&&quad){
      if(source!==actor.image||revision!==actor.revision){gl.bindTexture(gl.TEXTURE_2D,sprite);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,actor.image);source=actor.image;revision=actor.revision;}
      const uv=[[0,0],[1,0],[1,1],[0,1]],data=[];
      for(const i of [0,1,2,0,2,3])pack(data,quad[i],[1,1,1],uv[i]);
      draw(data,sprite,2);
    }
  }
  return Object.freeze({render,readPixel(x,y){const p=new Uint8Array(4);gl.readPixels(x,canvas.height-1-y,1,1,gl.RGBA,gl.UNSIGNED_BYTE,p);return [...p];}});
}
