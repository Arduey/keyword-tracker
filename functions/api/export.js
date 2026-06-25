// GET /api/export — Generate Excel HTML file matching the reference template format
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
  for (const p of products.results) {
    data[p.asin] = { name: p.name, dates: {} };
  }
  for (const r of rankings.results) {
    if (!data[r.asin]) continue;
    if (!data[r.asin].dates[r.date]) {
      data[r.asin].dates[r.date] = { rating: r.rating, reviewCount: r.review_count, rank: r.rank, keywords: {} };
    }
    data[r.asin].dates[r.date].keywords[r.keyword] = { n: r.natural_pos, a: r.ad_pos };
  }

  const html = generateMultiSheetHtml(data);
  
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=UTF-8',
      'Content-Disposition': 'attachment; filename="keyword-rankings.xls"'
    }
  });
}

function formatDateChinese(iso) {
  const p = iso.split('-');
  if (p.length !== 3) return iso;
  return parseInt(p[1]) + '月' + parseInt(p[2]) + '日';
}

// Excel serial date number (for x:num display)
function dateToSerial(iso) {
  const d = new Date(iso + 'T00:00:00');
  // Excel epoch is 1900-01-01 = serial 1, but with the leap year bug
  // Using 1899-12-30 as baseline
  const base = new Date('1899-12-30T00:00:00');
  return Math.round((d - base) / (1000 * 60 * 60 * 24));
}

