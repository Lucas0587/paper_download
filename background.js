const browser = (typeof chrome !== 'undefined') ? chrome : browser;

let downloadQueue = [];
let isProcessing = false;
let currentArticle = null;
let currentDelay = 5000;
let fromTodo = false;
let shouldStop = false;
let shouldSkip = false;
let downloadOptions = {
  downloadMain: true,
  downloadSI: true
};

let queryKeywords = [];
let currentDownloadStartTime = null;
let stuckCheckInterval = null;
let manualDownloadList = [];
let queueLock = false;
let isInitialized = false;

async function loadDownloadOptions() {
  try {
    const result = await browser.storage.local.get('downloadOptions');
    if (result.downloadOptions) {
      downloadOptions = result.downloadOptions;
      console.log('Download options loaded from storage:', downloadOptions);
    }
  } catch (error) {
    console.log('Could not load download options:', error);
  }
}

async function loadManualDownloadList() {
  try {
    const result = await browser.storage.local.get('manualDownloadList');
    if (result.manualDownloadList) {
      manualDownloadList = result.manualDownloadList;
      console.log('Manual download list loaded:', manualDownloadList.length, 'items');
    }
  } catch (error) {
    console.log('Could not load manual download list:', error);
  }
}

async function initQueryKeywords() {
  try {
    const url = chrome.runtime.getURL('query.txt');
    console.log('初始化读取 query.txt:', url);
    const response = await fetch(url);
    if (!response.ok) {
      console.error('query.txt 读取失败, 状态码:', response.status);
      return;
    }
    const text = await response.text();
    queryKeywords = text.split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));
    console.log('初始化查询关键词:', queryKeywords);
  } catch (error) {
    console.error('初始化 query.txt 失败:', error);
    queryKeywords = [];
  }
}

async function initExtension() {
  console.log('========== 初始化扩展 ==========');
  await initQueryKeywords();
  await loadManualDownloadList();
  isInitialized = true;
  console.log('========== 初始化完成 ==========');
}

initExtension();

browser.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  if (!isInitialized && message.action !== 'load_query') {
    console.log('扩展尚未初始化完成，等待中...');
    while (!isInitialized) {
      await delay(100);
    }
  }
  if (message.action === 'start_download') {
    await loadDownloadOptions();
    if (message.options) {
      downloadOptions = message.options;
    }
    console.log('========== 添加ACS到下载队列 ==========');
    console.log('添加文章:', message.urls.map(u => u.name));
    console.log('Download options:', downloadOptions);
    const acsItems = message.urls.map(u => ({...u, site: 'acs'}));
    
    while (queueLock) {
      await delay(100);
    }
    queueLock = true;
    downloadQueue = [...downloadQueue, ...acsItems];
    queueLock = false;
    
    currentDelay = (message.delay || 5) * 1000;
    fromTodo = message.fromTodo || false;
    shouldStop = false;
    shouldSkip = false;
    
    if (!isProcessing) {
      isProcessing = true;
      processQueue();
    }
    sendResponse({ status: 'started', total: downloadQueue.length });
    return true;
  } else if (message.action === 'start_nature_download') {
    await loadDownloadOptions();
    if (message.options) {
      downloadOptions = message.options;
    }
    console.log('========== 添加Nature到下载队列 ==========');
    console.log('添加文章:', message.urls.map(u => u.name));
    console.log('Download options:', downloadOptions);
    const natureItems = message.urls.map(u => ({...u, site: 'nature'}));
    
    while (queueLock) {
      await delay(100);
    }
    queueLock = true;
    downloadQueue = [...downloadQueue, ...natureItems];
    queueLock = false;
    
    currentDelay = (message.delay || 5) * 1000;
    fromTodo = message.fromTodo || false;
    shouldStop = false;
    shouldSkip = false;
    
    if (!isProcessing) {
      isProcessing = true;
      processQueue();
    }
    sendResponse({ status: 'started', total: downloadQueue.length });
    return true;
  } else if (message.action === 'start_rsc_download') {
    await loadDownloadOptions();
    if (message.options) {
      downloadOptions = message.options;
    }
    console.log('========== 添加RSC到下载队列 ==========');
    console.log('添加文章:', message.urls.map(u => u.name));
    console.log('Download options:', downloadOptions);
    const rscItems = message.urls.map(u => ({...u, site: 'rsc'}));
    
    while (queueLock) {
      await delay(100);
    }
    queueLock = true;
    downloadQueue = [...downloadQueue, ...rscItems];
    queueLock = false;
    
    currentDelay = (message.delay || 5) * 1000;
    fromTodo = message.fromTodo || false;
    shouldStop = false;
    shouldSkip = false;
    
    if (!isProcessing) {
      isProcessing = true;
      processQueue();
    }
    sendResponse({ status: 'started', total: downloadQueue.length });
    return true;
  } else if (message.action === 'download_file_direct') {
    downloadFile(message.url, message.filename);
    sendResponse({ status: 'downloading' });
  } else if (message.action === 'get_status') {
    sendResponse({ 
      processing: isProcessing, 
      queueLength: downloadQueue.length,
      currentArticle: currentArticle 
    });
  } else if (message.action === 'skip_wait') {
    console.log('========== 跳过等待 ==========');
    shouldSkip = true;
    
    // 向所有相关标签页发送隐藏倒计时的消息
    const sitePatterns = [
      '*://pubs.acs.org/*',
      '*://www.nature.com/*',
      '*://pubs.rsc.org/*'
    ];
    
    try {
      for (const pattern of sitePatterns) {
        const tabs = await browser.tabs.query({ url: pattern });
        tabs.forEach(tab => {
          browser.tabs.sendMessage(tab.id, { 
            action: 'update_wait_time', 
            isWaiting: false
          }).catch(() => {});
        });
      }
    } catch (e) {}
    
    sendResponse({ status: 'skipped' });
  } else if (message.action === 'reset_download') {
    console.log('========== 重置下载 ==========');
    shouldStop = true;
    shouldSkip = true;
    isProcessing = false;
    downloadQueue = [];
    currentArticle = null;
    fromTodo = false;
    sendResponse({ status: 'reset' });
  } else if (message.action === 'load_query') {
    console.log('========== 加载查询关键词 ==========');
    console.log('当前关键词:', queryKeywords);
    sendResponse({ keywords: queryKeywords });
  } else if (message.action === 'get_manual_downloads') {
    const result = await browser.storage.local.get('manualDownloadList');
    sendResponse({ list: result.manualDownloadList || [] });
  } else if (message.action === 'clear_manual_downloads') {
    manualDownloadList = [];
    await browser.storage.local.set({ manualDownloadList: [] });
    sendResponse({ status: 'cleared' });
  } else if (message.action === 'remove_manual_download') {
    const url = message.url;
    const result = await browser.storage.local.get('manualDownloadList');
    let currentList = result.manualDownloadList || [];
    currentList = currentList.filter(item => item.url !== url);
    manualDownloadList = currentList;
    await browser.storage.local.set({ manualDownloadList: currentList });
    sendResponse({ status: 'removed' });
  } else if (message.action === 'add_to_manual_downloads') {
    const item = message.item;
    const result = await browser.storage.local.get('manualDownloadList');
    let currentList = result.manualDownloadList || [];
    const exists = currentList.some(m => m.url === item.url);
    if (!exists) {
      currentList.push(item);
      manualDownloadList = currentList;
      await browser.storage.local.set({ manualDownloadList: currentList });
      console.log('添加到手动下载列表:', item.name);
    }
    sendResponse({ status: 'added' });
  }
});

