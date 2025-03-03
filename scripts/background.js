// Constants
const DELAY = {
  MIN_KEYWORD: 45000,
  MAX_KEYWORD: 60000,
  TAB_CREATION: 5000
};

// State management
const state = {
  isRunning: false,
  currentTab: null,
  currentProductTabId: null,
  currentKeywordIndex: 0,
  nextKeywordTimer: null,
  isPaused: false
};

const utils = {
  getRandomInt: (min, max) => Math.floor(Math.random() * (max - min + 1)) + min,
  sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
  formatError: (error) => ({
    message: error.message,
    stack: error.stack,
    timestamp: new Date().toISOString()
  })
};

// Activity logging
class ActivityLogger {
  constructor() {
    this.queue = [];
    this.isProcessing = false;
    this.MAX_LOGS = 100;
    this.debounceTimeout = null;
  }

  async log(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[${timestamp}] ${message}`);

    this.queue.push({ time: timestamp, text: message, type });
    if (!this.isProcessing) {
      clearTimeout(this.debounceTimeout);
      this.debounceTimeout = setTimeout(() => this.processQueue(), 1000);
    }
  }

  async processQueue() {
    if (this.queue.length === 0) {
      this.isProcessing = false;
      return;
    }

    this.isProcessing = true;
    try {
      const result = await chrome.storage.local.get(['activityLogs']);
      let logs = result.activityLogs || [];
      logs.unshift(...this.queue);

      const now = new Date();
      logs = logs.filter(log => (now - new Date(log.time)) < 24 * 60 * 60 * 1000);
      if (logs.length > this.MAX_LOGS) logs.length = this.MAX_LOGS;

      await chrome.storage.local.set({ activityLogs: logs });
      this.queue = [];
    } catch (error) {
      console.error('Lỗi xử lý hàng đợi log:', utils.formatError(error));
    } finally {
      this.isProcessing = false;
    }
  }
}

const logger = new ActivityLogger();

async function updateState(updates) {
  Object.assign(state, updates);

  if ('isRunning' in updates) {
    await chrome.storage.local.set({ isRunning: updates.isRunning });
    await logger.log(`Trạng thái extension: ${updates.isRunning ? 'Đang hoạt động' : 'Không hoạt động'}`);
    const message = { type: 'status', isRunning: updates.isRunning };
    try {
      chrome.runtime.sendMessage(message);
      chrome.tabs.query({ url: '*://*.ebay.com/*' }, (tabs) => {
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, { command: 'syncState', isRunning: updates.isRunning })
            .catch(err => logger.log(`Lỗi đồng bộ trạng thái: ${err.message}`, 'error'));
        });
      });
    } catch (error) {}
  }
  if ('currentKeywordIndex' in updates) {
    await chrome.storage.local.set({ currentKeywordIndex: updates.currentKeywordIndex });
  }
}

async function cleanup() {
  try {
    if (state.nextKeywordTimer) {
      clearTimeout(state.nextKeywordTimer);
      state.nextKeywordTimer = null;
    }
    if (state.currentTab) {
      for (let i = 0; i < 3; i++) {
        try {
          await chrome.tabs.sendMessage(state.currentTab.id, { command: 'stop' });
          break;
        } catch (error) {
          await logger.log(`Gửi lệnh dừng thất bại lần ${i + 1}: ${error.message}`, 'error');
          if (i < 2) await utils.sleep(1000);
        }
      }
    }
    if (state.currentProductTabId) {
      await chrome.tabs.remove(state.currentProductTabId);
      state.currentProductTabId = null;
    }
    await updateState({
      isRunning: false,
      currentKeywordIndex: 0,
      currentTab: null
    });
    await logger.log('Tự động hóa đã dừng và dọn dẹp xong');
  } catch (error) {
    console.error('Lỗi dọn dẹp:', utils.formatError(error));
    await logger.log(`Lỗi dọn dẹp: ${error.message}`, 'error');
  }
}

async function openProductInNewTab(productUrl) {
  const newTab = await chrome.tabs.create({ url: productUrl, active: true });
  return newTab.id;
}

async function closeProductTab(tabId) {
  await chrome.tabs.remove(tabId);
}

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  if (tabId === state.currentProductTabId) {
    state.currentProductTabId = null;
    logger.log('Tab sản phẩm đã đóng, tiếp tục tìm kiếm');
    processNextKeyword();
  }
});

async function processNextKeyword() {
  if (!state.isRunning || state.isPaused) return;

  try {
    const settings = await chrome.storage.local.get(['keywords', 'completedKeywords']);
    const keywords = settings.keywords?.split('\n').filter(k => k.trim()) || [];
    const completedKeywords = settings.completedKeywords || [];

    if (!keywords.length) {
      await logger.log('Không tìm thấy từ khóa. Dừng tự động hóa.', 'warn');
      await cleanup();
      return;
    }

    const remainingKeywords = keywords.filter(k => !completedKeywords.includes(k));
    if (remainingKeywords.length === 0) {
      await logger.log('Đã hoàn thành tất cả từ khóa, bắt đầu lại từ đầu.');
      await chrome.storage.local.set({ completedKeywords: [] });
      state.currentKeywordIndex = 0;
    } else {
      state.currentKeywordIndex = keywords.indexOf(remainingKeywords[0]);
    }

    const keyword = keywords[state.currentKeywordIndex];
    await logger.log(`Đang xử lý từ khóa ${state.currentKeywordIndex + 1}/${keywords.length}: "${keyword}"`);
    const searchUrl = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(keyword)}`;

    if (state.currentTab) {
      await chrome.tabs.update(state.currentTab.id, { url: searchUrl, active: true });
    } else {
      state.currentTab = await chrome.tabs.create({ url: searchUrl, active: true });
    }

    await new Promise((resolve) => {
      chrome.tabs.onUpdated.addListener(function listener(tabId, changeInfo) {
        if (tabId === state.currentTab.id && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          chrome.tabs.sendMessage(tabId, { command: 'performAutomation' })
            .then(() => resolve())
            .catch(err => logger.log(`Lỗi gửi lệnh performAutomation: ${err.message}`, 'error'));
        }
      });
    });

    await updateState({ currentKeywordIndex: state.currentKeywordIndex + 1 });

  } catch (error) {
    console.error('Lỗi xử lý từ khóa:', utils.formatError(error));
    await logger.log(`Lỗi: ${error.message}`, 'error');
    await cleanup();
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handlers = {
    async start() {
      state.currentKeywordIndex = 0;
      await utils.sleep(500);
      await updateState({ isRunning: true });
      await processNextKeyword();
      return { status: 'ok' };
    },

    async stop() {
      await cleanup();
      return { status: 'ok' };
    },

    async pause() {
      state.isPaused = true;
      await logger.log('Tự động hóa đã tạm dừng');
      return { status: 'ok' };
    },

    async resume() {
      state.isPaused = false;
      await logger.log('Tự động hóa đã tiếp tục');
      await processNextKeyword();
      return { status: 'ok' };
    },

    async log(message) {
      await logger.log(message.messages || message.message);
      return { status: 'ok' };
    },

    async searchComplete() {
      if (!state.isRunning) return { status: 'ok' };

      if (state.nextKeywordTimer) clearTimeout(state.nextKeywordTimer);

      const delay = utils.getRandomInt(DELAY.MIN_KEYWORD, DELAY.MAX_KEYWORD);
      await logger.log(`Từ khóa tiếp theo được lên lịch sau ${delay / 1000} giây`);

      state.nextKeywordTimer = setTimeout(async () => {
        if (state.isRunning) {
          const settings = await chrome.storage.local.get(['keywords', 'completedKeywords']);
          const keywords = settings.keywords?.split('\n').filter(k => k.trim()) || [];
          const remainingKeywords = keywords.filter(k => !settings.completedKeywords?.includes(k));

          if (remainingKeywords.length > 0) {
            await processNextKeyword();
          } else {
            await logger.log('Không còn từ khóa nào, dừng tự động hóa.');
            await cleanup();
          }
        }
      }, delay);

      return { status: 'ok' };
    },

    async keywordCompleted(message) {
      const { keyword } = message;
      if (keyword) {
        const settings = await chrome.storage.local.get('completedKeywords');
        const completedKeywords = settings.completedKeywords || [];
        if (!completedKeywords.includes(keyword)) {
          completedKeywords.push(keyword);
          await chrome.storage.local.set({ completedKeywords });
          await logger.log(`Đã đánh dấu từ khóa hoàn thành: ${keyword}`);
        }
      }
      return { status: 'ok' };
    },

    async openProduct(message) {
      const { url } = message;
      if (url) {
        state.currentProductTabId = await openProductInNewTab(url);
        await logger.log(`Đã mở tab sản phẩm: ${url}`);
        setTimeout(() => closeProductTab(state.currentProductTabId), utils.getRandomInt(8000, 12000));
      }
      return { status: 'ok' };
    }
  };

  const handler = handlers[message.type];
  if (handler) {
    handler(message).then(sendResponse);
    return true;
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  await updateState({ isRunning: false });
  await chrome.storage.local.set({
    keywords: '',
    completedKeywords: [],
    activityLogs: []
  });
  await logger.log('Extension đã được cài đặt và khởi tạo');
});

chrome.runtime.onStartup.addListener(async () => {
  await updateState({ isRunning: false });
  await logger.log('Chrome khởi động lại, đặt trạng thái extension về không hoạt động');
});