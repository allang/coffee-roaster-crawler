const { validateConfig } = require('./src/config');
const { runCrawler } = require('./src/crawler');
const logger = require('./src/logger');

async function main() {
  logger.header('Coffee Roaster Crawler');
  logger.info('Main', 'Initializing...');

  try {
    validateConfig();
    logger.success('Main', 'Configuration validated');
  } catch (error) {
    logger.error('Main', 'Configuration error', { message: error.message });
    process.exit(1);
  }

  try {
    const result = await runCrawler();
    
    logger.header('Crawler Finished');
    logger.success('Main', 'Crawl completed', {
      roastersCrawled: result.roastersCrawled,
      timestamp: new Date().toISOString(),
    });

    if (result.results) {
      const totalUrls = result.results
        .filter(r => r.success)
        .reduce((sum, r) => sum + (r.stats?.total || 0), 0);
      
      logger.info('Main', 'Total URLs discovered across all roasters', { count: totalUrls });
    }

  } catch (error) {
    logger.error('Main', 'Crawler failed', { 
      message: error.message,
      stack: error.stack 
    });
    process.exit(1);
  }
}

main();
