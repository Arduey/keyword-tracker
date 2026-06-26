// GET /api/export — Generate Excel HTML file
export async function onRequest(context) {
  const { request, env } = context;
  const db = env.DB;
  const url = new URL(request.url);
  const asinFilter = url.searchParams.get('asin') || '';

  let products, rankings;
  if (asinFilter) {
    products = await db.prepare('SELECT * FROM products WHERE asin = ?').bind(asinFilter).all();
    rankings = await db.prepare('SELECT * FROM rankings WHERE asin = ? ORDER BY date, keyword').bind(asinFilter).all();
  } else {
    products = await db.prepare('SELECT * FROM products ORDER BY asin').all();
    rankings = await db.prepare('SELECT * FROM rankings ORDER BY asin, date, keyword').all();
  }

  const data = {};
  for (const p of products.results) data[p.asin] = { name: p.name, dates: {} };
  for (const r of rankings.results) {
    if (!data[r.asin]) continue;
    if (!data[r.asin].dates[r.date]) {
      data[r.asin].dates[r.date] = { rating: r.rating, reviewCount: r.review_count, rank: r.rank, keywords: {} };
    }
    data[r.asin].dates[r.date].keywords[r.keyword] = { n: r.natural_pos, a: r.ad_pos };
  }

  const html = generateSheetHtml(data);
  
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=UTF-8',
      'Content-Disposition': "attachment; filename*=UTF-8''%E5%85%B3%E9%94%AE%E8%AF%8D%E8%AE%B0%E5%BD%95.xls"
    }
  });
}

function formatDateChinese(iso) {
  const p = iso.split('-');
  if (p.length !== 3) return iso;
  return parseInt(p[1]) + '\u6708' + parseInt(p[2]) + '\u65E5';
}

function dateToSerial(iso) {
  const d = new Date(iso + 'T00:00:00');
  const base = new Date('1899-12-30T00:00:00');
  return Math.round((d - base) / (1000 * 60 * 60 * 24));
}

