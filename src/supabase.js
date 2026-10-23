const { createClient } = require('@supabase/supabase-js');
const { config } = require('./config');

let supabaseClient = null;

function getSupabase() {
  if (!supabaseClient) {
    supabaseClient = createClient(config.supabase.url, config.supabase.serviceRoleKey,{global:{fetch:require('./crawlBudget').boundedFetch}});
  }
  return supabaseClient;
}

module.exports = { getSupabase };
