(() => {
  const MAX_RETRIES = 3;
  const MESSAGE_RETRY_DELAY = 1000;
  const MAX_ITEMS_TO_CHECK = 10;
  const SCROLL_TIMEOUT = 30000;
  const INITIAL_DELAY = 2000;
  const MIN_SCROLL_DELAY = 100;
  const MAX_SCROLL_DELAY = 300;
  const PAUSE_CHANCE = 0.1;
  const PAUSE_DURATION = [2000, 5000];
  const MAX_SCROLL_RETRIES = 5;
  const SCROLL_THRESHOLD = 10;

  const SELECTORS = {
    ITEMS: '.s-item',
    SOLD_COUNT: '.s-item__quantitySold .BOLD',
    ITEM_LINK: 'a.s-item__link',
    SCROLL_CONTAINER: '#srp-river-results, .srp-river-main, body'
  };

  let state = {
    isRunning: false,
    scrollInterval: null,
    currentTimeout: null,
    connectionCheckInterval: null,
    retryCount: 0,
    currentKeywordIndex: 0
  };

  const sendMessageWithRetry = async (message, retries = MAX_RETRIES) => {
    for (let i = 0; i < retries; i++) {
      try {
        await chrome.runtime.sendMessage(message);
        return true;
      } catch (error) {
        console.error(`[eBay Auto] Gửi tin nhắn lần ${i + 1} thất bại:`, error);
        if (i < retries - 1) await new Promise(resolve => setTimeout(resolve, MESSAGE_RETRY_DELAY));
      }
    }
    console.error("[eBay Auto] Không thể gửi thông báo hoàn thành tìm kiếm sau nhiều lần thử");
    return false;
  };

  const logActivity = (message) => {
    console.log(message);
  };

  const checkConnection = async () => {
    return navigator.onLine;
  };

  const cleanup = () => {
    if (state.scrollInterval) clearInterval(state.scrollInterval);
    if (state.currentTimeout) clearTimeout(state.currentTimeout);
    if (state.connectionCheckInterval) clearInterval(state.connectionCheckInterval);
    state.isRunning = false;
    state.retryCount = 0;
    logActivity("[eBay Auto] Đã dừng tất cả hoạt động tự động");
  };

  const scrollThroughResults = async () => {
    let currentPosition = window.scrollY;
    let maxHeight = document.documentElement.scrollHeight;

    for (let i = 0; i < 5; i++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      if (document.documentElement.scrollHeight > maxHeight + 200) {
        logActivity("[eBay Auto] Nội dung mới được tải");
        break;
      }
      maxHeight = document.documentElement.scrollHeight;
    }

    return true;
  };

  const automationHandlers = {
    async searchResults() {
      if (!state.isRunning) return;
      logActivity("[eBay Auto] Đang chạy trên trang kết quả tìm kiếm");

      try {
        const hasFoundItems = await scrollThroughResults();
        if (!hasFoundItems) {
          logActivity("[eBay Auto] Không tìm đủ sản phẩm để kiểm tra");
          cleanup();
          return;
        }

        if (state.isRunning && await checkConnection()) {
          const items = Array.from(document.querySelectorAll(SELECTORS.ITEMS)).slice(0, MAX_ITEMS_TO_CHECK);
          logActivity(`[eBay Auto] Phân tích ${items.length} sản phẩm đầu tiên`);
        }
      } catch (error) {
        console.error("Lỗi tự động hóa trang tìm kiếm:", error);
        logActivity(`[eBay Auto] Lỗi: ${error.message}`);
      } finally {
        logActivity("[eBay Auto] Đang cố gắng hoàn tất tự động hóa trang tìm kiếm");
        if (state.isRunning && await checkConnection()) {
          await sendMessageWithRetry({ type: 'searchComplete' });
        } else {
          logActivity("[eBay Auto] Tự động hóa dừng do trạng thái hoặc kết nối");
          cleanup();
        }
      }
    }
  };

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.command === 'stop') {
      cleanup();
      sendResponse({ status: 'ok' });
    } else if (message.command === 'performAutomation') {
      if (!state.isRunning) {
        state.isRunning = true;
        if (window.location.pathname.includes('sch/i.html')) {
          automationHandlers.searchResults();
        }
      }
      sendResponse({ status: 'ok' });
    }
  });
})();
