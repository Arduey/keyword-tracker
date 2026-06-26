// keyword-tracker frontend app

let pendingData = null;
let allData = {};
let activeTab = null;
let deleteTarget = { asin: null, date: null };
let authToken = localStorage.getItem('kw_auth') || '';

// ========== Auth ==========
async function checkAuth() {
  if (authToken) {
    try {
      const resp = await fetch('/api/data', { headers: { 'X-Auth': authToken } });
      if (resp.ok) { showMain(); return; }
    } catch(e) {}
  }
  document.getElementById('loginOverlay').style.display = 'flex';
  document.getElementById('mainApp').style.display = 'none';
}

async function verifyPassword() {
  const pwd = document.getElementById('passwordInput').value.trim();
  if (!pwd) return;
  try {
    const resp = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pwd })
    });
    const data = await resp.json();
    if (data.ok) {
      authToken = data.token;
      if (document.getElementById('rememberPwd').checked) {
        localStorage.setItem('kw_auth', authToken);
      }
      document.getElementById('loginOverlay').style.display = 'none';
      document.getElementById('loginError').style.display = 'none';
      showMain();
    } else {
      document.getElementById('loginError').style.display = 'block';
    }
  } catch(e) {
    document.getElementById('loginError').style.display = 'block';
  }
}

function showMain() {
  document.getElementById('loginOverlay').style.display = 'none';
  document.getElementById('mainApp').style.display = 'block';
  refreshData();
}

// ========== Data Loading ==========

async function refreshData() {
  try {
    const resp = await fetch('/api/data', { headers: { 'X-Auth': authToken } });
    if (!resp.ok) { authToken = ''; localStorage.removeItem('kw_auth'); checkAuth(); return; }
    allData = await resp.json();
    renderTabs();
    renderPreview();
    document.getElementById('statusBar').textContent = 
      `共 ${Object.keys(allData).length} 个产品，最后更新: ${new Date().toLocaleString()}`;
  } catch (err) {
    document.getElementById('statusBar').textContent = '加载失败: ' + err.message;
  }
}

// ========== Import ==========

async function importData(force) {
  if (!pendingData && !force) {
    const input = document.getElementById('jsonInput').value.trim();
    if (!input) return alert('请粘贴 JSON 数据');
    try { pendingData = JSON.parse(input); } catch (e) {
      document.getElementById('importStatus').innerHTML = '<div class="alert alert-error">JSON 解析失败: ' + e.message + '</div>';
      return;
    }
  }
  
  const btn = document.querySelector('.btn-primary');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> 提交中...';
  document.getElementById('importStatus').innerHTML = '';
  
  try {
    const url = force ? '/api/import?force=true' : '/api/import';
    const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pendingData) });
    const result = await resp.json();
    
    if (result.status === 'conflict') {
      document.getElementById('importStatus').innerHTML = '<div class="alert alert-warning">' + result.message + '</div>';
      showConflictModal(result.conflicts);
      btn.disabled = false; btn.innerHTML = '📤 提交数据'; return;
    }
    
    if (result.status === 'success') {
      document.getElementById('importStatus').innerHTML = '<div class="alert alert-success">✅ 导入成功！' + result.products + ' 个产品，' + result.rankings + ' 条排名记录</div>';
      document.getElementById('jsonInput').value = '';
      pendingData = null;
      refreshData();
    } else {
      throw new Error(result.error || 'Unknown error');
    }
  } catch (err) {
    document.getElementById('importStatus').innerHTML = '<div class="alert alert-error">❌ 导入失败: ' + err.message + '</div>';
  }
  btn.disabled = false; btn.innerHTML = '📤 提交数据';
}

function showConflictModal(conflicts) {
  document.getElementById('conflictList').innerHTML = conflicts.map(c => 
    `<div>📦 <b>${c.name}</b> (${c.asin}) — 📅 ${c.date} — 已有 ${c.count} 条记录</div>`).join('');
  document.getElementById('conflictModal').classList.add('show');
}
function closeConflictModal() { document.getElementById('conflictModal').classList.remove('show'); pendingData = null; }

// ========== Export ==========

