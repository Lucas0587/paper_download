console.log('Content script loaded!');
window.contentScriptLoaded = true;

let toolbar = null;
let checkboxes = [];
let isActive = false;
let queryKeywords = [];
let highlightedElements = [];
let waitTimeDisplay = null;
let waitTimeInterval = null;

async function autoHighlightOnLoad() {
  console.log('Auto highlighting on page load...');
  try {
    const response = await chrome.runtime.sendMessage({ action: 'load_query' });
    if (response && response.keywords && response.keywords.length > 0) {
      queryKeywords = response.keywords;
      applyHighlights();
      console.log(`Auto highlighted ${highlightedElements.length} articles`);
    }
  } catch (error) {
    console.error('Auto highlight error:', error);
  }
}

function initToolbar() {
  console.log('initToolbar called');
  if (toolbar) {
    console.log('Toolbar already exists');
    return;
  }

  toolbar = document.createElement('div');
  toolbar.className = 'article-downloader-toolbar';

  const isArticlePage = checkIsArticlePage();
  console.log('Is article page:', isArticlePage);

  let extraButtonHtml = '';
  if (isArticlePage) {
    extraButtonHtml = `
      <button class="article-downloader-btn" id="downloader-single-btn" style="background: #1a73e8; margin-bottom: 10px;">下载当前文章</button>
    `;
  }

  toolbar.innerHTML = `
    ${extraButtonHtml}
    <button class="article-downloader-btn" id="downloader-query-btn" style="background: #ff9800; margin-bottom: 10px;">查询高亮</button>
    <button class="article-downloader-btn" id="downloader-output-btn">输出选中</button>
    <div class="article-downloader-count" id="downloader-count">已选择: 0 篇</div>
    <div class="article-downloader-status" id="downloader-status">准备就绪</div>
  `;

  document.body.appendChild(toolbar);
  console.log('Toolbar added to body');

  document.getElementById('downloader-query-btn').addEventListener('click', toggleQueryHighlight);
  document.getElementById('downloader-output-btn').addEventListener('click', startDownload);

  if (isArticlePage) {
    document.getElementById('downloader-single-btn').addEventListener('click', downloadCurrentArticle);
  }
}

let currentSiteName = '';

function initWaitTimeDisplay() {
  if (waitTimeDisplay) {
    waitTimeDisplay.remove();
    waitTimeDisplay = null;
  }
  
  waitTimeDisplay = document.createElement('div');
  waitTimeDisplay.id = 'downloader-wait-time';
  waitTimeDisplay.style.cssText = `
    position: fixed;
    bottom: 20px;
    left: 20px;
    background: rgba(33, 150, 243, 0.95);
    color: white;
    padding: 20px 30px;
    border-radius: 12px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 16px;
    font-weight: bold;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
    z-index: 999999;
    display: none;
    min-width: 250px;
    text-align: center;
  `;
  
  waitTimeDisplay.innerHTML = `
    <div style="margin-bottom: 10px; font-size: 14px;" id="wait-time-text">正在等待下载...</div>
    <div id="wait-time-countdown" style="font-size: 32px; font-weight: bold;">30</div>
    <div style="margin-top: 5px; font-size: 12px; margin-bottom: 12px;">秒后开始下载下一篇</div>
    <button id="wait-time-skip-btn" style="
      background: rgba(255, 255, 255, 0.2);
      color: white;
      border: 1px solid rgba(255, 255, 255, 0.4);
      padding: 8px 24px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: bold;
      cursor: pointer;
      transition: all 0.2s;
    " onmouseover="this.style.background='rgba(255, 255, 255, 0.3)'" 
      onmouseout="this.style.background='rgba(255, 255, 255, 0.2)'">
      跳过等待
    </button>
  `;
  
  document.body.appendChild(waitTimeDisplay);
  
  // 添加跳过按钮点击事件
  const skipBtn = document.getElementById('wait-time-skip-btn');
  if (skipBtn) {
    skipBtn.addEventListener('click', () => {
      console.log('Skip button clicked');
      hideWaitTime();
      chrome.runtime.sendMessage({ action: 'skip_wait' }).catch(() => {});
    });
  }
}

