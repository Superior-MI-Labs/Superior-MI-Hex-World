// Six corners counterclockwise from +30 degrees, center last.
// Heights are integer subdivisions within one cell.
const assert=(ok,message)=>{if(!ok)throw new Error(message);};
export function validateSubdivisions(n){
  assert(Number.isSafeInteger(n)&&n>=1&&n<=16,"Invalid geometry subdivisions");
  return n;
}
export function uniformShape(upper,lower=0){
  return {lower:Array(7).fill(lower),upper:Array(7).fill(upper)};
}
export function shape(value,n){
  validateSubdivisions(n);
  assert(value&&["lower","upper"].every(k=>Array.isArray(value[k])&&value[k].length===7&&Array.from(value[k]).every(h=>Number.isSafeInteger(h)&&h>=0&&h<=n)),"Invalid vertex heights");
  assert(value.lower.every((h,i)=>h<=value.upper[i]),"Lower vertex exceeds upper vertex");
  return {lower:[...value.lower],upper:[...value.upper]};
}
export function corners(radius=1){
  return [...Array.from({length:6},(_,i)=>{const a=(30+i*60)*Math.PI/180;return [radius*Math.cos(a),radius*Math.sin(a)];}),[0,0]];
}
export const EDGE_NEIGHBORS=Object.freeze([[0,1],[-1,1],[-1,0],[0,-1],[1,-1],[1,0]].map(Object.freeze));
export const oppositeEdge=i=>(i+3)%6;
export function vertices(value,grid){
  const n=grid.geometry_subdivisions,s=shape(value,n),xy=corners(grid.horizontal_ft/Math.sqrt(3));
  const layer=k=>xy.map(([x,y],i)=>[x,y,grid.vertical_ft*s[k][i]/n]);
  return {lower:layer("lower"),upper:layer("upper")};
}
const cross=(a,b,c)=>{const u=b.map((v,i)=>v-a[i]),v=c.map((v,i)=>v-a[i]);return [u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];};
export function mesh(value,grid){
  const s=shape(value,grid.geometry_subdivisions),v=vertices(s,grid),faces=[];
  const add=(kind,points,index)=>{if(Math.hypot(...cross(...points))>0)faces.push({kind,points,...(kind==="side"?{edge:index}:{triangle:index})});};
  for(let i=0;i<6;i++){
    const j=(i+1)%6;
    if([i,j,6].some(k=>s.upper[k]>s.lower[k])){
      add("top",[v.upper[6],v.upper[i],v.upper[j]],i);
      add("bottom",[v.lower[6],v.lower[j],v.lower[i]],i);
    }
    add("side",[v.lower[i],v.lower[j],v.upper[j]],i);
    add("side",[v.lower[i],v.upper[j],v.upper[i]],i);
  }
  return faces;
}
// Surface interpolation uses the same triangle fan as the renderer.
export function sampleSurface(value,grid,x,y,layer="upper"){
  assert(layer==="upper"||layer==="lower","Invalid surface layer");
  const v=vertices(value,grid)[layer],c=v[6];
  for(let i=0;i<6;i++){
    const a=v[i],b=v[(i+1)%6],det=a[0]*b[1]-a[1]*b[0];
    const u=(x*b[1]-y*b[0])/det,w=(a[0]*y-a[1]*x)/det;
    if(u>=-1e-9&&w>=-1e-9&&u+w<=1+1e-9)return c[2]*(1-u-w)+a[2]*u+b[2]*w;
  }
  return undefined;
}
export function edgeProfile(value,n,edge){
  assert(Number.isInteger(edge)&&edge>=0&&edge<6,"Invalid edge");
  const s=shape(value,n),j=(edge+1)%6;
  return {lower:[s.lower[edge],s.lower[j]],upper:[s.upper[edge],s.upper[j]]};
}

// A corner is shared by exactly three axial cells. Index arithmetic is exact.
export function cornerRefs(q,r,z,i){
  assert(Number.isInteger(i)&&i>=0&&i<=6,"Invalid vertex");
  if(i===6)return [{address:[q,r,z],index:i}];
  return [{address:[q,r,z],index:i},...[[i,(i+4)%6],[(i+5)%6,(i+2)%6]].map(([edge,index])=>{
    const [dq,dr]=EDGE_NEIGHBORS[edge];return {address:[q+dq,r+dr,z],index};
  })];
}
const lerp=(a,b,t)=>a+(b-a)*t;
// Difference of two piecewise-linear vertical edge intervals. All crossing
// parameters partition the segment; midpoint ordering holds within each part.
export function exposedEdge(own,neighbor){
  if(neighbor===undefined)return []; // unknown is not air
  const lines=[own.lower,own.upper,...(neighbor?[neighbor.lower,neighbor.upper]:[])];
  const cuts=[0,1];
  for(let i=0;i<lines.length;i++)for(let j=i+1;j<lines.length;j++){
    const a=lines[i][0]-lines[j][0],b=lines[i][1]-lines[j][1],t=a/(a-b);
    if(t>0&&t<1)cuts.push(t);
  }
  const sorted=[...new Set(cuts)].sort((a,b)=>a-b),out=[];
  const at=(l,t)=>lerp(...l,t);
  for(let i=0;i<sorted.length-1;i++){
    const t0=sorted[i],t1=sorted[i+1],m=(t0+t1)/2;
    if(t1-t0<1e-12)continue;
    const intervals=!neighbor||at(neighbor.upper,m)<=at(neighbor.lower,m)?[[own.lower,own.upper]]:
      [[own.lower,at(own.upper,m)<at(neighbor.lower,m)?own.upper:neighbor.lower],
       [at(own.lower,m)>at(neighbor.upper,m)?own.lower:neighbor.upper,own.upper]];
    for(const [lo,hi] of intervals)if(at(hi,m)>at(lo,m)){
      out.push([[t0,at(lo,t0)],[t1,at(lo,t1)],[t1,at(hi,t1)],[t0,at(hi,t0)]]);
    }
  }
  return out;
}
export function hasVolume(s){return s.upper.some((h,i)=>h>s.lower[i]);}
