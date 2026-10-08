'use strict';
const {PGlite}=require('@electric-sql/pglite');
const fs=require('node:fs');
const path=require('node:path');
async function catalogDb({nativeWeightCompatibility=true}={}) {
  const db=new PGlite();
  await db.exec(fs.readFileSync(path.join(__dirname,'fixtures/catalogSchema.sql'),'utf8'));
  for(const file of fs.readdirSync(path.join(__dirname,'../supabase/migrations')).sort()) {
    if(!nativeWeightCompatibility && file==='20261008155858_native_variant_weight_compat.sql')continue;
    await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations',file),'utf8'));
  }
  return db;
}
// Adapter only for production Supabase call contracts exercised in tests; no network/credentials.
function supabaseAdapter(pg) {
  return {async rpc(name,args){try{const observation=Object.hasOwn(args,'product_id');const {rows}=await pg.query(observation?`select ${name}($1::uuid,$2::jsonb) as result`:`select ${name}($1::jsonb) as result`,observation?[args.product_id,JSON.stringify(args.observation)]:[JSON.stringify(args.payload)]);return {data:rows[0].result,error:null};}catch(error){return {data:null,error};}},
    from(table) {
      if(!/^[a-z_]+$/.test(table)) throw Error('Invalid test table');
      let fields='*',filters=[],params=[],limit='',order='',mutation=null,body,conflict;
      const q={select(value='*'){fields=value;return q;},eq(key,value){params.push(value);filters.push(`"${key}"=$${params.length}`);return q;},order(key){order=` order by "${key}"`;return q;},range(a,b){limit=` limit ${b-a+1} offset ${a}`;return q;},
        maybeSingle(){return q.execute(true);},single(){return q.execute(true);},insert(value){mutation='insert';body=value;return q;},upsert(value,opts){mutation='upsert';body=value;conflict=opts?.onConflict;return q;},update(value){mutation='update';body=value;return q;},
        then(resolve,reject){return q.execute(false).then(resolve,reject);},
        async execute(single){try{let sql;
          if(!mutation) sql=`select ${fields} from ${table}${filters.length?' where '+filters.join(' and '):''}${order}${limit}`;
          else if(mutation==='update'){const columns=Object.keys(body),before=params.length;params.push(...Object.values(body));sql=`update ${table} set ${columns.map((k,i)=>`"${k}"=$${before+i+1}`).join(',')}${filters.length?' where '+filters.join(' and '):''} returning ${fields}`;}
          else {const columns=Object.keys(body);params=Object.values(body);sql=`insert into ${table}(${columns.map(k=>`"${k}"`).join(',')}) values(${columns.map((k,i)=>`$${i+1}`).join(',')})${mutation==='upsert'?` on conflict(${conflict || 'id'}) do update set ${columns.map(k=>`"${k}"=excluded."${k}"`).join(',')}`:''} returning ${fields}`;}
          const {rows}=await pg.query(sql,params);if(single&&rows.length>1) throw Error('Multiple rows');return {data:single?rows[0]||null:rows,error:null};
        }catch(error){return {data:null,error};}}
      };return q;
    }
  };
}
module.exports={catalogDb,supabaseAdapter};