function updateWaitTimeText(siteName) {
  if (waitTimeDisplay) {
    const textEl = waitTimeDisplay.querySelector('#wait-time-text');
    if (textEl) {
      textEl.textContent = siteName ? `正在等待 ${siteName} 下载...` : '正在等待下载...';
    }
  }
}

function showWaitTime(seconds) {
  if (!waitTimeDisplay) {
    initWaitTimeDisplay();
  }
  
  waitTimeDisplay.style.display = 'block';
  const countdownEl = document.getElementById('wait-time-countdown');
  
  // 清除旧的倒计时
  if (waitTimeInterval) {
    clearInterval(waitTimeInterval);
    waitTimeInterval = null;
  }
  
  let remaining = seconds;
  countdownEl.textContent = remaining;
  
  waitTimeInterval = setInterval(() => {
    remaining--;
    if (countdownEl) {
      if (remaining >= 0) {
        countdownEl.textContent = remaining;
      }
      if (remaining <= 0) {
        // 倒计时结束，隐藏悬浮框
        if (waitTimeInterval) {
          clearInterval(waitTimeInterval);
          waitTimeInterval = null;
        }
        waitTimeDisplay.style.display = 'none';
      }
    }
  }, 1000);
}

function hideWaitTime() {
  if (waitTimeDisplay) {
    waitTimeDisplay.style.display = 'none';
  }
  if (waitTimeInterval) {
    clearInterval(waitTimeInterval);
    waitTimeInterval = null;
  }
}

function checkIsArticlePage() {
  const url = window.location.href;
  if (url.includes('nature.com') && url.includes('/articles/')) {
    return true;
  }
  if (url.includes('pubs.acs.org') && !url.includes('/toc/')) {
    return true;
  }
  if (url.includes('pubs.rsc.org') && url.includes('/articlelanding/')) {
    return true;
  }
  return false;
}

function getCurrentSite() {
  const url = window.location.href;
  if (url.includes('nature.com')) return 'nature';
  if (url.includes('pubs.acs.org')) return 'acs';
  if (url.includes('pubs.rsc.org')) return 'rsc';
  return null;
}

function downloadCurrentArticle() {
  console.log('downloadCurrentArticle called');
  const site = getCurrentSite();
  
  if (!site) {
    showMessage('不支持当前网站', 'error');
    return;
  }

  const statusEl = document.getElementById('downloader-status');
  statusEl.textContent = '正在获取PDF链接...';
  statusEl.style.color = '#1a73e8';

  const url = window.location.href;
  let name = '';

  try {
    const parts = url.split('/');
    name = parts[parts.length - 1].replace(/_/g, '-');
  } catch {
    name = `article-${Date.now()}`;
  }

  let pdfUrl = null;
  let supportingInfoUrls = [];

  if (site === 'nature') {
    pdfUrl = extractNaturePdfUrlOnPage();
    supportingInfoUrls = extractNatureSupportingInfoUrlsOnPage();
  } else if (site === 'acs') {
    pdfUrl = extractACSPdfUrlOnPage();
    supportingInfoUrls = extractACSSupportingInfoUrlsOnPage();
  } else if (site === 'rsc') {
    pdfUrl = extractRscPdfUrlOnPage();
    supportingInfoUrls = extractRscSupportingInfoUrlsOnPage();
  }

  console.log('主PDF链接:', pdfUrl);
  console.log('支持信息链接:', supportingInfoUrls);

  if (pdfUrl) {
    setTimeout(() => {
      chrome.runtime.sendMessage({
        action: 'download_file_direct',
        url: pdfUrl,
        filename: `${name}.pdf`
      });
    }, 3000);
  }

  supportingInfoUrls.forEach((suUrl, index) => {
    const delaySeconds = (index + 2) * 5;
    setTimeout(() => {
      const siSuffix = site === 'acs' ? `si_${String(index + 1).padStart(3, '0')}` : `${index + 1}`;
      chrome.runtime.sendMessage({
        action: 'download_file_direct',
        url: suUrl,
        filename: `${name}_${siSuffix}.pdf`
      });
    }, delaySeconds * 1000);
  });

  setTimeout(() => {
    statusEl.textContent = '下载任务已发送！';
    statusEl.style.color = '#27ae60';
  }, 10000);
}

