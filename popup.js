const browser = (typeof chrome !== 'undefined') ? chrome : browser;

let blacklist = [];

function getDownloadOptions() {
  const options = {
    downloadMain: document.getElementById('downloadMainPdf').checked,
    downloadSI: document.getElementById('downloadSI').checked
  };
  browser.storage.local.set({ downloadOptions: options });
  return options;
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadBlacklist();
  await renderTodoList();
  await renderManualList();
  
  const status = document.getElementById('status');
  const progressBar = document.getElementById('progressBar');
  const delaySlider = document.getElementById('delaySlider');
  const delayValue = document.getElementById('delayValue');
  
  let delaySeconds = 5;
  
  delaySlider.addEventListener('input', (e) => {
    delaySeconds = parseInt(e.target.value);
    delayValue.textContent = delaySeconds;
  });
  
  document.getElementById('acsAllBtn').addEventListener('click', async () => {
    await handleACSAll(delaySeconds);
  });
  
  document.getElementById('acsSelectBtn').addEventListener('click', async () => {
    await handleACSSelect();
  });
  
  document.getElementById('natureAllBtn').addEventListener('click', async () => {
    await handleNatureAll(delaySeconds);
  });
  
  document.getElementById('natureSelectBtn').addEventListener('click', async () => {
    await handleNatureSelect();
  });
  
  document.getElementById('rscAllBtn').addEventListener('click', async () => {
    await handleRscAll(delaySeconds);
  });
  
  document.getElementById('rscSelectBtn').addEventListener('click', async () => {
    await handleRscSelect();
  });
  
  document.getElementById('storeBtn').addEventListener('click', async () => {
    await storeToTodo();
  });
  
  document.getElementById('startDownloadBtn').addEventListener('click', async () => {
    await startTodoDownload(delaySeconds);
  });
  
  document.getElementById('clearTodoBtn').addEventListener('click', async () => {
    await clearTodoList();
  });

  document.getElementById('clearManualBtn').addEventListener('click', async () => {
    await clearManualList();
  });

  document.getElementById('resetDownloadBtn').addEventListener('click', async () => {
    await resetDownload();
  });
  
  document.getElementById('addDoiBtn').addEventListener('click', async () => {
    await addDoiToTodo();
  });
  
  // 支持回车键添加
  document.getElementById('doiInput').addEventListener('keypress', async (e) => {
    if (e.key === 'Enter') {
      await addDoiToTodo();
    }
  });
});

async function loadBlacklist() {
  try {
    const response = await fetch(chrome.runtime.getURL('blacklist.txt'));
    const text = await response.text();
    blacklist = text.split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));
    console.log('Blacklist loaded:', blacklist.length, 'entries');
  } catch (error) {
    console.log('No blacklist file found or error loading:', error);
    blacklist = [];
  }
}

function isBlacklisted(url) {
  return blacklist.some(entry => url.includes(entry));
}

function doiToUrl(doi) {
  doi = doi.trim();
  if (!doi) return null;
  
  // 移除可能包含的URL前缀
  if (doi.startsWith('https://doi.org/')) {
    doi = doi.replace('https://doi.org/', '');
  } else if (doi.startsWith('http://doi.org/')) {
    doi = doi.replace('http://doi.org/', '');
  } else if (doi.startsWith('doi:')) {
    doi = doi.replace('doi:', '');
  }
  
  if (!doi.startsWith('10.')) {
    return null; // 不是有效的DOI格式
  }
  
  let url = null;
  let site = null;
  
  if (doi.startsWith('10.1021/')) {
    // ACS
    url = `https://pubs.acs.org/doi/${doi}`;
    site = 'acs';
  } else if (doi.startsWith('10.1038/') || doi.startsWith('10.1057/') || doi.startsWith('10.1007/')) {
    // Nature (包括Springer Nature旗下期刊)
    url = `https://doi.org/${doi}`;
    site = 'nature';
  } else if (doi.startsWith('10.1039/')) {
    // RSC
    url = `https://doi.org/${doi}`;
    site = 'rsc';
  } else {
    // 其他期刊暂时使用通用doi.org链接，后续可以扩展
    url = `https://doi.org/${doi}`;
    // 默认先尝试Nature，不对的话可能需要用户手动处理
    site = 'nature';
  }
  
  return { url, site, doi };
}