async function processQueue() {
  console.log('========== 开始处理下载队列 ==========');
  console.log('队列总数:', downloadQueue.length);
  shouldStop = false;
  shouldSkip = false;
  
  if (fromTodo) {
    startStuckCheck();
  }
  
  while (downloadQueue.length > 0 && isProcessing && !shouldStop) {
    // 在每次下载前重置 shouldSkip
    shouldSkip = false;
    
    const item = downloadQueue.shift();
    currentArticle = item.name;
    console.log('>>>>> 开始下载:', item.name, '(', item.site, ')', '剩余:', downloadQueue.length);
    
    if (shouldStop) {
      console.log('收到停止信号，中断下载');
      break;
    }
    
    let success = false;
    
    // 使用独立的 try-catch 包裹整个下载流程
    try {
      if (fromTodo) {
        await updateTodoItemStatus(item.url, 'downloading');
      }
      
      try {
        const options = await getStoredDownloadOptions();
        if (item.site === 'nature') {
          success = await downloadNatureArticle(item.url, item.name, options);
        } else if (item.site === 'rsc') {
          success = await downloadRscArticle(item.url, item.name, options);
        } else {
          success = await downloadACSArticle(item.url, item.name, options);
        }
      } catch (downloadError) {
        console.error(`  [${item.site}] 下载函数执行失败:`, downloadError);
        success = false;
      }
      
      // 确保 TODO 列表状态更新
      try {
        if (fromTodo && success) {
          await removeTodoItem(item.url);
        } else if (fromTodo && !success) {
          await updateTodoItemStatus(item.url, 'pending');
        }
      } catch (todoError) {
        console.error('  [队列] 更新 TODO 状态失败:', todoError);
      }
      
    } catch (generalError) {
      console.error('  [队列] 处理文章流程异常:', generalError);
    }
    
    // 无论成功或失败，都继续处理下一篇
    if (downloadQueue.length > 0 && !shouldStop) {
      try {
        const nextItem = downloadQueue[0];
        
        if (nextItem.site === 'rsc') {
          console.log('等待30秒后下载下一篇（RSC网站）...');
          await showCountdown(30, 'rsc');
        } else {
          const minDelay = Math.max(3000, currentDelay * 0.5);
          const maxDelay = Math.min(15000, currentDelay * 1.5);
          const randomDelay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
          console.log('等待', randomDelay/1000, '秒后下载下一篇...');
          await delay(randomDelay);
        }
      } catch (waitError) {
        console.error('  [队列] 等待下一篇出错:', waitError);
        // 出错也继续，不要卡死
      }
    }
  }
  
  console.log('========== 下载队列完成 ==========');
  isProcessing = false;
  currentArticle = null;
  downloadQueue = [];
  shouldStop = false;
  shouldSkip = false;
  stopStuckCheck();
}

async function getStoredDownloadOptions() {
  const result = await browser.storage.local.get('downloadOptions');
  return result.downloadOptions || { downloadMain: true, downloadSI: true };
}

async function getTodoList() {
  const result = await browser.storage.local.get('todoList');
  return result.todoList || [];
}

async function updateTodoItemStatus(url, status) {
  const todoList = await getTodoList();
  const itemIndex = todoList.findIndex(item => item.url === url);
  
  if (itemIndex !== -1) {
    todoList[itemIndex].status = status;
    if (status === 'downloading') {
      todoList[itemIndex].startTime = Date.now();
    } else if (status === 'pending' || status === 'completed') {
      todoList[itemIndex].startTime = null;
    }
    await browser.storage.local.set({ todoList });
  }
}

async function removeTodoItem(url) {
  const todoList = await getTodoList();
  const newTodoList = todoList.filter(item => item.url !== url);
  await browser.storage.local.set({ todoList: newTodoList });
}

function startStuckCheck() {
  if (stuckCheckInterval) {
    clearInterval(stuckCheckInterval);
  }
  
  stuckCheckInterval = setInterval(async () => {
    if (!isProcessing || !fromTodo) return;
    
    console.log('========== 检查下载任务是否卡住 ==========');
    const todoList = await getTodoList();
    const now = Date.now();
    const stuckThreshold = 5 * 60 * 1000;
    
    const stuckItems = todoList.filter(item => {
      if (item.status === 'downloading' && item.startTime) {
        const elapsed = now - item.startTime;
        console.log(`任务 "${item.name}" 已下载 ${Math.floor(elapsed / 1000)} 秒`);
        return elapsed > stuckThreshold;
      }
      return false;
    });
    
    if (stuckItems.length > 0) {
      console.log(`检测到 ${stuckItems.length} 个任务卡住！`);
      
      shouldStop = true;
      shouldSkip = true;
      
      for (const item of stuckItems) {
        console.log(`任务 "${item.name}" 卡住超过5分钟，移至手动下载列表`);
        await removeTodoItem(item.url);
        
        const manualItem = {
          ...item,
          status: 'manual',
          movedAt: Date.now()
        };
        const result = await browser.storage.local.get('manualDownloadList');
        let currentList = result.manualDownloadList || [];
        currentList.push(manualItem);
        manualDownloadList = currentList;
        
        await browser.storage.local.set({ manualDownloadList: currentList });
        
        downloadQueue = downloadQueue.filter(q => q.url !== item.url);
      }
      
      console.log(`已将 ${stuckItems.length} 个任务移至手动下载列表`);
      
      setTimeout(() => {
        shouldStop = false;
        shouldSkip = false;
        
        if (!isProcessing) {
          isProcessing = true;
          processQueue();
        }
      }, 1000);
    }
  }, 5 * 60 * 1000);
  
  console.log('已启动卡住任务检查（每5分钟）');
}

function stopStuckCheck() {
  if (stuckCheckInterval) {
    clearInterval(stuckCheckInterval);
    stuckCheckInterval = null;
    console.log('已停止卡住任务检查');
  }
}

async function checkTabExists(tabId) {
  try {
    const tab = await browser.tabs.get(tabId);
    return !!tab;
  } catch (error) {
    return false;
  }
}

async function safeRemoveTab(tabId) {
  try {
    const exists = await checkTabExists(tabId);
    if (exists) {
      await browser.tabs.remove(tabId);
    }
  } catch (error) {
    console.log('  标签页已关闭或不存在');
  }
}

