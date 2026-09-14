/* Render the HTML documents in this folder to PDF with headless Chrome.
 * Usage: node docs/render-pdf.cjs   (requires Chrome and client/node_modules/puppeteer-core) */
const path = require('path');
const fs = require('fs');
const puppeteer = require(path.join(__dirname, '..', 'client', 'node_modules', 'puppeteer-core'));

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const DOCS = [
  { html: 'telecaller-guide.html', pdf: 'Atlas-Analytics-Telecaller-Guide.pdf', title: 'Atlas Analytics · Telecaller Guide' },
  { html: 'client-overview.html', pdf: 'Atlas-Analytics-Product-Overview.pdf', title: 'Atlas Analytics · Product Overview' },
];

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  for (const d of DOCS) {
    const page = await browser.newPage();
    await page.goto(`file:///${path.join(__dirname, d.html).replace(/\\/g, '/')}`, { waitUntil: 'networkidle0' });
    await page.pdf({
      path: path.join(__dirname, d.pdf),
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: `<div style="width:100%;font-size:7.5px;color:#94a3b8;padding:0 16mm;display:flex;justify-content:space-between;font-family:Segoe UI,Arial"><span>${d.title}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`,
      margin: { top: '18mm', right: '16mm', bottom: '20mm', left: '16mm' },
    });
    const size = fs.statSync(path.join(__dirname, d.pdf)).size;
    console.log(`${d.pdf}: ${(size / 1024).toFixed(0)} KB`);
    await page.close();
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