function generateSheetHtml(data) {
  const asins = Object.keys(data).sort();
  const allKeywords = new Set();
  const allDates = new Set();
  for (const asin of asins) {
    for (const [d, dd] of Object.entries(data[asin].dates)) {
      allDates.add(d);
      for (const kw of Object.keys(dd.keywords)) allKeywords.add(kw);
    }
  }
  const keywordList = [...allKeywords].sort();
  const sortedDates = [...allDates].sort();
  const extraCols = 5;
  const totalCols = 1 + sortedDates.length + extraCols;
  
  const FONT = '"DengXian",sans-serif';
  const FS = '11pt';
  const H_RANK = '28.9pt';
  const H_NORM = '20.1pt';
  const S_DATE = `text-align:center;vertical-align:middle;font-family:${FONT};font-size:${FS};`;
  const S_RANK = `text-align:left;vertical-align:middle;font-family:${FONT};font-size:${FS};white-space:normal;`;
  const S_CENTER = `text-align:center;vertical-align:middle;font-family:${FONT};font-size:${FS};`;
  const S_SEC = `text-align:left;vertical-align:middle;font-family:${FONT};font-size:${FS};font-weight:bold;background:#5B9BD5;color:#FFFFFF;`;
  const S_KW_POS = `text-align:center;vertical-align:middle;font-family:${FONT};font-size:${FS};`;
  const S_KW = `text-align:left;vertical-align:middle;font-family:${FONT};font-size:${FS};`;

  let html = `<table border="0" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">`;
  
  // Header row: dates
  html += `<tr height="20.1" style="height:${H_NORM};"><td></td>`;
  for (const d of sortedDates) html += `<td style="${S_DATE}" x:num="${dateToSerial(d)}.">${formatDateChinese(d)}</td>`;
  for (let i = 0; i < extraCols; i++) html += `<td style="${S_DATE}"></td>`;
  html += `</tr>\n`;

  for (const asin of asins) {
    const product = data[asin];
    
    // Product separator
    html += `<tr height="20.1" style="height:${H_NORM};"><td style="${S_DATE}font-weight:bold;background:#4472C4;color:#fff;" colspan="${totalCols}" x:str>${esc(product.name)} (${esc(asin)})</td></tr>\n`;
    
    // Rank
    html += `<tr height="28.9" style="height:${H_RANK};"><td style="text-align:left;vertical-align:middle;font-family:${FONT};font-size:${FS};font-weight:bold;">Rank</td>`;
    for (const d of sortedDates) {
      const dd = product.dates[d];
      let rank = dd ? (dd.rank || '') : '';
      rank = rank.replace(/(.)#(\d)/g, '$1<br>#$2');
      html += `<td style="${S_RANK}">${rank}</td>`;
    }
    for (let i = 0; i < extraCols; i++) html += `<td style="${S_RANK}"></td>`;
    html += `</tr>\n`;

    // Rating
    html += `<tr height="20.1" style="height:${H_NORM};"><td style="${S_CENTER}">评分/评论</td>`;
    for (const d of sortedDates) {
      const dd = product.dates[d];
      html += `<td style="${S_CENTER}" x:str>${dd ? dd.rating + ' - ' + dd.reviewCount : ''}</td>`;
    }
    for (let i = 0; i < extraCols; i++) html += `<td style="${S_CENTER}"></td>`;
    html += `</tr>\n`;

    // Natural
    html += `<tr height="20.1" style="height:${H_NORM};"><td style="${S_SEC}" colspan="${totalCols}" x:str>自然位-精准词</td></tr>\n`;
    for (const kw of keywordList) {
      html += `<tr height="20.1" style="height:${H_NORM};"><td style="${S_KW}" x:str>${esc(kw)}</td>`;
      for (const d of sortedDates) {
        const dd = product.dates[d];
        html += `<td style="${S_KW_POS}" x:str>${(dd && dd.keywords[kw]) ? dd.keywords[kw].n : ''}</td>`;
      }
      for (let i = 0; i < extraCols; i++) html += `<td style="${S_KW_POS}"></td>`;
      html += `</tr>\n`;
    }

    // Ad
    html += `<tr height="20.1" style="height:${H_NORM};"><td style="${S_SEC}" colspan="${totalCols}" x:str>广告位-精准词</td></tr>\n`;
    for (const kw of keywordList) {
      html += `<tr height="20.1" style="height:${H_NORM};"><td style="${S_KW}" x:str>${esc(kw)}</td>`;
      for (const d of sortedDates) {
        const dd = product.dates[d];
        html += `<td style="${S_KW_POS}" x:str>${(dd && dd.keywords[kw]) ? dd.keywords[kw].a : ''}</td>`;
      }
      for (let i = 0; i < extraCols; i++) html += `<td style="${S_KW_POS}"></td>`;
      html += `</tr>\n`;
    }

    // Empty separator
    html += `<tr height="10" style="height:7.5pt;"><td colspan="${totalCols}" style="background:#f0f0f0;"></td></tr>\n`;
  }

  html += `</table>`;

  const activeCol = sortedDates.length;
  return `<!DOCTYPE html>
<html xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
<meta name="ProgId" content="Excel.Sheet">
<meta name="Generator" content="Keyword Rank Tracker">
<style>@page {margin:1.00in 0.75in 1.00in 0.75in; mso-header-margin:0.50in; mso-footer-margin:0.50in;}</style>
<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets>
<x:ExcelWorksheet><x:Name>关键词记录</x:Name><x:WorksheetOptions>
<x:FreezePanes/><x:FrozenNoSplit/>
<x:SplitHorizontal>1</x:SplitHorizontal><x:TopRowBottomPane>1</x:TopRowBottomPane>
<x:SplitVertical>1</x:SplitVertical><x:LeftColumnRightPane>1</x:LeftColumnRightPane>
<x:ActivePane>0</x:ActivePane>
<x:ActiveCol>${activeCol}</x:ActiveCol><x:ActiveRow>0</x:ActiveRow>
<x:DefaultRowHeight>300</x:DefaultRowHeight>
</x:WorksheetOptions></x:ExcelWorksheet>
</x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
</head>
<body>
${html}
</body>
</html>`;
}

function esc(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
