const config = {
  supabase: {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  },
  crawler: {
    requestDelayMs: 500,
    requestTimeoutMs: 30000,
    maxSitemapsPerEntity: 50,
    userAgent: 'CoffeeCrawler/1.0 (+https://example.com/bot)',
  },
};

function validateConfig() {
  const missing = [];
  if (!config.supabase.url) missing.push('NEXT_PUBLIC_SUPABASE_URL');
  if (!config.supabase.serviceRoleKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

module.exports = { config, validateConfig };
