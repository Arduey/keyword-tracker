// keyword-tracker frontend app

let pendingData = null;
let allData = {};
let activeTab = null;
let deleteTarget = null;

// ========== Data Loading ==========

async function refreshData() {
  try {
    const resp = await fetch('/api/data');
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
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
    
    try {
      pendingData = JSON.parse(input);
    } catch (e) {
      document.getElementById('importStatus').innerHTML = 
        '<div class="alert alert-error">JSON 解析失败: ' + e.message + '</div>';
      return;
    }
  }
  
  const btn = document.querySelector('.btn-primary');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> 提交中...';
  document.getElementById('importStatus').innerHTML = '';
  
  try {
    const url = force ? '/api/import?force=true' : '/api/import';
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pendingData)
    });
    const result = await resp.json();
    
    if (result.status === 'conflict') {
      // Show conflict modal
      document.getElementById('importStatus').innerHTML = 
        '<div class="alert alert-warning">' + result.message + '</div>';
      showConflictModal(result.conflicts);
      btn.disabled = false;
      btn.innerHTML = '📤 提交数据';
      return;
    }
    
    if (result.status === 'success') {
      document.getElementById('importStatus').innerHTML = 
        '<div class="alert alert-success">✅ 导入成功！' + result.products + ' 个产品，' + result.rankings + ' 条排名记录</div>';
      document.getElementById('jsonInput').value = '';
      pendingData = null;
      refreshData();
    } else {
      throw new Error(result.error || 'Unknown error');
    }
  } catch (err) {
    document.getElementById('importStatus').innerHTML = 
      '<div class="alert alert-error">❌ 导入失败: ' + err.message + '</div>';
  }
  
  btn.disabled = false;
  btn.innerHTML = '📤 提交数据';
}

function showConflictModal(conflicts) {
  const list = document.getElementById('conflictList');
  list.innerHTML = conflicts.map(c => 
    `<div>📦 <b>${c.name}</b> (${c.asin}) — 📅 ${c.date} — 已有 ${c.count} 条记录</div>`
  ).join('');
  document.getElementById('conflictModal').classList.add('show');
}

function closeConflictModal() {
  document.getElementById('conflictModal').classList.remove('show');
  pendingData = null;
}

// ========== Export ==========

async function exportExcel() {
  const asin = activeTab || '';
  const url = asin ? `/api/export?asin=${asin}` : '/api/export';
  
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('Export failed');
    const blob = await resp.blob();
    const downloadUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = asin ? `keyword-rankings-${asin}.xls` : 'keyword-rankings-all.xls';
    a.click();
    URL.revokeObjectURL(downloadUrl);
  } catch (err) {
    alert('导出失败: ' + err.message);
  }
}

// ========== Delete ==========

function showDeleteModal(asin, date) {
  deleteTarget = { asin, date };
  document.getElementById('deleteMsg').textContent = 
    `确定删除产品 ${asin} 在 ${date} 的所有数据吗？`;
  document.getElementById('deleteConfirmBtn').onclick = confirmDelete;
  document.getElementById('deleteModal').classList.add('show');
}

function closeDeleteModal() {
  document.getElementById('deleteModal').classList.remove('show');
  deleteTarget = null;
}

async function confirmDelete() {
  if (!deleteTarget) return;
  const { asin, date } = deleteTarget;
  
  try {
    const resp = await fetch(`/api/data?asin=${asin}&date=${date}`, { method: 'DELETE' });
    const result = await resp.json();
    if (result.status === 'deleted') {
      alert(`✅ 已删除 ${asin} 的 ${date} 数据（${result.changes} 条记录）`);
      refreshData();
    }
  } catch (err) {
    alert('删除失败: ' + err.message);
  }
  closeDeleteModal();
}

// ========== Preview Rendering ==========

function renderTabs() {
  const tabs = document.getElementById('productTabs');
  const asins = Object.keys(allData).sort();
  
  if (asins.length === 0) {
    tabs.innerHTML = '<span style="color:#999;padding:8px;">暂无数据</span>';
    return;
  }
  
  tabs.innerHTML = asins.map(asin => {
    const name = allData[asin].name || asin;
    const active = asin === activeTab ? ' active' : '';
    return `<div class="tab${active}" onclick="selectTab('${asin}')">${name}<br><small>${asin}</small></div>`;
  }).join('');
  
  if (!activeTab || !asins.includes(activeTab)) {
    activeTab = asins[0];
    // Update active state
    tabs.querySelectorAll('.tab').forEach((t, i) => {
      t.classList.toggle('active', asins[i] === activeTab);
    });
  }
}

