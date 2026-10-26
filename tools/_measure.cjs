const fs=require('fs'),path=require('path'),zlib=require('zlib');
const {minify}=require('terser');
const SRC=path.resolve('src');
const CORE=['util','errlog','sync-model','cloud-v18','store','engine','parse','features','extra','fx','ux','remind','safety','product','ui','main'];
const CH={
 diary:['diary','enc','paper'],
 grow:['insights','chart','ics'],
 social:['rooms','friends-v19','buddy','decor'],
 plus:['plus','level','challenge','plugins','health'],
 tools:['timer','todo','lock','webdav']
};
const read=n=>fs.readFileSync(path.join(SRC,n+'.js'),'utf8');
(async()=>{
 const all=[...CORE,...Object.values(CH).flat()];
 const set=new Set(all);
 const onDisk=fs.readdirSync(SRC).filter(f=>f.endsWith('.js')).map(f=>f.slice(0,-3));
 const missing=onDisk.filter(n=>!set.has(n));
 if(missing.length) console.log('!! 未归类:',missing.join(','));
 const pack=async names=>{
   const code=names.map(read).join('\n;\n');
   const r=await minify(code,{compress:{passes:2},mangle:true});
   const b=Buffer.from(r.code,'utf8');
   return {raw:b.length,gz:zlib.gzipSync(b,{level:9}).length};
 };
 const c=await pack(CORE);
 let sum=c;
 console.log('core       ', (c.raw/1024).toFixed(0)+'KB', 'gzip '+(c.gz/1024).toFixed(0)+'KB', CORE.length+' 文件');
 for(const [k,v] of Object.entries(CH)){
   const m=await pack(v);
   console.log((k+'        ').slice(0,11), (m.raw/1024).toFixed(0)+'KB','gzip '+(m.gz/1024).toFixed(0)+'KB', v.join('+'));
   sum={raw:sum.raw+m.raw,gz:sum.gz+m.gz};
 }
 console.log('合计       ', (sum.raw/1024).toFixed(0)+'KB','gzip '+(sum.gz/1024).toFixed(0)+'KB');
 console.log('首屏占比   ', (c.raw/sum.raw*100).toFixed(1)+'%');
})();