function generateMultiSheetHtml(data) {
  const asins = Object.keys(data).sort();
  
  // Collect all keywords and dates
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
  const extraCols = 20;
  const totalCols = 1 + sortedDates.length + extraCols;
  
  // Heights: rank row = 1.02cm ≈ 28.9pt, normal row = 0.71cm ≈ 20.1pt
  const H_RANK = '28.9pt';
  const H_NORMAL = '20.1pt';
  
  // Common styles
  const S_DATE = 'text-align:center;vertical-align:middle;font-family:"等线","DengXian",sans-serif;font-size:11pt;';
  const S_RANK = 'text-align:left;vertical-align:middle;font-family:"等线","DengXian",sans-serif;font-size:11pt;';
  const S_CENTER = 'text-align:center;vertical-align:middle;font-family:"等线","DengXian",sans-serif;font-size:11pt;';
  const S_SECTION = 'text-align:left;vertical-align:middle;font-family:"等线","DengXian",sans-serif;font-size:11pt;font-weight:bold;background:#F2F2F2;';
  const S_KW = 'text-align:center;vertical-align:middle;font-family:"等线","DengXian",sans-serif;font-size:11pt;';

  let sheetsXml = '';
  let tablesHtml = '';
  
  for (const asin of asins) {
    const product = data[asin];
    const safeName = (product.name || asin).replace(/[\\\/\*\?\[\]:]/g, '-').substring(0, 31);
    
    sheetsXml += `<x:ExcelWorksheet><x:Name>${safeName}</x:Name><x:WorksheetOptions>
<x:FreezePanes/><x:FrozenNoSplit/>
<x:SplitHorizontal>3</x:SplitHorizontal><x:TopRowBottomPane>3</x:TopRowBottomPane>
<x:SplitVertical>1</x:SplitVertical><x:LeftColumnRightPane>1</x:LeftColumnRightPane>
<x:ActivePane>0</x:ActivePane>
<x:DefaultRowHeight>300</x:DefaultRowHeight>
</x:WorksheetOptions></x:ExcelWorksheet>`;
    
    tablesHtml += `<table border="0" cellpadding="0" cellspacing="0" style="border-collapse:collapse;table-layout:fixed;">`;
    
    // Col definitions
    tablesHtml += `<col width="180" style="mso-width-source:userset;"/>`;
    for (let i = 0; i < sortedDates.length; i++) {
      tablesHtml += `<col width="150" style="mso-width-source:userset;"/>`;
    }
    for (let i = 0; i < extraCols; i++) {
      tablesHtml += `<col width="150" style="mso-width-source:userset;"/>`;
    }
    
    // === Row 1: Product name + dates ===
    tablesHtml += `<tr height="20.1" style="height:${H_NORMAL};">`;
    tablesHtml += `<td style="${S_DATE}font-weight:bold;" x:str>${esc(product.name)}</td>`;
    for (const d of sortedDates) {
      const serial = dateToSerial(d);
      tablesHtml += `<td style="${S_DATE}" x:num="${serial}.">${formatDateChinese(d)}</td>`;
    }
    for (let i = 0; i < extraCols; i++) {
      tablesHtml += `<td style="${S_DATE}"></td>`;
    }
    tablesHtml += `</tr>\n`;
    
    // === Row 2: ASIN + rank data (height 1.02cm) ===
    tablesHtml += `<tr height="28.9" style="height:${H_RANK};">`;
    tablesHtml += `<td style="${S_RANK}font-weight:bold;" x:str>${esc(asin)}</td>`;
    for (const d of sortedDates) {
      const dd = product.dates[d];
      const rank = dd ? (dd.rank || '') : '';
      tablesHtml += `<td style="${S_RANK}" x:str>${esc(rank)}</td>`;
    }
    for (let i = 0; i < extraCols; i++) {
      tablesHtml += `<td style="${S_RANK}"></td>`;
    }
    tablesHtml += `</tr>\n`;
    
    // === Row 3: Rating / Review count ===
    tablesHtml += `<tr height="20.1" style="height:${H_NORMAL};">`;
    tablesHtml += `<td style="${S_CENTER}"></td>`;
    for (const d of sortedDates) {
      const dd = product.dates[d];
      const txt = dd ? `${dd.rating} - ${dd.reviewCount}` : '';
      tablesHtml += `<td style="${S_CENTER}" x:str>${txt}</td>`;
    }
    for (let i = 0; i < extraCols; i++) {
      tablesHtml += `<td style="${S_CENTER}"></td>`;
    }
    tablesHtml += `</tr>\n`;
    
    // === 自然位-精准词 Section ===
    tablesHtml += `<tr height="20.1" style="height:${H_NORMAL};">`;
    tablesHtml += `<td style="${S_SECTION}" x:str>自然位-精准词</td>`;
    for (let i = 0; i < sortedDates.length + extraCols; i++) {
      tablesHtml += `<td style="${S_SECTION}"></td>`;
    }
    tablesHtml += `</tr>\n`;
    
    for (const kw of keywordList) {
      tablesHtml += `<tr height="20.1" style="height:${H_NORMAL};">`;
      tablesHtml += `<td style="${S_RANK}" x:str>${esc(kw)}</td>`;
      for (const d of sortedDates) {
        const dd = product.dates[d];
        const pos = (dd && dd.keywords[kw]) ? dd.keywords[kw].n : '';
        tablesHtml += `<td style="${S_KW}" x:str>${pos}</td>`;
      }
      for (let i = 0; i < extraCols; i++) {
        tablesHtml += `<td style="${S_KW}"></td>`;
      }
      tablesHtml += `</tr>\n`;
    }
    
    // Separator
    tablesHtml += `<tr height="15.75" style="height:15.75pt;">`;
    tablesHtml += `<td></td>`;
    for (let i = 0; i < sortedDates.length + extraCols; i++) {
      tablesHtml += `<td></td>`;
    }
    tablesHtml += `</tr>\n`;
    
    // === 广告位-精准词 Section ===
    tablesHtml += `<tr height="20.1" style="height:${H_NORMAL};">`;
    tablesHtml += `<td style="${S_SECTION}" x:str>广告位-精准词</td>`;
    for (let i = 0; i < sortedDates.length + extraCols; i++) {
      tablesHtml += `<td style="${S_SECTION}"></td>`;
    }
    tablesHtml += `</tr>\n`;
    
    for (const kw of keywordList) {
      tablesHtml += `<tr height="20.1" style="height:${H_NORMAL};">`;
      tablesHtml += `<td style="${S_RANK}" x:str>${esc(kw)}</td>`;
      for (const d of sortedDates) {
        const dd = product.dates[d];
        const pos = (dd && dd.keywords[kw]) ? dd.keywords[kw].a : '';
        tablesHtml += `<td style="${S_KW}" x:str>${pos}</td>`;
      }
      for (let i = 0; i < extraCols; i++) {
        tablesHtml += `<td style="${S_KW}"></td>`;
      }
      tablesHtml += `</tr>\n`;
    }
    
    tablesHtml += `</table>\n`;
  }
  
  return `<!DOCTYPE html>
<html xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
<meta name="ProgId" content="Excel.Sheet">
<meta name="Generator" content="Keyword Rank Tracker">
<style>@page {margin:1.00in 0.75in 1.00in 0.75in; mso-header-margin:0.50in; mso-footer-margin:0.50in;}</style>
<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets>
${sheetsXml}
</x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
</head>
<body>
${tablesHtml}
</body>
</html>`;
}

function esc(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
