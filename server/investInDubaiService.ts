import { chromium } from 'playwright';
import { logger } from './logger.ts';

export async function scrapeInvestInDubai(query: string, maxResults: number = 20) {
  logger.info('invest_in_dubai_scrape_started', { query });
  
  const browser = await chromium.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  
  const page = await context.newPage();
  
  try {
    const maxRetries = 2;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        logger.info('invest_in_dubai_retry_attempt', { query, attempt });
        await page.waitForTimeout(2000 * attempt);
      }

      // Go to the directory page
      await page.goto('https://investindubai.gov.ae/en/business-directory', { 
        waitUntil: 'domcontentloaded',
        timeout: 60000 
      });
      
      // Wait for the search input by ID - try multiple selectors or just wait for network idle
      try {
        await page.waitForSelector('#dul-search-input', { timeout: 30000 });
      } catch (e) {
        logger.warn('invest_in_dubai_selector_timeout_trying_anyway', { query });
      }
      
      // Type the query
      const input = await page.$('#dul-search-input');
      if (input) {
        await input.fill(query);
        await page.click('.dul-search__button');
      } else {
        // Fallback: try to find any search input
        await page.keyboard.type(query);
        await page.keyboard.press('Enter');
      }
      
      // Wait for results to load
      try {
        await page.waitForSelector('.dul-search-card', { timeout: 30000 });
      } catch (e) {
        // Check if "No results" message is present
        const noResults = await page.isVisible('.no-results-message') || await page.isVisible('text=No results');
        if (noResults) {
          logger.info('invest_in_dubai_no_results_found', { query });
          return [];
        }
        throw e; // Retry if it just timed out without a "no results" message
      }
      
      // Extract results
      const results = await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('.dul-search-card'));
        return cards.map(card => {
          const name = card.querySelector('.dul-search-card__title')?.textContent?.trim() || '';
          const dulText = card.querySelector('.dul-search-card__dul')?.textContent?.trim() || 
                          card.querySelector('.dul-search-card__id')?.textContent?.trim() || '';
          const category = card.querySelector('.dul-search-card__category')?.textContent?.trim() || '';
          
          return {
            businessName: name,
            dulNumber: dulText.replace('DUL رقم', '').trim(),
            category: category,
            url: window.location.href,
            platform: 'invest_in_dubai'
          };
        });
      });
      
      logger.info('invest_in_dubai_scrape_completed', { query, count: results.length });
      return results.slice(0, maxResults);
      
    } catch (error: any) {
      if (attempt === maxRetries) {
        logger.error('invest_in_dubai_scrape_failed_after_retries', { query, error: error.message });
        return [];
      }
      logger.warn('invest_in_dubai_attempt_failed', { query, attempt, error: error.message });
    }
  }
  return [];
} catch (error: any) {
  logger.error('invest_in_dubai_fatal_error', { query, error: error.message });
  return [];
} finally {
  await browser.close();
}
}
