// Enhanced utility functions with improved performance and error handling
const EbayAutomationUtils = {
  // Configurable delays
  DELAYS: {
    SCROLL: {
      MIN: 100,
      MAX: 300
    },
    CLICK: {
      MIN: 1000,
      MAX: 3000
    },
    PAGE_LOAD: 2000
  },

  // Generate random delay with exponential backoff
  getRandomDelay(min, max, factor = 1) {
    const base = Math.floor(Math.random() * (max - min + 1)) + min;
    return Math.min(base * factor, max * 2);
  },

  // Throttled scroll function
  createThrottledScroll(callback, delay = 100) {
    let lastCall = 0;
    return function() {
      const now = Date.now();
      if (now - lastCall >= delay) {
        callback.apply(this, arguments);
        lastCall = now;
      }
    };
  },

  // Safe DOM operations
  safeQuerySelector(selector, context = document) {
    try {
      return context.querySelector(selector);
    } catch (error) {
      console.error(`Error querying selector ${selector}:`, error);
      return null;
    }
  },

  safeQuerySelectorAll(selector, context = document) {
    try {
      return Array.from(context.querySelectorAll(selector));
    } catch (error) {
      console.error(`Error querying selector ${selector}:`, error);
      return [];
    }
  },

  // Enhanced element finder with better logging
  findElementByXPath(xpath, context = document) {
    try {
      console.log(`[eBay Auto] Trying to find element by XPath: ${xpath}`);
      const result = document.evaluate(
        xpath,
        context,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null
      );
      const element = result.singleNodeValue;
      if (element) {
        console.log(`[eBay Auto] Found element by XPath: ${xpath}`);
        return element;
      }
      console.log(`[eBay Auto] No element found for XPath: ${xpath}`);
      return null;
    } catch (error) {
      console.error(`[eBay Auto] Error finding element by XPath ${xpath}:`, error);
      return null;
    }
  },

  // Find all elements by XPath
  findElementsByXPath(xpath, context = document) {
    try {
      const result = document.evaluate(
        xpath,
        context,
        null,
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
        null
      );
      const elements = [];
      for (let i = 0; i < result.snapshotLength; i++) {
        elements.push(result.snapshotItem(i));
      }
      return elements;
    } catch (error) {
      console.error(`Error finding elements by XPath ${xpath}:`, error);
      return [];
    }
  },

  // Enhanced visibility check with better logging
  isElementVisible(element) {
    if (!element) {
      console.log('[eBay Auto] Element is null in visibility check');
      return false;
    }

    try {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);

      const isVisible = rect.width > 0 
        && rect.height > 0 
        && style.visibility !== 'hidden' 
        && style.display !== 'none'
        && rect.top < (window.innerHeight || document.documentElement.clientHeight)
        && rect.left < (window.innerWidth || document.documentElement.clientWidth)
        && rect.bottom > 0
        && rect.right > 0;

      if (!isVisible) {
        console.log('[eBay Auto] Element is not visible:', {
          width: rect.width,
          height: rect.height,
          visibility: style.visibility,
          display: style.display,
          position: {
            top: rect.top,
            left: rect.left,
            bottom: rect.bottom,
            right: rect.right
          }
        });
      }

      return isVisible;
    } catch (error) {
      console.error('[eBay Auto] Visibility check error:', error);
      return false;
    }
  },

  // Safe click with retry
  async safeClick(element, maxRetries = 3) {
    if (!element) return false;

    for (let i = 0; i < maxRetries; i++) {
      try {
        if (this.isElementVisible(element)) {
          // Nếu là hình ảnh, đợi load hoàn toàn
          if (element.tagName.toLowerCase() === 'img') {
            const isLoaded = await this.waitForImageLoad(element);
            if (!isLoaded) {
              console.warn('Image not loaded completely');
              continue;
            }
          }

          element.click();
          return true;
        }
        await this.sleep(500);
      } catch (error) {
        console.error(`Click attempt ${i + 1} failed:`, error);
        if (i === maxRetries - 1) return false;
      }
    }
    return false;
  },

  // Enhanced element wait with retry
  waitForElement(selector, timeout = 5000, context = document, retries = 3) {
    return new Promise((resolve, reject) => {
      let attempts = 0;

      const findElement = () => {
        attempts++;
        const startTime = Date.now();

        const checkElement = () => {
          let element = null;

          // Try XPath first if the selector starts with / or contains []
          if (selector.startsWith('/') || selector.includes('[')) {
            element = this.findElementByXPath(selector, context);
          } else {
            // Otherwise try CSS selector
            element = this.safeQuerySelector(selector, context);
          }

          if (element) {
            resolve(element);
            return;
          }

          if (Date.now() - startTime >= timeout) {
            if (attempts < retries) {
              console.log(`Retry ${attempts} for selector/xpath ${selector}`);
              setTimeout(findElement, 1000); // Wait 1s between retries
            } else {
              reject(new Error(`Element ${selector} not found within ${timeout}ms after ${retries} attempts`));
            }
            return;
          }

          requestAnimationFrame(checkElement);
        };

        checkElement();
      };

      findElement();
    });
  },

  // Promise-based sleep utility
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  },

  // Wait for image to load completely
  async waitForImageLoad(imgElement, timeout = 5000) {
    if (!imgElement) return false;

    return new Promise((resolve) => {
      if (imgElement.complete) {
        resolve(true);
        return;
      }

      const timer = setTimeout(() => {
        resolve(false);
      }, timeout);

      imgElement.addEventListener('load', () => {
        clearTimeout(timer);
        resolve(true);
      });

      imgElement.addEventListener('error', () => {
        clearTimeout(timer);
        resolve(false);
      });
    });
  }
};

// Export utilities
window.EbayAutomationUtils = EbayAutomationUtils;