function extractACSPdfUrlOnPage() {
  let pdfUrl = null;
  const openPdfBtn = document.querySelector('a[data-id="article_header_OpenPDF"]');
  
  if (openPdfBtn) {
    const href = openPdfBtn.getAttribute('href');
    if (href) {
      pdfUrl = href.startsWith('http') ? href : 'https://pubs.acs.org' + href;
    }
  }

  if (!pdfUrl) {
    const allLinks = document.querySelectorAll('a');
    for (let link of allLinks) {
      const href = link.getAttribute('href');
      if (href && href.includes('/pdf/')) {
        pdfUrl = href.startsWith('http') ? href : 'https://pubs.acs.org' + href;
        break;
      }
    }
  }
  return pdfUrl;
}

function extractACSSupportingInfoUrlsOnPage() {
  const urls = [];
  const supplLinks = document.querySelectorAll('a.suppl-anchor, a[href*="/suppl/"]');
  supplLinks.forEach(anchor => {
    const href = anchor.getAttribute('href');
    if (href && href.toLowerCase().includes('.pdf')) {
      const fullUrl = href.startsWith('http') ? href : 'https://pubs.acs.org' + href;
      if (!urls.includes(fullUrl)) {
        urls.push(fullUrl);
      }
    }
  });
  return urls;
}

function extractNaturePdfUrlOnPage() {
  let pdfUrl = null;
  const allLinks = document.querySelectorAll('a');
  
  // 先查找带 data-article-pdf 属性的链接（主 PDF）
  for (let link of allLinks) {
    if (link.hasAttribute('data-article-pdf')) {
      const href = link.getAttribute('href');
      if (href && href.includes('.pdf')) {
        pdfUrl = href.startsWith('http') ? href : 'https://www.nature.com' + href;
        console.log('找到主 PDF（data-article-pdf）:', pdfUrl);
        break;
      }
    }
  }
  
  // 如果没找到，找第一个包含 .pdf 的链接
  if (!pdfUrl) {
    for (let link of allLinks) {
      const href = link.getAttribute('href');
      if (href && href.includes('.pdf')) {
        pdfUrl = href.startsWith('http') ? href : 'https://www.nature.com' + href;
        console.log('找到主 PDF（第一个 pdf 链接）:', pdfUrl);
        break;
      }
    }
  }
  
  return pdfUrl;
}

function extractNatureSupportingInfoUrlsOnPage() {
  const urls = [];
  const allLinks = document.querySelectorAll('a');
  
  // 查找包含 supplementary info 的链接，或者 data-test="supp-info-link" 的链接
  for (let link of allLinks) {
    const href = link.getAttribute('href');
    const text = link.textContent.toLowerCase();
    
    if (href && href.toLowerCase().includes('.pdf')) {
      // 跳过主 PDF（因为主 PDF 应该已经在上面提取了）
      if (href.includes('/articles/') && !href.includes('esm') && !href.includes('MOESM') && !href.includes('MediaObjects')) {
        continue;
      }
      
      // 检查是否是补充信息相关
      if (text.includes('supplementary') || 
          text.includes('supporting') || 
          href.includes('esm') || 
          href.includes('supp-info') ||
          href.includes('MOESM') ||
          link.hasAttribute('data-test') && link.getAttribute('data-test') === 'supp-info-link') {
        
        const fullUrl = href.startsWith('http') ? href : 'https://www.nature.com' + href;
        if (!urls.includes(fullUrl)) {
          urls.push(fullUrl);
          console.log('找到补充信息 PDF:', fullUrl);
        }
      }
    }
  }
  
  return urls;
}