function getDoiFileName(doi) {
  const parts = doi.split('/');
  // 取最后一个部分作为文件名
  const lastPart = parts[parts.length - 1].replace(/[^a-zA-Z0-9.-]/g, '-');
  return lastPart || `doi-${Date.now()}`;
}

async function addDoiToTodo() {
  const status = document.getElementById('status');
  const progressBar = document.getElementById('progressBar');
  const doiInput = document.getElementById('doiInput');
  
  const doi = doiInput.value.trim();
  
  if (!doi) {
    status.textContent = '请输入DOI号';
    progressBar.style.width = '0%';
    return;
  }
  
  status.textContent = '解析DOI...';
  progressBar.style.width = '30%';
  
  try {
    const result = doiToUrl(doi);
    
    if (!result) {
      status.textContent = '无效的DOI格式';
      progressBar.style.width = '0%';
      return;
    }
    
    const { url, site, doi: cleanDoi } = result;
    const name = getDoiFileName(cleanDoi);
    
    // 检查是否已在TODO列表中
    const todoList = await getTodoList();
    const alreadyExists = todoList.some(item => item.url === url);
    
    if (alreadyExists) {
      status.textContent = '该文章已在TODO列表中';
      progressBar.style.width = '0%';
      return;
    }
    
    // 添加到TODO列表
    todoList.push({
      url,
      name,
      site,
      status: 'pending',
      addedAt: Date.now()
    });
    
    await saveTodoList(todoList);
    
    // 清空输入框
    doiInput.value = '';
    
    status.textContent = `已添加到TODO: ${name}`;
    progressBar.style.width = '100%';
    
    setTimeout(() => {
      status.textContent = '准备就绪';
      progressBar.style.width = '0%';
    }, 2000);
    
  } catch (error) {
    console.error('添加DOI失败:', error);
    status.textContent = `添加失败: ${error.message}`;
    progressBar.style.width = '0%';
  }
}

async function getTodoList() {
  const result = await browser.storage.local.get('todoList');
  return result.todoList || [];
}

async function saveTodoList(todoList) {
  await browser.storage.local.set({ todoList });
  await renderTodoList();
  await renderManualList();
}

async function renderTodoList() {
  const todoList = await getTodoList();
  const todoListEl = document.getElementById('todoList');
  const todoCountEl = document.getElementById('todoCount');
  
  todoCountEl.textContent = `${todoList.length} 个待下载`;
  
  if (todoList.length === 0) {
    todoListEl.innerHTML = '<div style="color: #999; text-align: center; padding: 20px;">暂无待下载任务</div>';
    return;
  }
  
  todoListEl.innerHTML = todoList.map((item, index) => {
    let statusClass = 'pending';
    let statusText = '待下载';
    
    if (item.status === 'downloading') {
      statusClass = 'downloading';
      statusText = '下载中';
    } else if (item.status === 'completed') {
      statusClass = 'completed';
      statusText = '已完成';
    }
    
    return `
      <div class="todo-item ${statusClass}" data-index="${index}">
        <div class="todo-url" title="${item.url}">
          <a href="${item.url}" target="_blank" style="color: #0d6efd; text-decoration: none;">
            ${item.name || item.url.substring(0, 50)}...
          </a>
        </div>
        <div style="display: flex; gap: 4px;">
          <button class="todo-manual" data-index="${index}" style="background: #ffc107; color: #212529; border: none; border-radius: 3px; padding: 2px 6px; cursor: pointer; font-size: 11px;">手动</button>
          <button class="todo-remove" data-index="${index}">×</button>
        </div>
      </div>
    `;
  }).join('');
  
  document.querySelectorAll('.todo-remove').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const index = parseInt(e.target.dataset.index);
      await removeTodoItem(index);
    });
  });
  
  document.querySelectorAll('.todo-manual').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const index = parseInt(e.target.dataset.index);
      await moveToManual(index);
    });
  });
}

async function removeTodoItem(index) {
  const todoList = await getTodoList();
  todoList.splice(index, 1);
  await saveTodoList(todoList);
}

async function moveToManual(index) {
  const todoList = await getTodoList();
  const item = todoList[index];
  
  if (!item) return;
  
  const manualItem = {
    ...item,
    status: 'manual',
    movedAt: Date.now()
  };
  
  await browser.runtime.sendMessage({ 
    action: 'add_to_manual_downloads', 
    item: manualItem 
  });
  
  todoList.splice(index, 1);
  await saveTodoList(todoList);
  await renderManualList();
  
  const status = document.getElementById('status');
  status.textContent = '已移至手动下载列表';
}

