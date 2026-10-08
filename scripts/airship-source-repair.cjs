#!/usr/bin/env node
'use strict';
// Prints a transactional dry run. No DB client, credentials or execution.
const plan=require('../data/airship-invalid-source-repair.json');
function sqlLiteral(value){return "'"+String(value).replace(/'/g,"''")+"'";}
function repairSql({commit=false}={}) {
 const values=plan.records.map(r=>'('+[r.id,r.before_fingerprint,r.reason,r.source_url].map(sqlLiteral).join(',')+')').join(',\n');
 const body=`SET LOCAL lock_timeout='5s';
DO $repair$
DECLARE expected record; actual jsonb; changed integer:=0;
BEGIN
 FOR expected IN SELECT * FROM (VALUES ${values}) AS v(id,fingerprint,reason,source_url) LOOP
  SELECT to_jsonb(p) INTO actual FROM public.products p WHERE p.id=expected.id::uuid FOR UPDATE;
  IF actual IS NULL OR actual->>'entity_id'<>${sqlLiteral(plan.entity_id)} OR actual->>'source_url'<>expected.source_url THEN
   RAISE EXCEPTION 'Airship repair identity drift: %',expected.id;
  END IF;
  IF actual->>'is_active'='false' AND actual#>>'{metadata,_source_repair,plan_id}'=${sqlLiteral(plan.plan_id)} THEN CONTINUE; END IF;
  IF md5(actual::text)<>expected.fingerprint THEN RAISE EXCEPTION 'Airship repair record changed: %',expected.id; END IF;
  UPDATE public.products SET is_active=false,metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('_source_repair',jsonb_build_object('plan_id',${sqlLiteral(plan.plan_id)},'reason',expected.reason,'checked_at',${sqlLiteral(plan.checked_at)},'before_fingerprint',expected.fingerprint,'previous_is_active',actual->'is_active')) WHERE id=expected.id::uuid;
  changed:=changed+1;
 END LOOP;
 PERFORM set_config('everycoffee.airship_repair_changes',changed::text,true);
END $repair$;
SELECT jsonb_build_object('plan_id',${sqlLiteral(plan.plan_id)},'changed',current_setting('everycoffee.airship_repair_changes')::integer,'target_count',${plan.records.length});`;
 return `BEGIN;\n${body}\n${commit?'COMMIT':'ROLLBACK'};\n`;
}
if(require.main===module)process.stdout.write(repairSql());
module.exports={plan,repairSql};