function extractRscPdfUrlOnPage() {
  let pdfUrl = null;
  
  // 查找包含 articlepdf 的链接
  const pdfDownloadBtn = document.querySelector('a[href*="/content/articlepdf/"]');
  if (pdfDownloadBtn) {
    const href = pdfDownloadBtn.getAttribute('href');
    if (href) {
      pdfUrl = href.startsWith('http') ? href : 'https://pubs.rsc.org' + href;
    }
  }

  if (!pdfUrl) {
    const allLinks = document.querySelectorAll('a');
    for (let link of allLinks) {
      const href = link.getAttribute('href');
      if (href && href.includes('.pdf')) {
        pdfUrl = href.startsWith('http') ? href : 'https://pubs.rsc.org' + href;
        break;
      }
    }
  }
  
  return pdfUrl;
}

function extractRscSupportingInfoUrlsOnPage() {
  const urls = [];
  
  // 查找 Supplementary files 部分
  const supplLinks = document.querySelectorAll('a.list__item-link[href*="/suppdata/"]');
  supplLinks.forEach(anchor => {
    const href = anchor.getAttribute('href');
    if (href) {
      const fullUrl = href.startsWith('http') ? href : 'https://www.rsc.org' + href;
      if (!urls.includes(fullUrl)) {
        urls.push(fullUrl);
      }
    }
  });

  return urls;
}

function removeToolbar() {
  console.log('removeToolbar called');
  if (toolbar) {
    toolbar.remove();
    toolbar = null;
  }

  checkboxes.forEach(cb => {
    if (cb && cb.parentNode) {
      const parent = cb.parentNode;
      if (parent) {
        // 先移除 indexLabel（如果存在）
        const indexLabel = parent.querySelector('.article-downloader-index');
        if (indexLabel && indexLabel.parentNode === parent) {
          try {
            parent.removeChild(indexLabel);
          } catch (e) {
            // 忽略已移除的情况
          }
        }
        // 再移除 checkbox（检查是否还在 DOM 中）
        if (cb.parentNode === parent) {
          try {
            parent.removeChild(cb);
          } catch (e) {
            // 忽略已移除的情况
          }
        }
      }
    }
  });
  checkboxes = [];
}