async function clearTodoList() {
  await saveTodoList([]);
  const status = document.getElementById('status');
  status.textContent = 'TODO列表已清空';
}

async function renderManualList() {
  const response = await browser.runtime.sendMessage({ action: 'get_manual_downloads' });
  const manualList = response.list || [];
  const manualListEl = document.getElementById('manualList');
  const manualCountEl = document.getElementById('manualCount');
  
  manualCountEl.textContent = `${manualList.length} 个需要手动下载`;
  
  if (manualList.length === 0) {
    manualListEl.innerHTML = '<div style="color: #999; text-align: center; padding: 20px;">暂无卡住的任务</div>';
    return;
  }
  
  manualListEl.innerHTML = manualList.map((item, index) => `
    <div class="todo-item" style="border-left: 3px solid #dc3545;" data-index="${index}">
      <div class="todo-url" title="${item.url}">
        <a href="${item.url}" target="_blank" style="color: #dc3545; text-decoration: none;">
          ${item.name || item.url.substring(0, 50)}...
        </a>
      </div>
      <button class="todo-remove" data-index="${index}">×</button>
    </div>
  `).join('');
  
  document.querySelectorAll('#manualList .todo-remove').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const index = parseInt(e.target.dataset.index);
      await removeManualItem(index);
    });
  });
}

async function removeManualItem(index) {
  const response = await browser.runtime.sendMessage({ action: 'get_manual_downloads' });
  const manualList = response.list || [];
  const url = manualList[index].url;
  
  await browser.runtime.sendMessage({ action: 'remove_manual_download', url });
  await renderManualList();
}

async function clearManualList() {
  await browser.runtime.sendMessage({ action: 'clear_manual_downloads' });
  await renderManualList();
  const status = document.getElementById('status');
  status.textContent = '手动下载列表已清空';
}

async function resetDownload() {
  const status = document.getElementById('status');
  const progressBar = document.getElementById('progressBar');
  
  status.textContent = '正在重置下载...';
  progressBar.style.width = '30%';
  
  try {
    browser.runtime.sendMessage({ action: 'reset_download' }, (response) => {
      console.log('重置响应:', response);
    });
    
    const todoList = await getTodoList();
    const resetTodoList = todoList.map(item => ({
      ...item,
      status: 'pending'
    }));
    await saveTodoList(resetTodoList);
    
    status.textContent = '下载已重置，可以重新开始';
    progressBar.style.width = '100%';
    
    setTimeout(() => {
      status.textContent = '准备就绪';
      progressBar.style.width = '0%';
    }, 2000);
  } catch (error) {
    console.error('重置错误:', error);
    status.textContent = '重置失败: ' + error.message;
    progressBar.style.width = '0%';
  }
}

async function storeToTodo() {
  const status = document.getElementById('status');
  const progressBar = document.getElementById('progressBar');
  
  status.textContent = '获取当前页面URL...';
  progressBar.style.width = '30%';
  
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    const currentUrl = tab.url;
    
    let site = null;
    if (currentUrl.includes('pubs.acs.org')) {
      site = 'acs';
    } else if (currentUrl.includes('nature.com')) {
      site = 'nature';
    } else if (currentUrl.includes('pubs.rsc.org')) {
      site = 'rsc';
    }
    
    if (!site) {
      status.textContent = '请在ACS或Nature网站上使用';
      progressBar.style.width = '0%';
      return;
    }
    
    status.textContent = '检查是否有勾选模式...';
    progressBar.style.width = '50%';
    
    let selectedUrls = [];
    
    try {
      const response = await sendMessageWithTimeout(tab.id, { action: 'getSelected' }, 5000);
      if (response && response.selectedUrls && response.selectedUrls.length > 0) {
        selectedUrls = response.selectedUrls;
        console.log('Got selected URLs:', selectedUrls.length);
      }
    } catch (error) {
      console.log('No selection mode active, getting all URLs');
    }
    
    if (selectedUrls.length === 0) {
      status.textContent = '获取页面所有URL...';
      progressBar.style.width = '70%';
      
      let urls = [];
      if (site === 'acs') {
        const result = await browser.scripting.executeScript({
          target: { tabId: tab.id },
          func: extractACSUrls
        });
        if (result && result[0] && Array.isArray(result[0].result)) {
          urls = result[0].result;
        }
      } else if (site === 'nature') {
        const result = await browser.scripting.executeScript({
          target: { tabId: tab.id },
          func: extractNatureUrls
        });
        if (result && result[0] && Array.isArray(result[0].result)) {
          urls = result[0].result;
        }
      } else if (site === 'rsc') {
        const result = await browser.scripting.executeScript({
          target: { tabId: tab.id },
          func: extractRscUrls
        });
        if (result && result[0] && Array.isArray(result[0].result)) {
          urls = result[0].result;
        }
      }
      
      selectedUrls = urls;
    }
    
    const filteredUrls = selectedUrls.filter(url => !isBlacklisted(url));
    
    if (filteredUrls.length === 0) {
      status.textContent = '没有可添加的URL';
      progressBar.style.width = '0%';
      return;
    }
    
    const todoList = await getTodoList();
    
    filteredUrls.forEach(url => {
      const exists = todoList.some(item => item.url === url);
      if (!exists) {
        todoList.push({
          url,
          name: getFileName(url),
          site,
          status: 'pending',
          addedAt: Date.now()
        });
      }
    });
    
    await saveTodoList(todoList);
    
    const addedCount = filteredUrls.length - (selectedUrls.length - filteredUrls.length);
    status.textContent = `已添加 ${filteredUrls.length} 个URL到TODO列表`;
    progressBar.style.width = '100%';
    
  } catch (error) {
    console.error('Error storing to todo:', error);
    status.textContent = `错误: ${error.message}`;
    progressBar.style.width = '0%';
  }
}