async function downloadACSArticle(url, name, options = { downloadMain: true, downloadSI: true }) {
  console.log('═══════════════════════════════════════════════════');
  console.log('  [ACS] ▶ 开始处理:', name);
  console.log('  [ACS] 详情页URL:', url);
  console.log('  [ACS] 下载选项:', options);
  console.log('═══════════════════════════════════════════════════');
  
  return new Promise((resolve) => {
    let success = false;
    let tabListener = null;
    let timeoutId = null;
    let articleTabId = null;
    let checkIntervalId = null;
    
    function cleanup() {
      console.log('  [ACS] 执行 cleanup()...');
      if (tabListener) {
        try {
          browser.tabs.onUpdated.removeListener(tabListener);
          console.log('  [ACS] ✓ 监听器已移除');
        } catch (e) {
          console.warn('  [ACS] 移除监听器失败:', e);
        }
        tabListener = null;
      }
      if (timeoutId) {
        clearTimeout(timeoutId);
        console.log('  [ACS] ✓ 超时定时器已清除');
        timeoutId = null;
      }
      if (checkIntervalId) {
        clearInterval(checkIntervalId);
        console.log('  [ACS] ✓ 主动检查定时器已清除');
        checkIntervalId = null;
      }
      if (articleTabId) {
        safeRemoveTab(articleTabId).then(() => {
          console.log('  [ACS] ✓ 标签页已关闭');
        }).catch(() => {});
        articleTabId = null;
      }
    }
    
    console.log('  [ACS] 步骤1: 提前注册事件监听器...');
    
    // 提前注册事件监听器，防止错过事件
    tabListener = (tabId, info) => {
      console.log(`  [ACS] → tabs.onUpdated 事件: tabId=${tabId}(${typeof tabId}), articleTabId=${articleTabId}(${typeof articleTabId}), status=${info.status}`);
      
      if (!articleTabId) {
        console.log('  [ACS]   articleTabId 尚未设置，等待标签页创建...');
        return;
      }
      
      const tabIdNum = Number(tabId);
      const articleTabIdNum = Number(articleTabId);
      
      console.log(`  [ACS]   转换后: tabId=${tabIdNum}, articleTabId=${articleTabIdNum}, 相等=${tabIdNum === articleTabIdNum}`);
      
      if (tabIdNum !== articleTabIdNum) {
        console.log('  [ACS]   忽略: 不是目标标签页');
        return;
      }
      if (info.status !== 'complete') {
        console.log('  [ACS]   忽略: 页面未完成加载');
        return;
      }
      
      // 页面加载完成，清理定时器并执行后续操作
      if (checkIntervalId) {
        clearInterval(checkIntervalId);
        checkIntervalId = null;
      }
      
      console.log('  [ACS] ✓ 通过事件监听器捕获到页面加载完成！');
      console.log('  [ACS] 移除监听器...');
      browser.tabs.onUpdated.removeListener(tabListener);
      tabListener = null;
      
      console.log('  [ACS] 步骤2: 执行异步处理...');
      (async () => {
        try {
          console.log('  [ACS] → 调用 showCountdown(6, "acs")...');
          await showCountdown(6, 'acs');
          console.log('  [ACS] ✓ showCountdown 完成');
          
          console.log('  [ACS] 检查标签页状态...');
          const tabExists = await checkTabExists(articleTabId);
          if (!tabExists || shouldStop) {
            console.log('  [ACS] ⚠ 标签页已关闭或下载已停止');
            cleanup();
            resolve(success);
            return;
          }
          
          console.log('  [ACS] 步骤3: 提取主PDF链接...');
          console.log('  [ACS] → browser.scripting.executeScript()');
          const pdfResult = await browser.scripting.executeScript({
            target: { tabId: articleTabId },
            function: extractACSPdfUrl
          });
          
          const pdfUrl = pdfResult[0].result;
          console.log('  [ACS] ✓ 脚本执行成功');
          console.log('  [ACS]   主PDF链接:', pdfUrl);
          
          let downloadedFiles = 0;
          
          if (pdfUrl && options.downloadMain) {
            console.log('  [ACS] → 调用 downloadFile():', pdfUrl);
            await downloadFile(pdfUrl, `${name}.pdf`);
            downloadedFiles++;
            console.log('  [ACS] ✓ 主PDF下载完成');
            
            console.log('  [ACS] → 调用 showCountdown(3, "acs")...');
            await showCountdown(3, 'acs');
            console.log('  [ACS] ✓ 等待完成');
          } else if (!pdfUrl) {
            console.log('  [ACS] ⏭ 未找到主PDF！');
          } else {
            console.log('  [ACS] ⏭ 跳过主PDF下载（选项已关闭）');
          }
          
          console.log('  [ACS] 检查标签页状态...');
          const stillExists = await checkTabExists(articleTabId);
          if (!stillExists || shouldStop) {
            console.log('  [ACS] ⚠ 标签页已关闭或下载已停止');
            cleanup();
            resolve(success);
            return;
          }
          
          console.log('  [ACS] 步骤4: 提取支持信息...');
          console.log('  [ACS] → extractACSSupportingInfoWithRetry()');
          const supportingInfoUrls = await extractACSSupportingInfoWithRetry(articleTabId);
          console.log('  [ACS] ✓ 支持信息提取完成');
          console.log('  [ACS]   支持信息数量:', supportingInfoUrls.length);
          
          if (options.downloadSI && supportingInfoUrls.length > 0) {
            console.log('  [ACS] 步骤5: 下载支持信息');
            for (let j = 0; j < supportingInfoUrls.length; j++) {
              console.log(`  [ACS] 处理SI ${j + 1}/${supportingInfoUrls.length}`);
              
              const existsAgain = await checkTabExists(articleTabId);
              if (!existsAgain || shouldStop) {
                console.log('  [ACS] ⚠ 标签页已关闭或下载已停止');
                break;
              }
              
              const suffix = String(j + 1).padStart(3, '0');
              console.log('  [ACS] → 调用 downloadFile():', supportingInfoUrls[j]);
              await downloadFile(supportingInfoUrls[j], `${name}_si_${suffix}.pdf`);
              downloadedFiles++;
              console.log('  [ACS] ✓ SI下载完成');
              
              if (j < supportingInfoUrls.length - 1) {
                console.log('  [ACS] → 调用 showCountdown(2, "acs")...');
                await showCountdown(2, 'acs');
                console.log('  [ACS] ✓ 等待完成');
              }
            }
          } else if (!options.downloadSI) {
            console.log('  [ACS] ⏭ 跳过支持信息下载（选项已关闭）');
          } else {
            console.log('  [ACS] ⏭ 未找到支持信息');
          }
          
          success = downloadedFiles > 0;
          console.log(`  [ACS] ═══════════════════════════════════════════`);
          console.log(`  [ACS] ✓ 完成！共下载 ${downloadedFiles} 个文件`);
          console.log(`  [ACS] ═══════════════════════════════════════════`);
          
          cleanup();
          console.log('  [ACS] → Promise resolve()');
          resolve(success);
          
        } catch (error) {
          console.error('  [ACS] ✗ 处理错误:', error);
          console.error('  [ACS] ✗ 错误详情:', error.stack);
          cleanup();
          resolve(success);
        }
      })().catch(e => console.error('  [ACS] ✗ async IIFE 错误:', e));
    };
    
    console.log('  [ACS] 事件监听器已提前注册');
    browser.tabs.onUpdated.addListener(tabListener);
    
    console.log('  [ACS] 步骤1a: 创建后台标签页...');
    console.log('  [ACS] → browser.tabs.create()');
    
    browser.tabs.create({ url: url, active: false }, (articleTab) => {
      console.log('  [ACS] → browser.tabs.create() 回调触发, tab:', !!articleTab, articleTab?.id);
      
      if (!articleTab || !articleTab.id) {
        console.error('  [ACS] ✗ 创建标签页失败！');
        cleanup();
        resolve(success);
        return;
      }
      
      articleTabId = articleTab.id;
      console.log('  [ACS] ✓ 标签页创建成功, ID:', articleTabId);
      
      console.log('  [ACS] 设置超时定时器: 120000ms');
      timeoutId = setTimeout(() => {
        console.error('  [ACS] ✗ 页面加载超时！');
        cleanup();
        resolve(success);
      }, 120000);
      
      // 添加主动查询检查，防止事件错过
      console.log('  [ACS] 启动主动查询检查...');
      let checkCount = 0;
      checkIntervalId = setInterval(async () => {
        checkCount++;
        console.log(`  [ACS] → 主动检查 #${checkCount}...`);
        
        try {
          const tabInfo = await browser.tabs.get(articleTabId);
          console.log(`  [ACS]   当前标签页状态: ${tabInfo.status}`);
          
          if (tabInfo.status === 'complete') {
            console.log('  [ACS] ✓ 通过主动查询检查到页面加载完成！');
            clearInterval(checkIntervalId);
            checkIntervalId = null;
            
            // 移除事件监听器
            if (tabListener) {
              browser.tabs.onUpdated.removeListener(tabListener);
              tabListener = null;
            }
            
            // 执行相同的下载逻辑
            console.log('  [ACS] 步骤2: 执行异步处理...');
            (async () => {
              try {
                console.log('  [ACS] → 调用 showCountdown(6, "acs")...');
                await showCountdown(6, 'acs');
                console.log('  [ACS] ✓ showCountdown 完成');
                
                console.log('  [ACS] 检查标签页状态...');
                const tabExists = await checkTabExists(articleTabId);
                if (!tabExists || shouldStop) {
                  console.log('  [ACS] ⚠ 标签页已关闭或下载已停止');
                  cleanup();
                  resolve(success);
                  return;
                }
                
                console.log('  [ACS] 步骤3: 提取主PDF链接...');
                console.log('  [ACS] → browser.scripting.executeScript()');
                const pdfResult = await browser.scripting.executeScript({
                  target: { tabId: articleTabId },
                  function: extractACSPdfUrl
                });
                
                const pdfUrl = pdfResult[0].result;
                console.log('  [ACS] ✓ 脚本执行成功');
                console.log('  [ACS]   主PDF链接:', pdfUrl);
                
                let downloadedFiles = 0;
                
                if (pdfUrl && options.downloadMain) {
                  console.log('  [ACS] → 调用 downloadFile():', pdfUrl);
                  await downloadFile(pdfUrl, `${name}.pdf`);
                  downloadedFiles++;
                  console.log('  [ACS] ✓ 主PDF下载完成');
                  
                  console.log('  [ACS] → 调用 showCountdown(3, "acs")...');
                  await showCountdown(3, 'acs');
                  console.log('  [ACS] ✓ 等待完成');
                } else if (!pdfUrl) {
                  console.log('  [ACS] ⏭ 未找到主PDF！');
                } else {
                  console.log('  [ACS] ⏭ 跳过主PDF下载（选项已关闭）');
                }
                
                console.log('  [ACS] 检查标签页状态...');
                const stillExists = await checkTabExists(articleTabId);
                if (!stillExists || shouldStop) {
                  console.log('  [ACS] ⚠ 标签页已关闭或下载已停止');
                  cleanup();
                  resolve(success);
                  return;
                }
                
                console.log('  [ACS] 步骤4: 提取支持信息...');
                console.log('  [ACS] → extractACSSupportingInfoWithRetry()');
                const supportingInfoUrls = await extractACSSupportingInfoWithRetry(articleTabId);
                console.log('  [ACS] ✓ 支持信息提取完成');
                console.log('  [ACS]   支持信息数量:', supportingInfoUrls.length);
                
                if (options.downloadSI && supportingInfoUrls.length > 0) {
                  console.log('  [ACS] 步骤5: 下载支持信息');
                  for (let j = 0; j < supportingInfoUrls.length; j++) {
                    console.log(`  [ACS] 处理SI ${j + 1}/${supportingInfoUrls.length}`);
                    
                    const existsAgain = await checkTabExists(articleTabId);
                    if (!existsAgain || shouldStop) {
                      console.log('  [ACS] ⚠ 标签页已关闭或下载已停止');
                      break;
                    }
                    
                    const suffix = String(j + 1).padStart(3, '0');
                    console.log('  [ACS] → 调用 downloadFile():', supportingInfoUrls[j]);
                    await downloadFile(supportingInfoUrls[j], `${name}_si_${suffix}.pdf`);
                    downloadedFiles++;
                    console.log('  [ACS] ✓ SI下载完成');
                    
                    if (j < supportingInfoUrls.length - 1) {
                      console.log('  [ACS] → 调用 showCountdown(2, "acs")...');
                      await showCountdown(2, 'acs');
                      console.log('  [ACS] ✓ 等待完成');
                    }
                  }
                } else if (!options.downloadSI) {
                  console.log('  [ACS] ⏭ 跳过支持信息下载（选项已关闭）');
                } else {
                  console.log('  [ACS] ⏭ 未找到支持信息');
                }
                
                success = downloadedFiles > 0;
                console.log(`  [ACS] ═══════════════════════════════════════════`);
                console.log(`  [ACS] ✓ 完成！共下载 ${downloadedFiles} 个文件`);
                console.log(`  [ACS] ═══════════════════════════════════════════`);
                
                cleanup();
                console.log('  [ACS] → Promise resolve()');
                resolve(success);
                
              } catch (error) {
                console.error('  [ACS] ✗ 处理错误:', error);
                console.error('  [ACS] ✗ 错误详情:', error.stack);
                cleanup();
                resolve(success);
              }
            })().catch(e => console.error('  [ACS] ✗ async IIFE 错误:', e));
          }
        } catch (e) {
          console.error('  [ACS] ✗ 主动检查失败:', e);
        }
      }, 1000);
    });
  });
}