function addCheckboxes() {
  console.log('addCheckboxes called');
  const site = getCurrentSite();
  console.log('Current site:', site);

  if (!site) return;

  let headingElements = [];

  if (site === 'nature') {
    headingElements = document.querySelectorAll('h3, h2');
    console.log('Found Nature headings:', headingElements.length);
  } else if (site === 'acs') {
    headingElements = document.querySelectorAll('h3.issue-item_title');
    console.log('Found ACS headings:', headingElements.length);
  } else if (site === 'rsc') {
    // 根据用户提供的 class 选择器：capsule capsule--article
    let capsuleLinks = document.querySelectorAll('a.capsule.capsule--article');
    console.log('Found RSC capsule links:', capsuleLinks.length);
    
    // 如果没找到，尝试其他选择器
    if (capsuleLinks.length === 0) {
      console.log('No capsule links found, trying articlelanding links...');
      capsuleLinks = document.querySelectorAll('a[href*="/articlelanding/"]');
      console.log('Found articlelanding links:', capsuleLinks.length);
    }
    
    // 如果还是没找到，尝试更广泛的选择器
    if (capsuleLinks.length === 0) {
      console.log('No articlelanding links found, trying #tabissues .tab-content links...');
      const tabContent = document.querySelector('#tabissues .tab-content');
      if (tabContent) {
        capsuleLinks = tabContent.querySelectorAll('a');
        console.log('Found links in tab-content:', capsuleLinks.length);
      }
    }
    
    capsuleLinks.forEach(link => {
      const href = link.getAttribute('href');
      // 只处理包含 articlelanding 的链接
      if (href && href.includes('/articlelanding/')) {
        // 直接使用链接的父元素作为勾选框容器
        const parent = link.parentElement;
        if (parent) {
          headingElements.push(parent);
          // 存储链接引用，方便后续查找
          parent._articleLink = link;
        }
      }
    });
    console.log('Filtered RSC containers:', headingElements.length);
  }

  checkboxes = [];
  console.log('Adding checkboxes to', headingElements.length, 'headings');

  headingElements.forEach((heading, index) => {
    console.log(`Processing heading ${index + 1}:`, heading);

    if (heading.querySelector('.article-downloader-checkbox')) {
      console.log('Skipping - already has checkbox');
      return;
    }

    let link = null;
    // 根据站点类型查找链接
    if (site === 'rsc') {
      // RSC 优先使用存储的链接引用
      if (heading._articleLink) {
        link = heading._articleLink;
        console.log('Found link from stored reference');
      } else {
        // 否则查找 articlelanding 链接
        link = heading.querySelector('a[href*="/articlelanding/"]');
        console.log('Found articlelanding link:', link ? link.href : null);
      }
    } else {
      // ACS 和 Nature 使用标准选择器
      link = heading.querySelector('a');
    }
    
    if (!link || !link.href) {
      console.log('Skipping - no link found in heading');
      return;
    }

    const url = link.href;
    const name = getFileName(url);

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'article-downloader-checkbox';
    checkbox.dataset.index = index;
    checkbox.dataset.url = url;
    checkbox.dataset.name = name;
    checkbox.dataset.site = site;
    checkbox.style.minWidth = '16px';
    checkbox.style.minHeight = '16px';

    const indexLabel = document.createElement('span');
    indexLabel.className = 'article-downloader-index';
    indexLabel.textContent = `[${index + 1}] `;
    indexLabel.style.fontWeight = 'bold';
    indexLabel.style.marginRight = '8px';
    indexLabel.style.color = '#1a73e8';

    heading.style.display = 'flex';
    heading.style.alignItems = 'center';
    heading.style.gap = '10px';
    heading.style.flexWrap = 'wrap';

    heading.insertBefore(checkbox, heading.firstChild);
    heading.insertBefore(indexLabel, checkbox.nextSibling);

    checkbox.addEventListener('change', updateCount);
    checkboxes.push(checkbox);

    console.log(`Added checkbox to heading ${index + 1}`);
  });

  console.log('Total checkboxes added:', checkboxes.length);
}

function getFileName(url) {
  try {
    const parts = url.split('/');
    return parts[parts.length - 1].replace(/_/g, '-');
  } catch {
    return `article-${Date.now()}`;
  }
}

function updateCount() {
  const count = checkboxes.filter(cb => cb.checked).length;
  const countEl = document.getElementById('downloader-count');
  if (countEl) {
    countEl.textContent = `已选择: ${count} 篇`;
  }
}

function getSelectedUrls() {
  return checkboxes
    .filter(cb => cb.checked && cb.dataset.url)
    .map(cb => cb.dataset.url);
}

function showMessage(text, type = 'info') {
  const statusEl = document.getElementById('downloader-status');
  if (statusEl) {
    statusEl.textContent = text;
    statusEl.style.color = type === 'error' ? '#e74c3c' : type === 'success' ? '#27ae60' : '#1a73e8';
  }
}

