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

  const html = generateMultiSheetHtml(data);
  
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=UTF-8',
      'Content-Disposition': 'attachment; filename="\u5173\u952E\u8BCD\u8BB0\u5F55.xls"'
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

function calcColWidth(text, isDate) {
  if (isDate) return 120;
  if (!text) return 100;
  let w = 0;
  for (const ch of text) w += (ch.charCodeAt(0) > 127) ? 14 : 8;
  return Math.max(80, Math.min(w + 20, 280));
}

function generateMultiSheetHtml(data) {
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
  
  const kwColWidth = Math.max(160, ...keywordList.map(k => calcColWidth(k)));
  const dateColWidth = Math.max(100, ...sortedDates.map(d => calcColWidth(formatDateChinese(d), true)));
  
  const DENGXIAN = String.fromCodePoint(0x7B49, 0x7EBF);
  const FONT = '"' + DENGXIAN + '","DengXian",sans-serif';
  const FS = '11pt';
  const H_RANK = '28.9pt';
  const H_NORM = '20.1pt';
  
  let sheetsXml = '';
  let tablesHtml = '';
  const activeCol = sortedDates.length;

  for (const asin of asins) {
    const product = data[asin];
    const safeName = (product.name || asin).replace(/[\\\/\*\?\[\]:]/g, '-').substring(0, 31);
    
    sheetsXml += `<x:ExcelWorksheet><x:Name>${safeName}</x:Name><x:WorksheetOptions>
<x:FreezePanes/><x:FrozenNoSplit/>
<x:SplitHorizontal>3</x:SplitHorizontal><x:TopRowBottomPane>3</x:TopRowBottomPane>
<x:SplitVertical>1</x:SplitVertical><x:LeftColumnRightPane>1</x:LeftColumnRightPane>
<x:ActivePane>0</x:ActivePane>
<x:ActiveCol>${activeCol}</x:ActiveCol><x:ActiveRow>0</x:ActiveRow>
<x:DefaultRowHeight>300</x:DefaultRowHeight>
</x:WorksheetOptions></x:ExcelWorksheet>`;
    
    tablesHtml += `<table border="0" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">`;
    tablesHtml += `<col width="${kwColWidth}" style="mso-width-source:userset;"/>`;
    for (const d of sortedDates) tablesHtml += `<col width="${dateColWidth}" style="mso-width-source:userset;"/>`;
    for (let i = 0; i < extraCols; i++) tablesHtml += `<col width="${dateColWidth}" style="mso-width-source:userset;"/>`;
    
    // Row 1: Product + dates
    tablesHtml += `<tr height="20.1" style="height:${H_NORM};"><td style="text-align:center;vertical-align:middle;font-family:${FONT};font-size:${FS};font-weight:bold;" x:str>${esc(product.name)}</td>`;
    for (const d of sortedDates) {
      tablesHtml += `<td style="text-align:center;vertical-align:middle;font-family:${FONT};font-size:${FS};" x:num="${dateToSerial(d)}.">${formatDateChinese(d)}</td>`;
    }
    for (let i = 0; i < extraCols; i++) tablesHtml += `<td style="text-align:center;vertical-align:middle;font-family:${FONT};font-size:${FS};"></td>`;
    tablesHtml += `</tr>\n`;
    
    // Row 2: ASIN + rank (multi-line, # starts new line via <br>)
    tablesHtml += `<tr height="28.9" style="height:${H_RANK};"><td style="text-align:left;vertical-align:middle;font-family:${FONT};font-size:${FS};font-weight:bold;" x:str>${esc(asin)}</td>`;
    for (const d of sortedDates) {
      const dd = product.dates[d];
      let rank = dd ? (dd.rank || '') : '';
      rank = rank.replace(/(.)#(\d)/g, '$1<br>#$2');
      tablesHtml += `<td style="text-align:left;vertical-align:middle;font-family:${FONT};font-size:${FS};white-space:normal;">${rank}</td>`;
    }
    for (let i = 0; i < extraCols; i++) tablesHtml += `<td style="text-align:left;vertical-align:middle;font-family:${FONT};font-size:${FS};"></td>`;
    tablesHtml += `</tr>\n`;
    
    // Row 3: Rating / Review
    tablesHtml += `<tr height="20.1" style="height:${H_NORM};"><td style="text-align:center;vertical-align:middle;font-family:${FONT};font-size:${FS};"></td>`;
    for (const d of sortedDates) {
      const dd = product.dates[d];
      tablesHtml += `<td style="text-align:center;vertical-align:middle;font-family:${FONT};font-size:${FS};" x:str>${dd ? dd.rating + ' - ' + dd.reviewCount : ''}</td>`;
    }
    for (let i = 0; i < extraCols; i++) tablesHtml += `<td style="text-align:center;vertical-align:middle;font-family:${FONT};font-size:${FS};"></td>`;
    tablesHtml += `</tr>\n`;
    
    // Natural section
    const S_SEC = `text-align:left;vertical-align:middle;font-family:${FONT};font-size:${FS};font-weight:bold;background:#5B9BD5;color:#FFFFFF;`;
    tablesHtml += `<tr height="20.1" style="height:${H_NORM};"><td style="${S_SEC}" x:str>自然位-精准词</td>`;
    for (let i = 0; i < sortedDates.length + extraCols; i++) tablesHtml += `<td style="${S_SEC}"></td>`;
    tablesHtml += `</tr>\n`;
    
    for (const kw of keywordList) {
      tablesHtml += `<tr height="20.1" style="height:${H_NORM};"><td style="text-align:left;vertical-align:middle;font-family:${FONT};font-size:${FS};" x:str>${esc(kw)}</td>`;
      for (const d of sortedDates) {
        const dd = product.dates[d];
        const pos = (dd && dd.keywords[kw]) ? dd.keywords[kw].n : '';
        tablesHtml += `<td style="text-align:center;vertical-align:middle;font-family:${FONT};font-size:${FS};" x:str>${pos}</td>`;
      }
      for (let i = 0; i < extraCols; i++) tablesHtml += `<td style="text-align:center;vertical-align:middle;font-family:${FONT};font-size:${FS};"></td>`;
      tablesHtml += `</tr>\n`;
    }
    
    tablesHtml += `<tr height="15.75" style="height:15.75pt;"><td></td>`;
    for (let i = 0; i < sortedDates.length + extraCols; i++) tablesHtml += `<td></td>`;
    tablesHtml += `</tr>\n`;
    
    // Ad section
    tablesHtml += `<tr height="20.1" style="height:${H_NORM};"><td style="${S_SEC}" x:str>广告位-精准词</td>`;
    for (let i = 0; i < sortedDates.length + extraCols; i++) tablesHtml += `<td style="${S_SEC}"></td>`;
    tablesHtml += `</tr>\n`;
    
    for (const kw of keywordList) {
      tablesHtml += `<tr height="20.1" style="height:${H_NORM};"><td style="text-align:left;vertical-align:middle;font-family:${FONT};font-size:${FS};" x:str>${esc(kw)}</td>`;
      for (const d of sortedDates) {
        const dd = product.dates[d];
        const pos = (dd && dd.keywords[kw]) ? dd.keywords[kw].a : '';
        tablesHtml += `<td style="text-align:center;vertical-align:middle;font-family:${FONT};font-size:${FS};" x:str>${pos}</td>`;
      }
      for (let i = 0; i < extraCols; i++) tablesHtml += `<td style="text-align:center;vertical-align:middle;font-family:${FONT};font-size:${FS};"></td>`;
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