async function startTodoDownload(delaySeconds) {
  const status = document.getElementById('status');
  const progressBar = document.getElementById('progressBar');
  
  const todoList = await getTodoList();
  const pendingItems = todoList.filter(item => item.status === 'pending');
  
  if (pendingItems.length === 0) {
    status.textContent = '没有待下载的任务';
    progressBar.style.width = '0%';
    return;
  }
  
  status.textContent = `开始下载 ${pendingItems.length} 个任务...`;
  progressBar.style.width = '30%';
  
  const acsItems = pendingItems.filter(item => item.site === 'acs');
  const natureItems = pendingItems.filter(item => item.site === 'nature');
  const rscItems = pendingItems.filter(item => item.site === 'rsc');
  const options = getDownloadOptions();
  
  if (acsItems.length > 0) {
    browser.runtime.sendMessage({
      action: 'start_download',
      urls: acsItems,
      delay: delaySeconds,
      type: 'acs',
      fromTodo: true,
      options: options
    });
  }
  
  if (natureItems.length > 0) {
    browser.runtime.sendMessage({
      action: 'start_nature_download',
      urls: natureItems,
      fromTodo: true,
      options: options
    });
  }
  
  if (rscItems.length > 0) {
    browser.runtime.sendMessage({
      action: 'start_rsc_download',
      urls: rscItems,
      fromTodo: true,
      options: options
    });
  }
  
  status.textContent = '下载任务已发送';
  progressBar.style.width = '100%';
  
  setTimeout(() => {
    window.close();
  }, 1500);
}

async function handleACSAll(delay) {
  const status = document.getElementById('status');
  const progressBar = document.getElementById('progressBar');
  
  status.textContent = '检查当前网站...';
  progressBar.style.width = '20%';
  
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    
    if (!tab.url.includes('pubs.acs.org')) {
      status.textContent = '请先访问 https://pubs.acs.org/';
      progressBar.style.width = '0%';
      return;
    }
    
    status.textContent = '获取文章列表...';
    progressBar.style.width = '40%';
    
    const result = await browser.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractACSUrls
    });
    
    let urlList = [];
    if (result && result[0] && Array.isArray(result[0].result)) {
      urlList = result[0].result;
    } else if (result && result[0] && Array.isArray(result[0])) {
      urlList = result[0];
    }
    
    const filteredUrls = urlList.filter(url => !isBlacklisted(url));
    const skippedCount = urlList.length - filteredUrls.length;
    
    console.log('Found ACS URLs:', urlList.length, '- skipped:', skippedCount);
    
    if (!Array.isArray(filteredUrls) || filteredUrls.length === 0) {
      status.textContent = skippedCount > 0 ? '所有文章都在黑名单中' : '未找到文章链接';
      progressBar.style.width = '0%';
      return;
    }
    
    status.textContent = `开始下载 ${filteredUrls.length} 篇文章...`;
    if (skippedCount > 0) {
      status.textContent += ` (跳过 ${skippedCount} 个黑名单链接)`;
    }
    progressBar.style.width = '70%';
    
    const options = getDownloadOptions();
    
    try {
      const response = await browser.runtime.sendMessage({
        action: 'start_download',
        urls: filteredUrls.map(url => ({ url, name: getFileName(url), site: 'acs' })),
        delay: delay,
        type: 'acs',
        options: options
      });
      
      if (response && response.status === 'started') {
        status.textContent = `下载任务已发送！(${response.total}篇)`;
        progressBar.style.width = '100%';
        
        setTimeout(() => {
          window.close();
        }, 2000);
      } else {
        status.textContent = '发送下载任务失败';
        progressBar.style.width = '0%';
      }
    } catch (error) {
      console.error('发送消息失败:', error);
      status.textContent = `发送失败: ${error.message}`;
      progressBar.style.width = '0%';
    }
    
  } catch (error) {
    console.error('Error in handleACSAll:', error);
    status.textContent = `错误: ${error.message}`;
    progressBar.style.width = '0%';
  }
}

