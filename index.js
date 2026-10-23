const fs = require('fs');
const path = require('path');
const { validateConfig } = require('./src/config');
const logger = require('./src/logger');

function displayAsciiArt(filename) {
  try {
    const filePath = path.join(__dirname, 'src', 'ascii', filename);
    const art = fs.readFileSync(filePath, 'utf8');
    if (art.trim()) {
      console.log(art);
    }
  } catch (err) {
  }
}

async function main() {
  const maximum=require('./src/crawlBudget').limits().batchMs;
  const hardStop=setTimeout(()=>{logger.error('Main','Hard batch time limit reached; terminating without claiming completion');process.exit(124);},maximum);
  hardStop.unref();
  displayAsciiArt('start.txt');
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
    const { getOpenAIConfigSummary } = require('./src/gptClassifier');
    const { runCrawler } = require('./src/crawler');

    logger.info('OpenAI', 'Configuration summary', getOpenAIConfigSummary());

    const result = await runCrawler();
    
    logger.header(result.incomplete?'Crawl Batch Time Limit Reached':'Crawler Finished');
    logger[result.incomplete?'warn':'success']('Main',result.incomplete?'Batch stopped; unfinished roasters remain deferred':'Crawl completed', {
      roastersCrawled: result.roastersCrawled,
      roastersDeferred:result.roastersDeferred || 0,
      timestamp: new Date().toISOString(),
    });

    if (result.results) {
      const totalUrls = result.results
        .filter(r => r.success)
        .reduce((sum, r) => sum + (r.stats?.total || 0), 0);
      
      logger.info('Main', 'Total URLs discovered across all roasters', { count: totalUrls });
    }

    displayAsciiArt('end.txt');

  } catch (error) {
    logger.error('Main', 'Crawler failed', { 
      message: error.message,
      stack: error.stack 
    });
    process.exit(1);
  }
}

main();