async function startDownload() {
  const selected = getSelectedUrls();

  if (selected.length === 0) {
    showMessage('请先勾选文章！', 'error');
    return;
  }

  showMessage('开始下载...', 'success');

  const site = getCurrentSite();
  const items = selected.map(url => ({
    url,
    name: getFileName(url),
    site
  }));

  // 从 storage 读取下载选项
  const storageResult = await chrome.storage.local.get('downloadOptions');
  const options = storageResult.downloadOptions || { downloadMain: true, downloadSI: true };

  if (site === 'acs') {
    chrome.runtime.sendMessage({
      action: 'start_download',
      urls: items,
      delay: 5,
      type: 'acs',
      options: options
    });
  } else if (site === 'nature') {
    chrome.runtime.sendMessage({
      action: 'start_nature_download',
      urls: items,
      options: options
    });
  } else if (site === 'rsc') {
    chrome.runtime.sendMessage({
      action: 'start_rsc_download',
      urls: items,
      options: options
    });
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Content script received message:', message);

  if (message.action === 'toggle_acs' || message.action === 'toggle_nature' || message.action === 'toggle_rsc') {
    console.log('Toggling mode:', message.action);
    isActive = !isActive;
    if (isActive) {
      initToolbar();
      addCheckboxes();
      sendResponse({ status: 'activated' });
    } else {
      removeToolbar();
      sendResponse({ status: 'deactivated' });
    }
  } else if (message.action === 'getSelected') {
    console.log('Getting selected URLs');
    sendResponse({ selectedUrls: getSelectedUrls() });
  } else if (message.action === 'update_wait_time') {
    console.log('Received wait time update:', message);
    if (message.isWaiting) {
      if (!waitTimeDisplay) {
        initWaitTimeDisplay();
      }
      if (message.siteName) {
        updateWaitTimeText(message.siteName);
      }
      showWaitTime(message.seconds);
    } else {
      hideWaitTime();
    }
    sendResponse({ status: 'ok' });
  }
  return true;
});

async function toggleQueryHighlight() {
  console.log('Toggle query highlight');
  const statusEl = document.getElementById('downloader-status');
  
  if (highlightedElements.length > 0) {
    console.log('Removing existing highlights');
    removeHighlights();
    statusEl.textContent = '已清除高亮';
    statusEl.style.color = '#27ae60';
    return;
  }

  console.log('Loading query keywords');
  statusEl.textContent = '正在加载查询关键词...';
  statusEl.style.color = '#1a73e8';

  try {
    const response = await chrome.runtime.sendMessage({ action: 'load_query' });
    console.log('Query keywords response:', response);
    
    if (response && response.keywords && response.keywords.length > 0) {
      queryKeywords = response.keywords;
      applyHighlights();
      statusEl.textContent = `已高亮 ${highlightedElements.length} 篇文章`;
      statusEl.style.color = '#27ae60';
    } else if (response && response.keywords && response.keywords.length === 0) {
      statusEl.textContent = '没有查询关键词';
      statusEl.style.color = '#ff9800';
    } else {
      statusEl.textContent = '加载查询失败';
      statusEl.style.color = '#e74c3c';
    }
  } catch (error) {
    console.error('Error loading query:', error);
    statusEl.textContent = '加载查询失败';
    statusEl.style.color = '#e74c3c';
  }
}

function removeHighlights() {
  highlightedElements.forEach(el => {
    if (el && el.style) {
      el.style.color = '';
      el.style.backgroundColor = '';
      el.style.fontWeight = '';
    }
  });
  highlightedElements = [];
}

function applyHighlights() {
  console.log('Applying highlights for keywords:', queryKeywords);
  const site = getCurrentSite();
  let headingElements = [];

  if (site === 'nature') {
    headingElements = document.querySelectorAll('h3, h2');
  } else if (site === 'acs') {
    headingElements = document.querySelectorAll('h3.issue-item_title');
  } else if (site === 'rsc') {
    headingElements = document.querySelectorAll('h3, h2');
  }

  console.log('Found headings to check:', headingElements.length);

  headingElements.forEach(heading => {
    const link = heading.querySelector('a');
    if (!link || !link.href) return;

    const url = link.href;
    const text = heading.textContent || '';

    const matches = queryKeywords.some(keyword => 
      url.toLowerCase().includes(keyword.toLowerCase()) || 
      text.toLowerCase().includes(keyword.toLowerCase())
    );

    if (matches) {
      console.log('Highlighting:', text.substring(0, 50));
      heading.style.color = '#ff0000';
      heading.style.fontWeight = 'bold';
      heading.style.backgroundColor = 'rgba(255, 0, 0, 0.05)';
      highlightedElements.push(heading);
    }
  });

  console.log('Total highlighted:', highlightedElements.length);
}

console.log('Content script initialization complete!');

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', autoHighlightOnLoad);
} else {
  autoHighlightOnLoad();
}