async function handleACSSelect() {
  const status = document.getElementById('status');
  const progressBar = document.getElementById('progressBar');
  
  status.textContent = '检查当前网站...';
  progressBar.style.width = '20%';
  
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    
    if (!tab.url.includes('pubs.acs.org')) {
      status.textContent = '请先访问 https://pubs.acs.org/';
      progressBar.style.width = '0%';
      return;
    }
    
    status.textContent = '开启选择模式...';
    progressBar.style.width = '50%';
    
    browser.tabs.sendMessage(tab.id, { action: 'toggle_acs' }, (response) => {
      console.log('ACS toggle response:', response);
      if (browser.runtime.lastError) {
        console.log('Runtime error:', browser.runtime.lastError.message);
        status.textContent = '请刷新页面后重试';
        progressBar.style.width = '0%';
        return;
      }
      
      if (response && response.status === 'activated') {
        status.textContent = 'ACS选择模式已开启！';
        progressBar.style.width = '100%';
      } else if (response && response.status === 'deactivated') {
        status.textContent = 'ACS选择模式已关闭';
        progressBar.style.width = '0%';
      } else {
        status.textContent = '选择模式已切换';
        progressBar.style.width = '100%';
      }
      
      setTimeout(() => {
        window.close();
      }, 2000);
    });
    
  } catch (error) {
    console.error('Error in handleACSSelect:', error);
    status.textContent = `错误: ${error.message}`;
    progressBar.style.width = '0%';
  }
}

async function handleNatureAll(delay) {
  const status = document.getElementById('status');
  const progressBar = document.getElementById('progressBar');
  
  status.textContent = '检查当前网站...';
  progressBar.style.width = '20%';
  
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    
    if (!tab.url.includes('nature.com')) {
      status.textContent = '请先访问 https://www.nature.com/';
      progressBar.style.width = '0%';
      return;
    }
    
    status.textContent = '获取文章列表...';
    progressBar.style.width = '40%';
    
    const result = await browser.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractNatureUrls
    });
    
    let urlList = [];
    if (result && result[0] && Array.isArray(result[0].result)) {
      urlList = result[0].result;
    } else if (result && result[0] && Array.isArray(result[0])) {
      urlList = result[0];
    }
    
    const filteredUrls = urlList.filter(url => !isBlacklisted(url));
    const skippedCount = urlList.length - filteredUrls.length;
    
    console.log('Found Nature URLs:', urlList.length, '- skipped:', skippedCount);
    
    if (!Array.isArray(filteredUrls) || filteredUrls.length === 0) {
      status.textContent = skippedCount > 0 ? '所有文章都在黑名单中' : '未找到文章链接';
      progressBar.style.width = '0%';
      return;
    }
    
    status.textContent = `开始下载 ${filteredUrls.length} 篇文章...`;
    if (skippedCount > 0) {
      status.textContent += ` (跳过 ${skippedCount} 个黑名单链接)`;
    }
    progressBar.style.width = '70%';
    
    const options = getDownloadOptions();
    
    try {
      const response = await browser.runtime.sendMessage({
        action: 'start_nature_download',
        urls: filteredUrls.map(url => ({ url, name: getFileName(url), site: 'nature' })),
        options: options
      });
      
      if (response && response.status === 'started') {
        status.textContent = `下载任务已发送！(${response.total}篇)`;
        progressBar.style.width = '100%';
        
        setTimeout(() => {
          window.close();
        }, 2000);
      } else {
        status.textContent = '发送下载任务失败';
        progressBar.style.width = '0%';
      }
    } catch (error) {
      console.error('发送消息失败:', error);
      status.textContent = `发送失败: ${error.message}`;
      progressBar.style.width = '0%';
    }
    
  } catch (error) {
    console.error('Error in handleNatureAll:', error);
    status.textContent = `错误: ${error.message}`;
    progressBar.style.width = '0%';
  }
}

