import { chromium } from 'playwright';

async function measureInitialLoad() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  const requests = [];
  page.on('request', request => {
    if (request.url().includes('.js') || request.url().includes('.css')) {
      requests.push({
        url: request.url(),
        resourceType: request.resourceType(),
        method: request.method()
      });
    }
  });
  
  const responses = [];
  page.on('response', async response => {
    if (response.url().includes('.js') || response.url().includes('.css')) {
      const headers = response.headers();
      let bodySize = 0;
      try {
        const body = await response.body();
        bodySize = body.length;
      } catch (e) {
        bodySize = parseInt(headers['content-length']) || 0;
      }
      responses.push({
        url: response.url(),
        status: response.status(),
        contentLength: headers['content-length'] || 'unknown',
        bodySize: bodySize,
        contentType: headers['content-type'] || 'unknown'
      });
    }
  });
  
  console.log('Navigating to http://localhost:4173...');
  await page.goto('http://localhost:4173', { waitUntil: 'networkidle' });
  
  console.log('\n=== JS/CSS Requests ===');
  for (const req of requests) {
    console.log(`${req.resourceType.toUpperCase()}: ${req.url}`);
  }
  
  console.log('\n=== JS/CSS Responses ===');
  let totalBytes = 0;
  for (const res of responses) {
    totalBytes += res.bodySize;
    console.log(`${res.status} ${res.contentType} ${res.bodySize} bytes (header: ${res.contentLength}) - ${res.url}`);
  }
  
  console.log(`\n=== Total Initial JS/CSS Payload: ${totalBytes} bytes (${(totalBytes / 1024).toFixed(1)} KB) ===`);
  
  await browser.close();
}

measureInitialLoad().catch(console.error);