async function downloadNatureArticle(url, name, options = { downloadMain: true, downloadSI: true }) {
  console.log('═══════════════════════════════════════════════════');
  console.log('  [Nature] ▶ 开始处理:', name);
  console.log('  [Nature] 详情页URL:', url);
  console.log('  [Nature] 下载选项:', options);
  console.log('═══════════════════════════════════════════════════');
  
  return new Promise((resolve) => {
    let success = false;
    let tabListener = null;
    let timeoutId = null;
    let articleTabId = null;
    let checkIntervalId = null;
    let tabCreated = false;
    
    function cleanup() {
      console.log('  [Nature] 执行 cleanup()...');
      if (tabListener) {
        try {
          browser.tabs.onUpdated.removeListener(tabListener);
          console.log('  [Nature] ✓ 监听器已移除');
        } catch (e) {
          console.warn('  [Nature] 移除监听器失败:', e);
        }
        tabListener = null;
      }
      if (timeoutId) {
        clearTimeout(timeoutId);
        console.log('  [Nature] ✓ 超时定时器已清除');
        timeoutId = null;
      }
      if (checkIntervalId) {
        clearInterval(checkIntervalId);
        console.log('  [Nature] ✓ 主动检查定时器已清除');
        checkIntervalId = null;
      }
      if (articleTabId) {
        safeRemoveTab(articleTabId).then(() => {
          console.log('  [Nature] ✓ 标签页已关闭');
        }).catch(() => {});
        articleTabId = null;
      }
    }
    
    console.log('  [Nature] 步骤1: 提前注册事件监听器...');
    
    // 提前注册事件监听器，防止错过事件
    tabListener = (tabId, info) => {
      console.log(`  [Nature] → tabs.onUpdated 事件: tabId=${tabId}(${typeof tabId}), articleTabId=${articleTabId}(${typeof articleTabId}), status=${info.status}`);
      
      if (!articleTabId) {
        console.log('  [Nature]   articleTabId 尚未设置，等待标签页创建...');
        return;
      }
      
      const tabIdNum = Number(tabId);
      const articleTabIdNum = Number(articleTabId);
      
      console.log(`  [Nature]   转换后: tabId=${tabIdNum}, articleTabId=${articleTabIdNum}, 相等=${tabIdNum === articleTabIdNum}`);
      
      if (tabIdNum !== articleTabIdNum) {
        console.log('  [Nature]   忽略: 不是目标标签页');
        return;
      }
      if (info.status !== 'complete') {
        console.log('  [Nature]   忽略: 页面未完成加载');
        return;
      }
      
      // 页面加载完成，清理定时器并执行后续操作
      if (checkIntervalId) {
        clearInterval(checkIntervalId);
        checkIntervalId = null;
      }
      
      console.log('  [Nature] ✓ 通过事件监听器捕获到页面加载完成！');
      console.log('  [Nature] 移除监听器...');
      browser.tabs.onUpdated.removeListener(tabListener);
      tabListener = null;
      
      console.log('  [Nature] 步骤2: 执行异步处理...');
      (async () => {
        try {
          console.log('  [Nature] → 调用 showCountdown(6, "nature")...');
          await showCountdown(6, 'nature');
          console.log('  [Nature] ✓ showCountdown 完成');
          
          console.log('  [Nature] 检查标签页状态...');
          const tabExists = await checkTabExists(articleTabId);
          if (!tabExists || shouldStop) {
            console.log('  [Nature] ⚠ 标签页已关闭或下载已停止');
            cleanup();
            resolve(success);
            return;
          }
          
          console.log('  [Nature] 步骤3: 提取主PDF链接...');
          console.log('  [Nature] → browser.scripting.executeScript()');
          const pdfResult = await browser.scripting.executeScript({
            target: { tabId: articleTabId },
            function: extractNaturePdfUrl
          });
          
          const pdfUrl = pdfResult[0].result;
          console.log('  [Nature] ✓ 脚本执行成功');
          console.log('  [Nature]   主PDF链接:', pdfUrl);
          
          let downloadedFiles = 0;
          
          if (pdfUrl && options.downloadMain) {
            console.log('  [Nature] → 调用 downloadFile():', pdfUrl);
            await downloadFile(pdfUrl, `${name}.pdf`);
            downloadedFiles++;
            console.log('  [Nature] ✓ 主PDF下载完成');
            
            console.log('  [Nature] → 调用 showCountdown(3, "nature")...');
            await showCountdown(3, 'nature');
            console.log('  [Nature] ✓ 等待完成');
          } else if (!pdfUrl) {
            console.log('  [Nature] ⏭ 未找到主PDF！');
          } else {
            console.log('  [Nature] ⏭ 跳过主PDF下载（选项已关闭）');
          }
          
          console.log('  [Nature] 检查标签页状态...');
          const stillExists = await checkTabExists(articleTabId);
          if (!stillExists || shouldStop) {
            console.log('  [Nature] ⚠ 标签页已关闭或下载已停止');
            cleanup();
            resolve(success);
            return;
          }
          
          console.log('  [Nature] 步骤4: 提取支持信息...');
          console.log('  [Nature] → browser.scripting.executeScript()');
          const supplResult = await browser.scripting.executeScript({
            target: { tabId: articleTabId },
            function: extractNatureSupportingInfoUrls
          });
          
          const supportingInfoUrls = supplResult[0].result;
          console.log('  [Nature] ✓ 脚本执行成功');
          console.log('  [Nature]   支持信息数量:', supportingInfoUrls.length);
          
          if (options.downloadSI && supportingInfoUrls.length > 0) {
            console.log('  [Nature] 步骤5: 下载支持信息');
            for (let j = 0; j < supportingInfoUrls.length; j++) {
              console.log(`  [Nature] 处理SI ${j + 1}/${supportingInfoUrls.length}`);
              
              const existsAgain = await checkTabExists(articleTabId);
              if (!existsAgain || shouldStop) {
                console.log('  [Nature] ⚠ 标签页已关闭或下载已停止');
                break;
              }
              
              console.log('  [Nature] → 调用 downloadFile():', supportingInfoUrls[j]);
              await downloadFile(supportingInfoUrls[j], `${name}_${j + 1}.pdf`);
              downloadedFiles++;
              console.log('  [Nature] ✓ SI下载完成');
              
              if (j < supportingInfoUrls.length - 1) {
                console.log('  [Nature] → 调用 showCountdown(5, "nature")...');
                await showCountdown(5, 'nature');
                console.log('  [Nature] ✓ 等待完成');
              }
            }
          } else if (!options.downloadSI) {
            console.log('  [Nature] ⏭ 跳过支持信息下载（选项已关闭）');
          } else {
            console.log('  [Nature] ⏭ 未找到支持信息');
          }
          
          success = downloadedFiles > 0;
          console.log(`  [Nature] ═══════════════════════════════════════════`);
          console.log(`  [Nature] ✓ 完成！共下载 ${downloadedFiles} 个文件`);
          console.log(`  [Nature] ═══════════════════════════════════════════`);
          
          cleanup();
          console.log('  [Nature] → Promise resolve()');
          resolve(success);
          
        } catch (error) {
          console.error('  [Nature] ✗ 处理错误:', error);
          console.error('  [Nature] ✗ 错误详情:', error.stack);
          cleanup();
          resolve(success);
        }
      })().catch(e => console.error('  [Nature] ✗ async IIFE 错误:', e));
    };
    
    console.log('  [Nature] 事件监听器已提前注册');
    browser.tabs.onUpdated.addListener(tabListener);
    
    console.log('  [Nature] 步骤1a: 创建后台标签页...');
    console.log('  [Nature] → browser.tabs.create()');
    
    browser.tabs.create({ url: url, active: false }, (articleTab) => {
      console.log('  [Nature] → browser.tabs.create() 回调触发, tab:', !!articleTab, articleTab?.id);
      
      if (!articleTab || !articleTab.id) {
        console.error('  [Nature] ✗ 创建标签页失败！');
        cleanup();
        resolve(success);
        return;
      }
      
      articleTabId = articleTab.id;
      tabCreated = true;
      console.log('  [Nature] ✓ 标签页创建成功, ID:', articleTabId);
      
      console.log('  [Nature] 设置超时定时器: 120000ms');
      timeoutId = setTimeout(() => {
        console.error('  [Nature] ✗ 页面加载超时！');
        cleanup();
        resolve(success);
      }, 120000);
      
      // 添加主动查询检查，防止事件错过
      console.log('  [Nature] 启动主动查询检查...');
      let checkCount = 0;
      checkIntervalId = setInterval(async () => {
        checkCount++;
        console.log(`  [Nature] → 主动检查 #${checkCount}...`);
        
        try {
          const tabInfo = await browser.tabs.get(articleTabId);
          console.log(`  [Nature]   当前标签页状态: ${tabInfo.status}`);
          
          if (tabInfo.status === 'complete') {
            console.log('  [Nature] ✓ 通过主动查询检查到页面加载完成！');
            clearInterval(checkIntervalId);
            checkIntervalId = null;
            
            // 移除事件监听器
            if (tabListener) {
              browser.tabs.onUpdated.removeListener(tabListener);
              tabListener = null;
            }
            
            // 执行相同的下载逻辑
            console.log('  [Nature] 步骤2: 执行异步处理...');
            (async () => {
              try {
                console.log('  [Nature] → 调用 showCountdown(6, "nature")...');
                await showCountdown(6, 'nature');
                console.log('  [Nature] ✓ showCountdown 完成');
                
                console.log('  [Nature] 检查标签页状态...');
                const tabExists = await checkTabExists(articleTabId);
                if (!tabExists || shouldStop) {
                  console.log('  [Nature] ⚠ 标签页已关闭或下载已停止');
                  cleanup();
                  resolve(success);
                  return;
                }
                
                console.log('  [Nature] 步骤3: 提取主PDF链接...');
                console.log('  [Nature] → browser.scripting.executeScript()');
                const pdfResult = await browser.scripting.executeScript({
                  target: { tabId: articleTabId },
                  function: extractNaturePdfUrl
                });
                
                const pdfUrl = pdfResult[0].result;
                console.log('  [Nature] ✓ 脚本执行成功');
                console.log('  [Nature]   主PDF链接:', pdfUrl);
                
                let downloadedFiles = 0;
                
                if (pdfUrl && options.downloadMain) {
                  console.log('  [Nature] → 调用 downloadFile():', pdfUrl);
                  await downloadFile(pdfUrl, `${name}.pdf`);
                  downloadedFiles++;
                  console.log('  [Nature] ✓ 主PDF下载完成');
                  
                  console.log('  [Nature] → 调用 showCountdown(3, "nature")...');
                  await showCountdown(3, 'nature');
                  console.log('  [Nature] ✓ 等待完成');
                } else if (!pdfUrl) {
                  console.log('  [Nature] ⏭ 未找到主PDF！');
                } else {
                  console.log('  [Nature] ⏭ 跳过主PDF下载（选项已关闭）');
                }
                
                console.log('  [Nature] 检查标签页状态...');
                const stillExists = await checkTabExists(articleTabId);
                if (!stillExists || shouldStop) {
                  console.log('  [Nature] ⚠ 标签页已关闭或下载已停止');
                  cleanup();
                  resolve(success);
                  return;
                }
                
                console.log('  [Nature] 步骤4: 提取支持信息...');
                console.log('  [Nature] → browser.scripting.executeScript()');
                const supplResult = await browser.scripting.executeScript({
                  target: { tabId: articleTabId },
                  function: extractNatureSupportingInfoUrls
                });
                
                const supportingInfoUrls = supplResult[0].result;
                console.log('  [Nature] ✓ 脚本执行成功');
                console.log('  [Nature]   支持信息数量:', supportingInfoUrls.length);
                
                if (options.downloadSI && supportingInfoUrls.length > 0) {
                  console.log('  [Nature] 步骤5: 下载支持信息');
                  for (let j = 0; j < supportingInfoUrls.length; j++) {
                    console.log(`  [Nature] 处理SI ${j + 1}/${supportingInfoUrls.length}`);
                    
                    const existsAgain = await checkTabExists(articleTabId);
                    if (!existsAgain || shouldStop) {
                      console.log('  [Nature] ⚠ 标签页已关闭或下载已停止');
                      break;
                    }
                    
                    console.log('  [Nature] → 调用 downloadFile():', supportingInfoUrls[j]);
                    await downloadFile(supportingInfoUrls[j], `${name}_${j + 1}.pdf`);
                    downloadedFiles++;
                    console.log('  [Nature] ✓ SI下载完成');
                    
                    if (j < supportingInfoUrls.length - 1) {
                      console.log('  [Nature] → 调用 showCountdown(5, "nature")...');
                      await showCountdown(5, 'nature');
                      console.log('  [Nature] ✓ 等待完成');
                    }
                  }
                } else if (!options.downloadSI) {
                  console.log('  [Nature] ⏭ 跳过支持信息下载（选项已关闭）');
                } else {
                  console.log('  [Nature] ⏭ 未找到支持信息');
                }
                
                success = downloadedFiles > 0;
                console.log(`  [Nature] ═══════════════════════════════════════════`);
                console.log(`  [Nature] ✓ 完成！共下载 ${downloadedFiles} 个文件`);
                console.log(`  [Nature] ═══════════════════════════════════════════`);
                
                cleanup();
                console.log('  [Nature] → Promise resolve()');
                resolve(success);
                
              } catch (error) {
                console.error('  [Nature] ✗ 处理错误:', error);
                console.error('  [Nature] ✗ 错误详情:', error.stack);
                cleanup();
                resolve(success);
              }
            })().catch(e => console.error('  [Nature] ✗ async IIFE 错误:', e));
          }
        } catch (e) {
          console.error('  [Nature] ✗ 主动检查失败:', e);
        }
      }, 1000);
    });
  });
}