async function handleNatureSelect() {
  const status = document.getElementById('status');
  const progressBar = document.getElementById('progressBar');
  
  status.textContent = '检查当前网站...';
  progressBar.style.width = '20%';
  
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    
    if (!tab.url.includes('nature.com')) {
      status.textContent = '请先访问 https://www.nature.com/';
      progressBar.style.width = '0%';
      return;
    }
    
    status.textContent = '开启选择模式...';
    progressBar.style.width = '50%';
    
    browser.tabs.sendMessage(tab.id, { action: 'toggle_nature' }, (response) => {
      console.log('Nature toggle response:', response);
      if (browser.runtime.lastError) {
        console.log('Runtime error:', browser.runtime.lastError.message);
        status.textContent = '请刷新页面后重试';
        progressBar.style.width = '0%';
        return;
      }
      
      if (response && response.status === 'activated') {
        status.textContent = 'Nature选择模式已开启！';
        progressBar.style.width = '100%';
      } else if (response && response.status === 'deactivated') {
        status.textContent = 'Nature选择模式已关闭';
        progressBar.style.width = '0%';
      } else {
        status.textContent = '选择模式已切换';
        progressBar.style.width = '100%';
      }
      
      setTimeout(() => {
        window.close();
      }, 2000);
    });
    
  } catch (error) {
    console.error('Error in handleNatureSelect:', error);
    status.textContent = `错误: ${error.message}`;
    progressBar.style.width = '0%';
  }
}

async function handleRscAll(delay) {
  const status = document.getElementById('status');
  const progressBar = document.getElementById('progressBar');
  
  status.textContent = '检查当前网站...';
  progressBar.style.width = '20%';
  
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    
    if (!tab.url.includes('pubs.rsc.org')) {
      status.textContent = '请先访问 https://pubs.rsc.org/';
      progressBar.style.width = '0%';
      return;
    }
    
    status.textContent = '获取文章列表...';
    progressBar.style.width = '40%';
    
    const result = await browser.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractRscUrls
    });
    
    let urlList = [];
    if (result && result[0] && Array.isArray(result[0].result)) {
      urlList = result[0].result;
    } else if (result && result[0] && Array.isArray(result[0])) {
      urlList = result[0];
    }
    
    const filteredUrls = urlList.filter(url => !isBlacklisted(url));
    const skippedCount = urlList.length - filteredUrls.length;
    
    console.log('Found RSC URLs:', urlList.length, '- skipped:', skippedCount);
    
    if (!Array.isArray(filteredUrls) || filteredUrls.length === 0) {
      status.textContent = skippedCount > 0 ? '所有文章都在黑名单中' : '未找到文章链接';
      progressBar.style.width = '0%';
      return;
    }
    
    status.textContent = `开始下载 ${filteredUrls.length} 篇文章...`;
    if (skippedCount > 0) {
      status.textContent += ` (跳过 ${skippedCount} 个黑名单链接)`;
    }
    progressBar.style.width = '70%';
    
    const options = getDownloadOptions();
    
    try {
      const response = await browser.runtime.sendMessage({
        action: 'start_rsc_download',
        urls: filteredUrls.map(url => ({ url, name: getFileName(url), site: 'rsc' })),
        options: options
      });
      
      if (response && response.status === 'started') {
        status.textContent = `下载任务已发送！(${response.total}篇)`;
        progressBar.style.width = '100%';
        
        setTimeout(() => {
          window.close();
        }, 2000);
      } else {
        status.textContent = '发送下载任务失败';
        progressBar.style.width = '0%';
      }
    } catch (error) {
      console.error('发送消息失败:', error);
      status.textContent = `发送失败: ${error.message}`;
      progressBar.style.width = '0%';
    }
    
  } catch (error) {
    console.error('Error in handleRscAll:', error);
    status.textContent = `错误: ${error.message}`;
    progressBar.style.width = '0%';
  }
}

