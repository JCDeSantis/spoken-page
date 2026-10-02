// Isolated local ABS fixture and app. Never contacts the user's configured server.
const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const fixturePort = Number(process.env.SPOKEN_PAGE_FIXTURE_PORT || 4319);
const appPort = Number(process.env.SPOKEN_PAGE_FIXTURE_APP_PORT || 4320);
let failProgress = false;
const audio = Buffer.alloc(44 + 60 * 8000 * 2);
audio.write('RIFF');audio.writeUInt32LE(audio.length-8,4);audio.write('WAVEfmt ',8);audio.writeUInt32LE(16,16);audio.writeUInt16LE(1,20);audio.writeUInt16LE(1,22);audio.writeUInt32LE(8000,24);audio.writeUInt32LE(16000,28);audio.writeUInt16LE(2,32);audio.writeUInt16LE(16,34);audio.write('data',36);audio.writeUInt32LE(audio.length-44,40);
const progress = new Map();
progress.set('book-5',{id:'progress-book-5',libraryItemId:'book-5',duration:3600,currentTime:900,progress:.25,isFinished:false,startedAt:1000,lastUpdate:1000});
const books=Array.from({length:1205},(_,i)=>({id:`book-${i}`,libraryId:'fixture',mediaType:'book',media:{duration:3600,numChapters:2,metadata:{title:i===1204?'Z Last-page Treasure':`Fixture Book ${String(i).padStart(4,'0')}`,subtitle:i===1204?'Hidden beyond page one':'',authorName:i%2?'Avery Author':'Blake Writer',narratorName:'Morgan Voice',seriesName:`Fixture Saga Book ${i+1}`,genres:['Fantasy'],language:'en',description:'An isolated test book for search and listening status verification.'},tags:['Test']},libraryFiles:[]}));
const user=()=>({id:'fixture-user',username:'Test listener',type:'user',permissions:{download:true},mediaProgress:[...progress.values()]});
const expanded=b=>({...b,userMediaProgress:progress.get(b.id)||null,media:{...b.media,tracks:[{index:1,startOffset:0,duration:3600,title:'Test tone',contentUrl:'/fixture-audio.wav',mimeType:'audio/wav'}],chapters:[{id:1,start:0,end:1800,title:'Beginning'},{id:2,start:1800,end:3600,title:'Ending'}]}});
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1:4319');
  let body='';for await(const chunk of req)body+=chunk;
  let data={};try{data=body?JSON.parse(body):{};}catch{}
  res.setHeader('content-type','application/json');
  const send=(v,status=200)=>{res.statusCode=status;res.end(JSON.stringify(v));};
  if(url.pathname==='/fixture/control' && req.method==='POST'){failProgress=Boolean(data.failProgress);return send({failProgress});}
  if(url.pathname==='/fixture-audio.wav'){
    res.setHeader('content-type','audio/wav');res.setHeader('accept-ranges','bytes');
    const range=req.headers.range?.match(/bytes=(\d+)-(\d*)/);
    const start=range?Number(range[1]):0,end=range&&range[2]?Math.min(Number(range[2]),audio.length-1):audio.length-1;
    if(start>=audio.length){res.statusCode=416;return res.end();}
    if(range){res.statusCode=206;res.setHeader('content-range',`bytes ${start}-${end}/${audio.length}`);}
    res.setHeader('content-length',end-start+1);return res.end(audio.subarray(start,end+1));
  }
  if(url.pathname==='/status')return send({serverVersion:'2.36.1-fixture'});
  if(url.pathname==='/login')return send({user:{...user(),accessToken:'fixture-only'},serverSettings:{version:'2.36.1-fixture'}});
  if(url.pathname==='/api/authorize')return send({user:user(),serverSettings:{version:'2.36.1-fixture'}});
  if(url.pathname==='/api/me')return send(user());
  if(url.pathname==='/api/libraries')return send({libraries:[{id:'fixture',name:'Isolated test library',mediaType:'book',icon:'books'}]});
  if(url.pathname==='/api/libraries/fixture')return send({id:'fixture',name:'Isolated test library'});
  if(url.pathname==='/api/libraries/fixture/filterdata')return send({authors:[{id:'avery',name:'Avery Author'},{id:'blake',name:'Blake Writer'}],series:[{id:'saga',name:'Fixture Saga'}],narrators:['Morgan Voice'],genres:['Fantasy'],tags:['Test'],languages:['en']});
  if(url.pathname==='/api/libraries/fixture/items'){
    const page=Number(url.searchParams.get('page')||0),limit=Number(url.searchParams.get('limit')||100);
    return send({results:books.slice(page*limit,(page+1)*limit).map(expanded),total:books.length,page,limit});
  }
  const m=url.pathname.match(/^\/api\/items\/(book-\d+)(.*)$/);
  if(m){const b=books.find(b=>b.id===m[1]);if(!b)return send({},404);
    if(m[2]==='/cover'){res.setHeader('content-type','image/svg+xml');return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="260"><rect width="200" height="260" fill="#30151e"/><text x="100" y="115" text-anchor="middle" fill="#ff6677" font-size="20">TEST BOOK</text></svg>');}
    if(m[2]==='/play')return send({id:'fixture-session-'+b.id,currentTime:progress.get(b.id)?.currentTime||0,startedAt:Date.now(),audioTracks:expanded(b).media.tracks,libraryItem:expanded(b)});
    return send(expanded(b));
  }
  const reset=url.pathname.match(/^\/api\/me\/progress\/progress-(book-\d+)$/);
  if(reset && req.method==='DELETE'){progress.delete(reset[1]);return send({});}
  const p=url.pathname.match(/^\/api\/me\/progress\/(book-\d+)$/);
  if(p){if(failProgress)return send({error:'Simulated progress save failure'},503);if(req.method==='DELETE')return send({error:'Use progress ID'},404);progress.set(p[1],{...(progress.get(p[1])||{}),...data,id:'progress-'+p[1],libraryItemId:p[1],lastUpdate:Date.now()});return send({});}
  if(url.pathname.startsWith('/api/session/'))return send({});
  return send({error:'Unknown fixture endpoint'},404);
});
server.listen(fixturePort,'127.0.0.1',()=>{
  const dir=path.join(process.cwd(),'.test-data',`browser-${appPort}`);fs.mkdirSync(dir,{recursive:true});
  const app=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','-p',String(appPort)],{stdio:'inherit',env:{...process.env,SPOKEN_PAGE_DATA_DIR:dir,SPOKEN_PAGE_SECRET:'isolated-fixture-secret',SPOKEN_PAGE_ABS_BASE_URL:`http://127.0.0.1:${fixturePort}`}});
  console.log(`Fixture preview: http://localhost:${appPort} — username fixture, password fixture. No production writes.`);
  const stop=()=>{app.kill();server.close();};process.on('SIGINT',stop);process.on('SIGTERM',stop);app.on('exit',()=>server.close());
});