function selectTab(asin) {
  activeTab = asin;
  renderTabs();
  renderPreview();
}

function renderPreview() {
  const container = document.getElementById('previewTable');
  const asin = activeTab;
  
  if (!asin || !allData[asin]) {
    container.innerHTML = '<p style="color:#999;padding:20px;">请先导入数据</p>';
    return;
  }
  
  const product = allData[asin];
  const dates = Object.keys(product.dates).sort();
  
  // Collect all keywords
  const allKeywords = new Set();
  for (const dd of Object.values(product.dates)) {
    for (const kw of Object.keys(dd.keywords)) {
      allKeywords.add(kw);
    }
  }
  const keywordList = [...allKeywords].sort();
  
  if (dates.length === 0) {
    container.innerHTML = '<p style="color:#999;padding:20px;">该产品暂无数据</p>';
    return;
  }
  
  // Build preview table (matching Excel format)
  let html = '<table class="preview"><thead>';
  
  // Row 1: Date headers
  html += '<tr class="row-normal">';
  html += `<td class="td-date" style="font-weight:bold;">${product.name}<br><small>${asin}</small></td>`;
  for (const d of dates) {
    html += `<td class="td-date">${formatDateChinese(d)}</td>`;
  }
  html += '</tr>';
  
  // Row 2: Rank
  html += '<tr class="row-rank">';
  html += '<td class="td-rank" style="font-weight:bold;">Rank</td>';
  for (const d of dates) {
    const dd = product.dates[d];
    html += `<td class="td-rank">${dd ? (dd.rank || '') : ''}</td>`;
  }
  html += '</tr>';
  
  // Row 3: Rating / Reviews
  html += '<tr class="row-normal">';
  html += '<td class="td-center">评分 / 评论</td>';
  for (const d of dates) {
    const dd = product.dates[d];
    html += `<td class="td-center">${dd ? dd.rating + ' / ' + dd.reviewCount : ''}</td>`;
  }
  html += '</tr>';
  
  // 自然位 Section
  html += '<tr class="row-normal"><td class="td-section" colspan="' + (dates.length + 1) + '">自然位-精准词</td></tr>';
  for (const kw of keywordList) {
    html += '<tr class="row-normal">';
    html += `<td class="td-rank">${kw}</td>`;
    for (const d of dates) {
      const dd = product.dates[d];
      const pos = (dd && dd.keywords[kw]) ? dd.keywords[kw].naturalPos : '';
      html += `<td class="td-center">${pos}</td>`;
    }
    html += '</tr>';
  }
  
  // Separator
  html += '<tr class="row-normal"><td colspan="' + (dates.length + 1) + '" style="background:#f0f0f0;"></td></tr>';
  
  // 广告位 Section
  html += '<tr class="row-normal"><td class="td-section" colspan="' + (dates.length + 1) + '">广告位-精准词</td></tr>';
  for (const kw of keywordList) {
    html += '<tr class="row-normal">';
    html += `<td class="td-rank">${kw}</td>`;
    for (const d of dates) {
      const dd = product.dates[d];
      const pos = (dd && dd.keywords[kw]) ? dd.keywords[kw].adPos : '';
      html += `<td class="td-center">${pos}</td>`;
    }
    html += '</tr>';
  }
  
  html += '</table>';
  
  // Action row for each date
  let actionHtml = '<div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px;">';
  actionHtml += '<span style="font-size:12px;color:#666;line-height:28px;">删除日期: </span>';
  for (const d of dates) {
    actionHtml += `<button class="btn btn-danger btn-sm" onclick="showDeleteModal('${asin}','${d}')">🗑 ${d}</button>`;
  }
  actionHtml += '<span style="flex:1;"></span>';
  actionHtml += `<button class="btn btn-outline btn-sm" onclick="exportExcel()">📥 导出此产品</button>`;
  actionHtml += '</div>';
  
  container.innerHTML = html + actionHtml;
}

function formatDateChinese(isoDate) {
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  return `${parseInt(parts[1])}月${parseInt(parts[2])}日`;
}

// ========== Init ==========
refreshData();
