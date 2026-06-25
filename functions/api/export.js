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
  const m = parseInt(p[1], 10);
  const d = parseInt(p[2], 10);
  return `${m}月${d}日`;
}

function dateToSerial(iso) {
  const d = new Date(iso + 'T00:00:00');
  const base = new Date('1899-12-30T00:00:00');
  return Math.round((d - base) / (1000 * 60 * 60 * 24));
}

// Calculate longest keyword length for column width
function calcColWidth(text, isDate = false) {
  if (isDate) return 130; // "M月dd日" fits in 130px
  if (!text) return 100;
  // ~14px per CJK char, ~8px per ASCII char
  let w = 0;
  for (const ch of text) {
    w += (ch.charCodeAt(0) > 127) ? 14 : 8;
  }
  return Math.max(80, Math.min(w + 20, 300));
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
  
  // Calculate column widths
  const kwColWidth = Math.max(160, ...keywordList.map(k => calcColWidth(k)));
  const dateColWidth = Math.max(100, ...sortedDates.map(d => calcColWidth(formatDateChinese(d), true)));
  
  const H_RANK = '28.9pt';
  const H_NORMAL = '20.1pt';
  const FONT = '"等线","DengXian",sans-serif';
  const FONT_SIZE = '11pt';
  
  // Styles
  const S_DATE = `text-align:center;vertical-align:middle;font-family:${FONT};font-size:${FONT_SIZE};`;
  const S_RANK = `text-align:left;vertical-align:middle;font-family:${FONT};font-size:${FONT_SIZE};white-space:normal;word-wrap:break-word;`;
  const S_CENTER = `text-align:center;vertical-align:middle;font-family:${FONT};font-size:${FONT_SIZE};`;
  const S_SECTION = `text-align:left;vertical-align:middle;font-family:${FONT};font-size:${FONT_SIZE};font-weight:bold;background:#5B9BD5;color:#FFFFFF;`;
  const S_KW_POS = `text-align:center;vertical-align:middle;font-family:${FONT};font-size:${FONT_SIZE};`;
  const S_KW_LABEL = `text-align:left;vertical-align:middle;font-family:${FONT};font-size:${FONT_SIZE};`;

  let sheetsXml = '';
  let tablesHtml = '';

  // Scroll to last date: ActiveCol = sortedDates.length (1-indexed)
  const activeCol = sortedDates.length;
  
  for (const asin of asins) {
    const product = data[asin];
    const safeName = (product.name || asin).replace(/[\\\/\*\?\[\]:]/g, '-').substring(0, 31);
    
    sheetsXml += `<x:ExcelWorksheet><x:Name>${safeName}</x:Name><x:WorksheetOptions>
<x:FreezePanes/><x:FrozenNoSplit/>
<x:SplitHorizontal>3</x:SplitHorizontal><x:TopRowBottomPane>3</x:TopRowBottomPane>
<x:SplitVertical>1</x:SplitVertical><x:LeftColumnRightPane>1</x:LeftColumnRightPane>
<x:ActivePane>0</x:ActivePane>
<x:ActiveCol>${activeCol}</x:ActiveCol>
<x:ActiveRow>0</x:ActiveRow>
<x:DefaultRowHeight>300</x:DefaultRowHeight>
</x:WorksheetOptions></x:ExcelWorksheet>`;
    
    tablesHtml += `<table border="0" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">`;
    
    // Col definitions with calculated widths
    tablesHtml += `<col width="${kwColWidth}" style="mso-width-source:userset;"/>`;
    for (const d of sortedDates) {
      tablesHtml += `<col width="${dateColWidth}" style="mso-width-source:userset;"/>`;
    }
    for (let i = 0; i < extraCols; i++) {
      tablesHtml += `<col width="${dateColWidth}" style="mso-width-source:userset;"/>`;
    }
    
    // Row 1: Product name + dates
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
    
    // Row 2: ASIN + rank (multi-line, # starts new line)
    tablesHtml += `<tr height="28.9" style="height:${H_RANK};">`;
    tablesHtml += `<td style="${S_RANK}font-weight:bold;" x:str>${esc(asin)}</td>`;
    for (const d of sortedDates) {
      const dd = product.dates[d];
      const rank = dd ? (dd.rank || '') : '';
      // Format: replace " #" with "\n#" for multi-line
      const formattedRank = rank.replace(/\s+#/g, '\n#');
      tablesHtml += `<td style="${S_RANK}" x:str>${esc(formattedRank)}</td>`;
    }
    for (let i = 0; i < extraCols; i++) {
      tablesHtml += `<td style="${S_RANK}"></td>`;
    }
    tablesHtml += `</tr>\n`;
    
    // Row 3: Rating / Review count
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
    
    // 自然位 section
    tablesHtml += `<tr height="20.1" style="height:${H_NORMAL};">`;
    tablesHtml += `<td style="${S_SECTION}" x:str>自然位-精准词</td>`;
    for (let i = 0; i < sortedDates.length + extraCols; i++) {
      tablesHtml += `<td style="${S_SECTION}"></td>`;
    }
    tablesHtml += `</tr>\n`;
    
    for (const kw of keywordList) {
      tablesHtml += `<tr height="20.1" style="height:${H_NORMAL};">`;
      tablesHtml += `<td style="${S_KW_LABEL}" x:str>${esc(kw)}</td>`;
      for (const d of sortedDates) {
        const dd = product.dates[d];
        const pos = (dd && dd.keywords[kw]) ? dd.keywords[kw].n : '';
        tablesHtml += `<td style="${S_KW_POS}" x:str>${pos}</td>`;
      }
      for (let i = 0; i < extraCols; i++) {
        tablesHtml += `<td style="${S_KW_POS}"></td>`;
      }
      tablesHtml += `</tr>\n`;
    }
    
    // Separator
    tablesHtml += `<tr height="15.75" style="height:15.75pt;"><td></td>`;
    for (let i = 0; i < sortedDates.length + extraCols; i++) tablesHtml += `<td></td>`;
    tablesHtml += `</tr>\n`;
    
    // 广告位 section
    tablesHtml += `<tr height="20.1" style="height:${H_NORMAL};">`;
    tablesHtml += `<td style="${S_SECTION}" x:str>广告位-精准词</td>`;
    for (let i = 0; i < sortedDates.length + extraCols; i++) {
      tablesHtml += `<td style="${S_SECTION}"></td>`;
    }
    tablesHtml += `</tr>\n`;
    
    for (const kw of keywordList) {
      tablesHtml += `<tr height="20.1" style="height:${H_NORMAL};">`;
      tablesHtml += `<td style="${S_KW_LABEL}" x:str>${esc(kw)}</td>`;
      for (const d of sortedDates) {
        const dd = product.dates[d];
        const pos = (dd && dd.keywords[kw]) ? dd.keywords[kw].a : '';
        tablesHtml += `<td style="${S_KW_POS}" x:str>${pos}</td>`;
      }
      for (let i = 0; i < extraCols; i++) {
        tablesHtml += `<td style="${S_KW_POS}"></td>`;
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