async function exportExcel() {
  const asin = activeTab || '';
  const url = asin ? `/api/export?asin=${asin}` : '/api/export';
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('Export failed');
    const blob = await resp.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '\u5173\u952E\u8BCD\u8BB0\u5F55.xls';
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (err) { alert('导出失败: ' + err.message); }
}

// ========== Calendar Delete ==========

function showDeleteModal(asin) {
  deleteTarget = { asin, date: null };
  const product = allData[asin];
  if (!product) return;
  
  const dbDates = new Set(Object.keys(product.dates));
  const datesArr = [...dbDates].sort();
  let minDate = datesArr[0] || '2025-11-01';
  let maxDate = datesArr[datesArr.length - 1] || '2026-06-30';
  
  document.getElementById('deleteMsg').innerHTML = `产品: <b>${product.name}</b> (${asin})<br><span style="font-size:12px;color:#666;">点击蓝色日期删除，灰色 = 无数据</span>`;
  
  let html = '<div style="display:flex;flex-wrap:wrap;gap:16px;">';
  const start = new Date(minDate);
  const end = new Date(maxDate);
  start.setDate(1);
  end.setMonth(end.getMonth() + 1, 0);
  
  let cursor = new Date(start);
  while (cursor <= end) {
    html += buildMonthCalendar(cursor.getFullYear(), cursor.getMonth(), dbDates);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  
  html += '</div>';
  html += `<p id="deleteDateInfo" style="margin-top:8px;font-size:12px;color:#666;">已选择: <b>未选择</b></p>`;
  
  document.getElementById('deleteDateContainer').innerHTML = html;
  document.getElementById('deleteConfirmBtn').onclick = confirmDelete;
  document.getElementById('deleteConfirmBtn').disabled = true;
  document.getElementById('deleteModal').classList.add('show');
}

function buildMonthCalendar(year, month, dbDates) {
  const months = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  
  let html = `<div style="background:#fff;border:1px solid #e0e0e0;border-radius:8px;padding:8px;min-width:200px;">`;
  html += `<div style="text-align:center;font-weight:600;font-size:13px;margin-bottom:4px;">${year}年 ${months[month]}</div>`;
  html += `<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;text-align:center;font-size:10px;color:#999;">`;
  html += `<span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span>`;
  
  for (let i = 0; i < firstDay; i++) html += `<span></span>`;
  
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const hasData = dbDates.has(dateStr);
    const style = hasData 
      ? 'background:#1a73e8;color:#fff;border-radius:4px;cursor:pointer;padding:2px;font-size:11px;'
      : 'background:#f0f0f0;color:#ccc;border-radius:4px;padding:2px;font-size:11px;cursor:default;';
    const onclick = hasData ? `onclick="pickDeleteDate('${dateStr}')"` : '';
    html += `<span style="${style}" ${onclick}>${d}</span>`;
  }
  
  html += `</div></div>`;
  return html;
}

function pickDeleteDate(date) {
  deleteTarget.date = date;
  document.getElementById('deleteDateInfo').innerHTML = '已选择: <b style="color:#d93025;">' + date + '</b>';
  document.getElementById('deleteConfirmBtn').disabled = false;
}

function closeDeleteModal() {
  document.getElementById('deleteModal').classList.remove('show');
  deleteTarget = { asin: null, date: null };
}

async function confirmDelete() {
  if (!deleteTarget || !deleteTarget.asin || !deleteTarget.date) return;
  const { asin, date } = deleteTarget;
  try {
    const resp = await fetch(`/api/data?asin=${encodeURIComponent(asin)}&date=${encodeURIComponent(date)}`, { method: 'DELETE' });
    const result = await resp.json();
    if (result.status === 'deleted') {
      alert(`✅ 已删除 ${asin} 的 ${date} 数据（${result.changes} 条记录）`);
      refreshData();
    }
  } catch (err) { alert('删除失败: ' + err.message); }
  closeDeleteModal();
}

// ========== Preview ==========

