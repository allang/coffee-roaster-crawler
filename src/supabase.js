const { createClient } = require('@supabase/supabase-js');
const { config } = require('./config');
const logger = require('./logger');

let supabaseClient = null;

function getSupabase() {
  if (!supabaseClient) {
    logger.debug('Supabase', 'Initializing Supabase client', { url: config.supabase.url });
    supabaseClient = createClient(config.supabase.url, config.supabase.serviceRoleKey);
    logger.success('Supabase', 'Client initialized successfully');
  }
  return supabaseClient;
}

module.exports = { getSupabase };
