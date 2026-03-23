import { logger } from './logger';

let chromium: any = null;
try {
  chromium = (await import('playwright')).chromium;
} catch {
  logger.warn('playwright_not_available', { message: 'Playwright not installed or Chromium unavailable. Invest in Dubai scraping disabled.' });
}

export async function scrapeInvestInDubai(query: string, maxResults: number = 20) {
  if (!chromium) {
    logger.warn('invest_in_dubai_skipped', { reason: 'Playwright not available' });
    return [];
  }

  logger.info('invest_in_dubai_scrape_started', { query });

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
  } catch (error: any) {
    logger.warn('invest_in_dubai_browser_launch_failed', { error: error.message });
    return [];
  }

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });

  const page = await context.newPage();

  try {
    await page.goto('https://investindubai.gov.ae/en/business-directory', {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    await page.waitForSelector('#dul-search-input', { timeout: 15000 });
    await page.fill('#dul-search-input', query);
    await page.click('.dul-search__button');

    try {
      await page.waitForSelector('.dul-search-card', { timeout: 15000 });
    } catch (e) {
      logger.warn('invest_in_dubai_timeout_waiting_for_results', { query });
    }

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
    logger.error('invest_in_dubai_scrape_failed', { query, error: error.message });
    return [];
  } finally {
    await browser.close();
  }
}