async function handleRscSelect() {
  const status = document.getElementById('status');
  const progressBar = document.getElementById('progressBar');
  
  status.textContent = '检查当前网站...';
  progressBar.style.width = '20%';
  
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    
    if (!tab.url.includes('pubs.rsc.org')) {
      status.textContent = '请先访问 https://pubs.rsc.org/';
      progressBar.style.width = '0%';
      return;
    }
    
    status.textContent = '开启选择模式...';
    progressBar.style.width = '50%';
    
    browser.tabs.sendMessage(tab.id, { action: 'toggle_rsc' }, (response) => {
      console.log('RSC toggle response:', response);
      if (browser.runtime.lastError) {
        console.log('Runtime error:', browser.runtime.lastError.message);
        status.textContent = '请刷新页面后重试';
        progressBar.style.width = '0%';
        return;
      }
      
      if (response && response.status === 'activated') {
        status.textContent = 'RSC选择模式已开启！';
        progressBar.style.width = '100%';
      } else if (response && response.status === 'deactivated') {
        status.textContent = 'RSC选择模式已关闭';
        progressBar.style.width = '0%';
      } else {
        status.textContent = '选择模式已切换';
        progressBar.style.width = '100%';
      }
      
      setTimeout(() => {
        window.close();
      }, 2000);
    });
    
  } catch (error) {
    console.error('Error in handleRscSelect:', error);
    status.textContent = `错误: ${error.message}`;
    progressBar.style.width = '0%';
  }
}

function extractACSUrls() {
  const urls = [];
  const links = document.querySelectorAll('h3.issue-item_title a, .issue-item_title a');
  
  links.forEach(link => {
    const href = link.getAttribute('href');
    if (href && href.includes('/doi/')) {
      const fullUrl = href.startsWith('http') ? href : 'https://pubs.acs.org' + href;
      if (fullUrl.includes('pubs.acs.org') && !urls.includes(fullUrl)) {
        urls.push(fullUrl);
      }
    }
  });
  
  return urls;
}

function extractNatureUrls() {
  const urls = [];
  const links = document.querySelectorAll('h3 a, h2 a');
  
  links.forEach(link => {
    const href = link.getAttribute('href');
    if (href && href.includes('/articles/')) {
      const fullUrl = href.startsWith('http') ? href : 'https://www.nature.com' + href;
      if (fullUrl.includes('nature.com') && !urls.includes(fullUrl)) {
        urls.push(fullUrl);
      }
    }
  });
  
  return urls;
}

function extractRscUrls() {
  const urls = [];
  // 根据用户提供的 class 选择器：capsule capsule--article
  const links = document.querySelectorAll('a.capsule.capsule--article');
  console.log('Found RSC capsule links:', links.length);
  
  links.forEach(link => {
    const href = link.getAttribute('href');
    if (href) {
      const fullUrl = href.startsWith('http') ? href : 'https://pubs.rsc.org' + href;
      if (fullUrl.includes('pubs.rsc.org') && !urls.includes(fullUrl)) {
        urls.push(fullUrl);
        console.log('Added RSC URL:', fullUrl);
      }
    }
  });
  
  // 备用方案：查找所有 articlelanding 链接
  if (urls.length === 0) {
    console.log('No URLs from capsule class, trying all articlelanding links...');
    const allLinks = document.querySelectorAll('a[href*="/articlelanding/"]');
    allLinks.forEach(link => {
      const href = link.getAttribute('href');
      if (href) {
        const fullUrl = href.startsWith('http') ? href : 'https://pubs.rsc.org' + href;
        if (fullUrl.includes('pubs.rsc.org') && !urls.includes(fullUrl)) {
          urls.push(fullUrl);
        }
      }
    });
  }
  
  console.log('Extracted RSC URLs:', urls);
  return urls;
}

function getFileName(url) {
  try {
    const parts = url.split('/');
    return parts[parts.length - 1].replace(/_/g, '-');
  } catch {
    return `article-${Date.now()}`;
  }
}

function sendMessageWithTimeout(tabId, message, timeout = 5000) {
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      resolve(null);
    }, timeout);
    
    browser.tabs.sendMessage(tabId, message, (response) => {
      clearTimeout(timeoutId);
      if (chrome.runtime.lastError) {
        resolve(null);
      } else {
        resolve(response);
      }
    });
  });
}