'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {catalogDb,supabaseAdapter}=require('./catalogDb');
const {downloadAndSaveImage}=require('../src/imageDownloader');
const log=new Proxy({},{get:()=>()=>{}});
test('durable image URL cache prevents repeat downloads while preserving linked assets',async()=>{
  const pg=await catalogDb();
  try {
    const owner='11111111-1111-4111-8111-111111111111',product='22222222-2222-4222-8222-222222222222';
    await pg.query('insert into entities(id) values($1)',[owner]);await pg.query("insert into products(id,entity_id,slug,name) values($1,$2,'coffee','Coffee')",[product,owner]);
    const db=supabaseAdapter(pg);let fetches=0,uploads=0;
    db.storage={from(){return{async upload(){uploads++;return{error:null};},getPublicUrl(){return{data:{publicUrl:'https://storage.test/image'}};}};}};
    const opts={db,fetchImage:async()=>{fetches++;return{success:true,data:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=','base64'),headers:{'content-type':'image/png'}};}};
    const first=await downloadAndSaveImage(product,'https://images.test/coffee.png',log,opts);assert(first);
    const second=await downloadAndSaveImage(product,'https://images.test/coffee.png',log,opts);assert.equal(second,first);assert.equal(fetches,1);assert.equal(uploads,1);
    assert.equal((await pg.query('select count(*)::int n from product_media')).rows[0].n,1);
    await pg.query("update media_source_cache set checked_at=now()-interval '8 days'");
    assert.equal(await downloadAndSaveImage(product,'https://images.test/coffee.png',log,opts),first);assert.equal(fetches,2);assert.equal(uploads,1);
  } finally {await pg.close();}
});
