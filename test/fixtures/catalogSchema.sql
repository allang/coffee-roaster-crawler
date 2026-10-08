-- Sanitized structural fixture grounded in the 2026-10-06 read-only REST schema.
create role anon; create role authenticated; create role service_role bypassrls;
create table entities(id uuid primary key);
create table products (
  id uuid primary key default gen_random_uuid(),entity_id uuid not null references entities(id),slug text not null,name text not null,
  product_type text not null default 'coffee',source_url text,is_active boolean not null default true,first_seen_at timestamptz,last_seen_at timestamptz,
  metadata jsonb,description_html text,description_raw text,description text,short_description text,nano_description text,original_image_url text,country_of_origin text,origin_region text,
  is_available boolean not null default true,availability_reason text,availability_checked_at timestamptz,availability_last_seen_at timestamptz,
  created_at timestamptz default now(),updated_at timestamptz default now(),unique(entity_id,slug));
create table product_variants (
  id uuid primary key default gen_random_uuid(),product_id uuid not null references products(id),variant_name text,weight_g integer,price_cents integer,
  currency text not null,availability text not null default 'unknown',created_at timestamptz default now(),updated_at timestamptz default now());
create table coffee_facts (
  product_id uuid primary key references products(id),origin_hub_id uuid,process text,variety text,elevation_m integer,roast_level text,tasting_notes_raw text,decaf boolean,
  created_at timestamptz default now(),updated_at timestamptz default now());
create table media_assets(id uuid primary key default gen_random_uuid(),url text not null,content_hash text,width integer,height integer,created_at timestamptz default now());
create table product_media(product_id uuid references products(id),media_asset_id uuid references media_assets(id),sort_order integer default 0,created_at timestamptz default now(),primary key(product_id,media_asset_id));
create table known_pages(id uuid primary key default gen_random_uuid(),entity_id uuid references entities(id),url text not null,status text,classification jsonb,reason text,blacklisted_match text,last_classified_at timestamptz,last_classified_by text,last_fetched_at timestamptz,last_status_code integer,last_content_hash text,first_seen_at timestamptz default now(),last_seen_at timestamptz default now(),times_seen integer default 1,unique(entity_id,url));
grant usage on schema public to anon,authenticated,service_role;
grant all on all tables in schema public to service_role;