async function extractACSSupportingInfoWithRetry(tabId) {
  let urls = [];
  
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await browser.scripting.executeScript({
        target: { tabId: tabId },
        function: extractACSSupportingInfoUrls
      });
      
      urls = result[0].result;
      
      if (urls.length > 0) {
        break;
      }
      
      await delay(1000);
    } catch (e) {
      console.log('  ACS Supporting info attempt', attempt, 'failed:', e);
    }
  }
  
  return urls;
}

function extractACSPdfUrl() {
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

function extractACSSupportingInfoUrls() {
  const urls = [];
  
  const supportingInfoBtn = document.querySelector('a[data-id="article_header_SupportingInfo"]');
  if (supportingInfoBtn) {
    supportingInfoBtn.click();
  }
  
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

function extractNaturePdfUrl() {
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

function extractNatureSupportingInfoUrls() {
  const urls = [];
  const allLinks = document.querySelectorAll('a');
  
  // 查找包含 supplementary info 的链接，或者 data-test="supp-info-link" 的链接
  for (let link of allLinks) {
    const href = link.getAttribute('href');
    const text = link.textContent.toLowerCase();
    
    if (href && href.toLowerCase().includes('.pdf')) {
      // 跳过主 PDF（因为主 PDF 应该已经在上面提取了）
      if (href.includes('/articles/') && !href.includes('esm') && !href.includes('MediaObjects')) {
        continue;
      }
      
      // 检查是否是补充信息相关
      if (text.includes('supplementary') || 
          text.includes('supporting') || 
          href.includes('esm') || 
          href.includes('supp-info') ||
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

async function downloadRscArticle(url, name, options = { downloadMain: true, downloadSI: true }) {
  console.log('═══════════════════════════════════════════════════');
  console.log('  [RSC] ▶ 开始处理:', name);
  console.log('  [RSC] 详情页URL:', url);
  console.log('  [RSC] 下载选项:', options);
  console.log('═══════════════════════════════════════════════════');
  
  let downloadedFiles = 0;
  
  try {
    console.log('  [RSC] 步骤1: 创建后台标签页...');
    console.log('  [RSC] → browser.tabs.create()');
    
    const extractedData = await new Promise((resolve) => {
      console.log('  [RSC] → Promise 创建，等待 browser.tabs.create()...');
      
      browser.tabs.create({ url: url, active: false }, (tab) => {
        console.log('  [RSC] → browser.tabs.create() 回调触发, tab:', !!tab, tab?.id);
        
        if (!tab || !tab.id) {
          console.error('  [RSC] ✗ 创建标签页失败！');
          resolve({ pdfUrl: null, siUrls: [] });
          return;
        }
        
        const tabId = tab.id;
        console.log('  [RSC] ✓ 标签页创建成功, ID:', tabId);
        
        let tabListener = null;
        let timeoutId = null;
        let checkIntervalId = null;
        
        const cleanup = () => {
          console.log('  [RSC] 执行 cleanup()...');
          if (tabListener) {
            try {
              browser.tabs.onUpdated.removeListener(tabListener);
              console.log('  [RSC] ✓ 监听器已移除');
            } catch (e) {
              console.warn('  [RSC] 移除监听器失败:', e);
            }
            tabListener = null;
          }
          if (timeoutId) {
            clearTimeout(timeoutId);
            console.log('  [RSC] ✓ 超时定时器已清除');
            timeoutId = null;
          }
          if (checkIntervalId) {
            clearInterval(checkIntervalId);
            console.log('  [RSC] ✓ 状态检查定时器已清除');
            checkIntervalId = null;
          }
        };
        
        console.log('  [RSC] 设置超时定时器: 60000ms');
        timeoutId = setTimeout(() => {
          console.error('  [RSC] ✗ 页面加载超时！');
          cleanup();
          try { browser.tabs.remove(tabId); } catch(e) {}
          resolve({ pdfUrl: null, siUrls: [] });
        }, 60000);
        
        let checkCount = 0;
        console.log('  [RSC] 启动状态检查定时器: 每5000ms');
        checkIntervalId = setInterval(() => {
          checkCount++;
          console.log(`  [RSC] → 状态检查 #${checkCount}...`);
          browser.tabs.get(tabId).then(tabInfo => {
            console.log(`  [RSC]   页面状态: ${tabInfo.status}`);
            
            if (checkCount >= 6 && tabInfo.status !== 'complete') {
              console.log('  [RSC] ⚠ 页面加载缓慢，尝试刷新...');
              browser.tabs.reload(tabId).then(() => {
                console.log('  [RSC] ✓ 刷新完成');
              }).catch(e => {
                console.error('  [RSC] ✗ 刷新失败:', e);
              });
            }
          }).catch(e => {
            console.error('  [RSC] ✗ 获取页面状态失败:', e);
          });
        }, 5000);
        
        console.log('  [RSC] 注册 tabs.onUpdated 监听器...');
        tabListener = (tid, info) => {
          console.log(`  [RSC] → tabs.onUpdated 事件: tabId=${tid}(${typeof tid}), targetTabId=${tabId}(${typeof tabId}), status=${info.status}`);
          
          const tidNum = Number(tid);
          const tabIdNum = Number(tabId);
          
          console.log(`  [RSC]   转换后: tabId=${tidNum}, targetTabId=${tabIdNum}, 相等=${tidNum === tabIdNum}`);
          
          if (tidNum !== tabIdNum || info.status !== 'complete') {
            console.log('  [RSC]   忽略: 不是目标标签页或未完成');
            return;
          }
          
          console.log('  [RSC] ✓ 目标页面加载完成！');
          console.log('  [RSC] 移除监听器...');
          browser.tabs.onUpdated.removeListener(tabListener);
          tabListener = null;
          
          console.log('  [RSC] 步骤2: 执行异步处理...');
          (async () => {
            try {
              console.log('  [RSC] → 调用 showCountdown(8, "rsc")...');
              await showCountdown(8, 'rsc');
              console.log('  [RSC] ✓ showCountdown 完成');
              
              console.log('  [RSC] 检查停止标志...');
              if (shouldStop || shouldSkip) {
                console.log('  [RSC] ⚠ 下载已停止（shouldStop=', shouldStop, ', shouldSkip=', shouldSkip, '）');
                cleanup();
                try { browser.tabs.remove(tabId); } catch(e) {}
                resolve({ pdfUrl: null, siUrls: [], stopped: true });
                return;
              }
              
              console.log('  [RSC] 步骤3: 执行脚本提取链接...');
              console.log('  [RSC] → browser.scripting.executeScript()');
              const result = await browser.scripting.executeScript({
                target: { tabId: tabId },
                func: function() {
                  let pdfUrl = null;
                  const pdfLinks = document.querySelectorAll('a[href*="/articlepdf/"]');
                  if (pdfLinks.length > 0) {
                    let href = pdfLinks[0].getAttribute('href');
                    if (href && !href.startsWith('http')) {
                      href = 'https://pubs.rsc.org' + href;
                    }
                    pdfUrl = href;
                  }
                  
                  const siUrls = [];
                  const siLinks = document.querySelectorAll('a[href*="/suppdata"]');
                  siLinks.forEach(link => {
                    let href = link.getAttribute('href');
                    if (href) {
                      if (!href.startsWith('http')) {
                        href = 'https://www.rsc.org' + href;
                      }
                      if (!siUrls.includes(href) && href.toLowerCase().endsWith('.pdf')) {
                        siUrls.push(href);
                      }
                    }
                  });
                  
                  return { pdfUrl, siUrls };
                }
              });
              
              const data = result[0].result || { pdfUrl: null, siUrls: [] };
              console.log('  [RSC] ✓ 脚本执行成功');
              console.log('  [RSC]   提取到的PDF:', data.pdfUrl);
              console.log('  [RSC]   提取到的SI:', data.siUrls);
              
              console.log('  [RSC] 清理并关闭标签页...');
              cleanup();
              browser.tabs.remove(tabId).catch(() => {});
              console.log('  [RSC] → Promise resolve()');
              resolve(data);
            } catch (err) {
              console.error('  [RSC] ✗ 处理过程出错:', err);
              cleanup();
              try { browser.tabs.remove(tabId); } catch(e) {}
              resolve({ pdfUrl: null, siUrls: [] });
            }
          })().catch(e => console.error('  [RSC] ✗ async IIFE 错误:', e));
        };
        
        console.log('  [RSC] 监听器已注册，等待页面加载...');
        browser.tabs.onUpdated.addListener(tabListener);
      });
    });
    
    console.log('  [RSC] 步骤4: Promise 已解决');
    console.log('  [RSC]   extractedData:', extractedData);
    
    if (extractedData.stopped) {
      console.log('  [RSC] ⚠ 下载被停止，退出');
      return false;
    }
    
    console.log('  [RSC] 步骤5: 下载主PDF');
    if (options.downloadMain && extractedData.pdfUrl) {
      console.log('  [RSC] → 调用 downloadFile():', extractedData.pdfUrl);
      await downloadFile(extractedData.pdfUrl, `${name}.pdf`);
      downloadedFiles++;
      console.log('  [RSC] ✓ 主PDF下载完成');
      
      console.log('  [RSC] → 调用 showCountdown(10, "rsc")...');
      await showCountdown(10, 'rsc');
      console.log('  [RSC] ✓ 等待完成');
    } else if (!options.downloadMain) {
      console.log('  [RSC] ⏭ 跳过主PDF下载（选项已关闭）');
    } else {
      console.log('  [RSC] ⏭ 未找到主PDF链接');
    }
    
    console.log('  [RSC] 检查停止标志...');
    if (shouldStop || shouldSkip) {
      console.log('  [RSC] ⚠ 下载已停止，退出');
      return downloadedFiles > 0;
    }
    
    console.log('  [RSC] 步骤6: 下载SI文件');
    console.log('  [RSC]   SI数量:', extractedData.siUrls.length);
    if (options.downloadSI && extractedData.siUrls.length > 0) {
      for (let i = 0; i < extractedData.siUrls.length; i++) {
        console.log(`  [RSC] 处理SI ${i + 1}/${extractedData.siUrls.length}`);
        
        if (shouldStop || shouldSkip) {
          console.log('  [RSC] ⚠ 下载已停止');
          break;
        }
        
        const siName = `${name}_${i + 1}.pdf`;
        console.log('  [RSC] → 调用 downloadFile():', extractedData.siUrls[i]);
        await downloadFile(extractedData.siUrls[i], siName);
        downloadedFiles++;
        console.log('  [RSC] ✓ SI下载完成');
        
        if (i < extractedData.siUrls.length - 1) {
          console.log('  [RSC] → 调用 showCountdown(60, "rsc")...');
          await showCountdown(60, 'rsc');
          console.log('  [RSC] ✓ 等待完成');
        }
      }
    } else if (!options.downloadSI) {
      console.log('  [RSC] ⏭ 跳过SI下载（选项已关闭）');
    } else {
      console.log('  [RSC] ⏭ 未找到SI链接');
    }
    
    console.log(`  [RSC] ═══════════════════════════════════════════`);
    console.log(`  [RSC] ✓ 完成！共下载 ${downloadedFiles} 个文件`);
    console.log(`  [RSC] ═══════════════════════════════════════════`);
    
    console.log('  [RSC] 步骤7: 隐藏悬浮框...');
    try {
      const tabs = await browser.tabs.query({ url: '*://pubs.rsc.org/*' });
      tabs.forEach(t => {
        browser.tabs.sendMessage(t.id, { 
          action: 'update_wait_time', 
          isWaiting: false
        }).catch(() => {});
      });
    } catch (e) {}
    
    console.log('  [RSC] → return true');
    return downloadedFiles > 0;
    
  } catch (error) {
    console.error('  [RSC] ✗✗✗ 处理错误:', error);
    console.error('  [RSC] ✗✗✗ 错误详情:', error.stack);
    return false;
  }
}

// 通用倒计时显示函数
async function showCountdown(seconds, siteType) {
  console.log(`等待 ${seconds} 秒...`);
  
  // 发送倒计时消息给所有打开的相关标签页
  const queryUrls = {
    'acs': '*://pubs.acs.org/*',
    'nature': '*://www.nature.com/*',
    'rsc': '*://pubs.rsc.org/*'
  };
  
  const siteNames = {
    'acs': 'ACS',
    'nature': 'Nature',
    'rsc': 'RSC'
  };
  
  const urlPattern = queryUrls[siteType] || '*://*/*';
  const siteName = siteNames[siteType] || '';
  
  // 辅助函数：发送消息到标签页，优先活动标签页
  const sendMessageToTabs = async (messageObj) => {
    try {
      const allTabs = await browser.tabs.query({ url: urlPattern });
      
      // 先处理活动标签页
      const activeTabs = allTabs.filter(t => t.active);
      const inactiveTabs = allTabs.filter(t => !t.active);
      
      // 发送到活动标签页（优先）
      for (const t of activeTabs) {
        try {
          await browser.tabs.sendMessage(t.id, messageObj);
        } catch (e) {
          console.warn(`  [倒计时] 发送消息到活动标签页 ${t.id} 失败:`, e.message);
        }
      }
      
      // 发送到非活动标签页
      for (const t of inactiveTabs) {
        try {
          await browser.tabs.sendMessage(t.id, messageObj);
        } catch (e) {
          // 非活动标签页失败不输出警告，减少日志干扰
        }
      }
    } catch (e) {
      console.error('  [倒计时] 查询标签页失败:', e);
    }
  };
  
  // 初始显示
  await sendMessageToTabs({ 
    action: 'update_wait_time', 
    seconds: seconds,
    isWaiting: true,
    siteType: siteType,
    siteName: siteName
  });
  
  // 逐秒倒计时
  for (let i = seconds; i > 0; i--) {
    if (shouldStop || shouldSkip) break;
    await sendMessageToTabs({ 
      action: 'update_wait_time', 
      seconds: i,
      isWaiting: true,
      siteType: siteType,
      siteName: siteName
    });
    await delay(1000);
  }
  
  // 倒计时结束，隐藏悬浮框
  await sendMessageToTabs({ 
    action: 'update_wait_time', 
    isWaiting: false
  });
}

async function downloadFile(url, filename) {
  return new Promise((resolve) => {
    browser.downloads.download({
      url: url,
      filename: '10.1021/' + filename,
      saveAs: false
    }, (downloadId) => {
      if (browser.runtime.lastError) {
        console.error('下载失败:', browser.runtime.lastError.message);
      } else {
        console.log('正在下载:', filename, 'ID:', downloadId);
      }
      resolve();
    });
  });
}

function delay(ms) {
  return new Promise(resolve => {
    // 不在这里重置 shouldSkip，由调用者（processQueue）统一管理
    
    const checkInterval = setInterval(() => {
      if (shouldSkip) {
        console.log('Waiting skipped by user');
        clearInterval(checkInterval);
        clearTimeout(timeout);
        resolve();
      }
    }, 100);
    
    const timeout = setTimeout(() => {
      clearInterval(checkInterval);
      resolve();
    }, ms);
  });
}
