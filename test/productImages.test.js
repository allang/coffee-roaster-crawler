'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {primaryProductImage,sameImageProduct,imageUrl}=require('../src/productImages');
const {extractPage}=require('../src/extraction');
const {imageFormat,fetchSourceImage}=require('../src/sourceImage');
const {inspectPhoto,applyPhoto}=require('../src/photoRepair');
const {catalogDb,supabaseAdapter}=require('./catalogDb');
const {saveProduct}=require('../src/productSaver');
const {downloadAndSaveImage}=require('../src/imageDownloader');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=','base64');
const log=new Proxy({},{get:()=>()=>{}}),url='https://shop.test/products/ethiopia',image='https://images.test/ethiopia.png';
const schema=p=>`<script type="application/ld+json">${JSON.stringify(p)}</script>`;
const html=schema({'@type':'Product',url:url+'?Roast=Espresso&Size=250gr',name:'Ethiopia',image:[{'@type':'ImageObject',contentUrl:image}],offers:{url,sku:'250',price:'18',priceCurrency:'EUR'}});
test('primary photo survives Shopify option URLs and does not alter query-based merchant identity',()=>{
 assert.equal(primaryProductImage({html,url}).url,image);
 assert.equal(sameImageProduct('https://shop.test/shop_view?idx=2','https://shop.test/shop_view?idx=1'),false);
 assert.equal(imageUrl('/photos/bag.png',url),'https://shop.test/photos/bag.png');
 assert.equal(imageUrl('https://example.com/invented.jpg',url),null);
 const parsed=require('../src/shopifyProduct').parseShopifyProduct({title:'Coffee',images:['//images.test/second.png'],image:{src:image}});
 assert.equal(parsed.mainImage,image);assert.equal(parsed.images[0].src,'//images.test/second.png');
 assert.equal(primaryProductImage({url,native:{handle:'recommendation',mainImage:image}}).url,null);
});
test('Open Graph fallback requires a product-bound page; conflicting products and generated cards stay unresolved',()=>{
 const meta=`<meta property="og:type" content="product"><meta property="og:url" content="${url}"><meta property="og:image" content="http://images.test/bag.png">`;
 assert.equal(primaryProductImage({html:meta,url}).url,'https://images.test/bag.png');
 assert.equal(primaryProductImage({html:meta.replace(url,'https://shop.test/'),url}).url,null);
 assert.equal(primaryProductImage({html:meta+'<meta property="og:image:type" content="image/svg+xml">',url}).url,null);
 assert.equal(primaryProductImage({html:meta+schema({'@type':'Product',url,image})+schema({'@type':'Product',url,image:'https://images.test/other.png'}),url}).reason,'ambiguous_primary_product_images');
 assert.equal(primaryProductImage({html:schema({'@type':'Product',url:'https://shop.test/products/recommendation',image}),url}).url,null);
});
test('fresh photos override invented classification even without structured prices or an image in truncated text',async()=>{
 const result=await extractPage({page:{url,html,content:'Coffee text only'},model:'fixture',classify:async()=>({data:{is_coffee_page:true,product:{name:'Ethiopia',attributes:{product_image_url:'https://example.com/fake.jpg'}}}})});
 assert.equal(result.data.product.attributes.product_image_url,image);
 const absent=await extractPage({page:{url,html:'<p>Coffee</p>',content:'Coffee'},model:'fixture',classify:async()=>({data:{is_coffee_page:true,product:{name:'Ethiopia',attributes:{product_image_url:image}}}})});
 assert.equal(absent.data.product.attributes.product_image_url,undefined);
});
test('image verification accepts real image bytes and blocks HTML and prohibited paths before requesting',async()=>{
 assert.equal(imageFormat(png).contentType,'image/png');assert.equal(imageFormat(Buffer.from('<html>Not an image</html>')),null);
 const response=await fetchSourceImage('https://shop.test/terms/photo.png');assert.equal(response.success,false);assert.match(response.error,/Prohibited/);
 const held=await inspectPhoto({id:'p',name:'Kenya',source_url:url},{fetchPage:async()=>({success:true,data:html}),fetchImage:async()=>{throw Error('Unrelated coffee photo must not be fetched');}});
 assert.equal(held.reason,'current_product_title_requires_review');
});
test('catalog save stores a real photo, repairs existing records idempotently and preserves a present photo',async()=>{
 const pg=await catalogDb();try {
  const owner='11111111-1111-4111-8111-111111111111';await pg.query('insert into entities(id) values($1)',[owner]);
  const db=supabaseAdapter(pg);let uploads=0,referer;
  db.storage={from(){return {async upload(){uploads++;return {error:null};},getPublicUrl(){return {data:{publicUrl:'https://storage.test/bag.png'}};}};}};
  const fetchImage=async(_url,options)=>{referer=options?.referer;return {success:true,data:png,headers:{'content-type':'text/plain'}};};
  const product={name:'Ethiopia',source_product_id:'123',attributes:{product_image_url:image},variants:[{source_id:'250',title:'250g',price:'18',currency:'EUR'}]};
  const id=await saveProduct(owner,product,url,log,{db,downloadImage:(id,src,logger,options)=>downloadAndSaveImage(id,src,logger,{...options,fetchImage})});
  assert.equal(referer,url);assert.equal(uploads,1);
  let row=(await pg.query('select * from products where id=$1',[id])).rows[0];assert.equal(row.original_image_url,image);
  assert.equal((await pg.query('select count(*)::int n from product_media where product_id=$1',[id])).rows[0].n,1);
  await pg.query('delete from product_media where product_id=$1',[id]);
  const fetchPage=async()=>({success:true,data:html,finalUrl:url});
  const entry=await inspectPhoto(row,{fetchPage,fetchImage});assert.equal(entry.status,'ready');
  // Nested production reads are supplied from the same disposable SQL database.
  const repairDb={...db,from(table){if(table==='products')return {...db.from(table),select(fields){if(!fields.includes('product_media'))return db.from(table).select(fields);return {eq(_key,id){return {async single(){const data=(await pg.query('select * from products where id=$1',[id])).rows[0];data.product_media=(await pg.query('select a.url from product_media p join media_assets a on a.id=p.media_asset_id where p.product_id=$1',[id])).rows.map(a=>({media_assets:a}));return {data,error:null};}};}};}};return db.from(table);}};
  assert.equal((await applyPhoto(entry,{db:repairDb,fetchPage,fetchImage,log})).status,'repaired');
  assert.equal((await applyPhoto(entry,{db:repairDb,fetchPage,fetchImage,log})).status,'already_has_photo');
  assert.equal(uploads,1);assert.equal((await pg.query('select count(*)::int n from media_assets')).rows[0].n,1);
  await assert.rejects(()=>applyPhoto({...entry,entity_id:'other-owner'},{db:repairDb,fetchPage,fetchImage,log}),/identity changed/);
  const invalid=await downloadAndSaveImage(id,'https://images.test/error.png',log,{db,fetchImage:async()=>({success:true,data:Buffer.from('<html>error</html>'),headers:{'content-type':'image/png'}})});assert.equal(invalid,null);
 } finally {await pg.close();}
});