function renderTabs() {
  const tabs = document.getElementById('productTabs');
  const asins = Object.keys(allData).sort();
  if (asins.length === 0) { tabs.innerHTML = '<span style="color:#999;padding:8px;">暂无数据</span>'; return; }
  tabs.innerHTML = asins.map(asin => {
    const name = allData[asin].name || asin;
    return `<div class="tab${asin === activeTab ? ' active' : ''}" onclick="selectTab('${asin}')">${name}<br><small>${asin}</small></div>`;
  }).join('');
  if (!activeTab || !asins.includes(activeTab)) {
    activeTab = asins[0];
    tabs.querySelectorAll('.tab').forEach((t, i) => t.classList.toggle('active', asins[i] === activeTab));
  }
}

function selectTab(asin) { activeTab = asin; renderTabs(); renderPreview(); }

function renderPreview() {
  const container = document.getElementById('previewTable');
  const asin = activeTab;
  if (!asin || !allData[asin]) { container.innerHTML = '<p style="color:#999;padding:20px;">请先导入数据</p>'; return; }
  
  const product = allData[asin];
  const dates = Object.keys(product.dates).sort();
  const kwSet = new Set();
  for (const dd of Object.values(product.dates)) for (const kw of Object.keys(dd.keywords)) kwSet.add(kw);
  const keywordList = [...kwSet].sort();
  
  if (dates.length === 0) { container.innerHTML = '<p style="color:#999;padding:20px;">该产品暂无数据</p>'; return; }
  
  let html = '<table class="preview"><thead>';
  
  html += '<tr class="row-normal"><td class="td-date" style="font-weight:bold;">' + product.name + '<br><small>' + asin + '</small></td>';
  for (const d of dates) html += '<td class="td-date">' + formatDateChinese(d) + '</td>';
  html += '</tr>';
  
  html += '<tr class="row-rank"><td class="td-rank" style="font-weight:bold;">Rank</td>';
  for (const d of dates) {
    const dd = product.dates[d];
    const rank = dd ? (dd.rank || '').replace(/(.)#(\d)/g, '$1<br>#$2') : '';
    html += '<td class="td-rank">' + rank + '</td>';
  }
  html += '</tr>';
  
  html += '<tr class="row-normal"><td class="td-center">评分 / 评论</td>';
  for (const d of dates) {
    const dd = product.dates[d];
    html += '<td class="td-center">' + (dd ? dd.rating + ' / ' + dd.reviewCount : '') + '</td>';
  }
  html += '</tr>';
  
  html += '<tr class="row-normal"><td class="td-section" colspan="' + (dates.length + 1) + '" style="background:#5B9BD5;color:#fff;">自然位-精准词</td></tr>';
  for (const kw of keywordList) {
    html += '<tr class="row-normal"><td style="text-align:left;">' + kw + '</td>';
    for (const d of dates) {
      const dd = product.dates[d];
      html += '<td class="td-center">' + ((dd && dd.keywords[kw]) ? dd.keywords[kw].naturalPos : '') + '</td>';
    }
    html += '</tr>';
  }
  
  html += '<tr class="row-normal"><td colspan="' + (dates.length + 1) + '" style="background:#f0f0f0;"></td></tr>';
  
  html += '<tr class="row-normal"><td class="td-section" colspan="' + (dates.length + 1) + '" style="background:#5B9BD5;color:#fff;">广告位-精准词</td></tr>';
  for (const kw of keywordList) {
    html += '<tr class="row-normal"><td style="text-align:left;">' + kw + '</td>';
    for (const d of dates) {
      const dd = product.dates[d];
      html += '<td class="td-center">' + ((dd && dd.keywords[kw]) ? dd.keywords[kw].adPos : '') + '</td>';
    }
    html += '</tr>';
  }
  
  html += '</table>';
  
  html += '<div class="row" style="margin-top:8px;">';
  html += '<button class="btn btn-danger btn-sm" onclick="showDeleteModal(\'' + asin + '\')">🗑 删除数据</button>';
  html += '<span style="flex:1;"></span>';
  html += '<button class="btn btn-outline btn-sm" onclick="exportExcel()">📥 导出此产品</button>';
  html += '</div>';
  
  container.innerHTML = html;
}

function formatDateChinese(iso) {
  const p = iso.split('-');
  if (p.length !== 3) return iso;
  return parseInt(p[1]) + '月' + parseInt(p[2]) + '日';
}

checkAuth();
