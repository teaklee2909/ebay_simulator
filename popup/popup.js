// Enhanced popup script with improved performance and reliability

// Constants
const DOM = {
  startBtn: document.getElementById('startBtn'),
  stopBtn: document.getElementById('stopBtn'),
  statusDot: document.querySelector('.status-dot'),
  statusText: document.getElementById('status-text'),
  activityLog: document.getElementById('activityLog'),
  keywords: document.getElementById('keywords'),
  viewDuration: document.getElementById('viewDuration'),
  pauseDuration: document.getElementById('pauseDuration'),
  viewImages: document.getElementById('viewImages'),
  viewSponsored: document.getElementById('viewSponsored'),
  naturalScroll: document.getElementById('naturalScroll')
};

// Settings validation
const SETTINGS_CONSTRAINTS = {
  viewDuration: { min: 10, max: 30, default: 15 },
  pauseDuration: { min: 30, max: 300, default: 60 }
};

// Utility functions
const utils = {
  debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  },

  validateNumber(value, constraints) {
    const num = parseInt(value);
    if (isNaN(num)) return constraints.default;
    return Math.min(Math.max(num, constraints.min), constraints.max);
  },

  formatTimestamp() {
    return new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }
};

// State management
class PopupState {
  constructor() {
    this.isRunning = false;
    this.settings = {};
    this.updateCallbacks = new Set();
  }

  update(updates) {
    Object.assign(this, updates);
    this.updateCallbacks.forEach(callback => callback(this));
  }

  onChange(callback) {
    this.updateCallbacks.add(callback);
  }
}

const state = new PopupState();

// Activity logging with batching
class ActivityLogger {
  constructor(container, maxLogs = 100) {
    this.container = container;
    this.maxLogs = maxLogs;
    this.queue = [];
    this.flushTimeout = null;
  }

  log(message, type = 'info') {
    const logEntry = {
      time: utils.formatTimestamp(),
      text: message,
      type
    };

    this.queue.push(logEntry);
    this.scheduleFlush();
  }

  scheduleFlush() {
    if (!this.flushTimeout) {
      this.flushTimeout = setTimeout(() => this.flush(), 100);
    }
  }

  flush() {
    if (this.queue.length === 0) return;

    const fragment = document.createDocumentFragment();
    
    this.queue.forEach(entry => {
      const div = document.createElement('div');
      div.className = `log-entry log-${entry.type} fade-in`;
      div.textContent = `${entry.time}: ${entry.text}`;
      fragment.prepend(div);
    });

    this.container.prepend(fragment);

    // Trim old logs
    while (this.container.children.length > this.maxLogs) {
      this.container.lastChild.remove();
    }

    this.queue = [];
    this.flushTimeout = null;
  }
}

const logger = new ActivityLogger(DOM.activityLog);

// Settings management
class SettingsManager {
  constructor() {
    this.debouncedSave = utils.debounce(this.saveSettings.bind(this), 500);
  }

  async loadSettings() {
    try {
      const result = await chrome.storage.local.get([
        'keywords',
        'viewDuration',
        'pauseDuration',
        'viewImages',
        'viewSponsored',
        'naturalScroll',
        'isRunning'
      ]);

      // Apply settings to form
      DOM.keywords.value = result.keywords || '';
      DOM.viewDuration.value = utils.validateNumber(
        result.viewDuration,
        SETTINGS_CONSTRAINTS.viewDuration
      );
      DOM.pauseDuration.value = utils.validateNumber(
        result.pauseDuration,
        SETTINGS_CONSTRAINTS.pauseDuration
      );
      DOM.viewImages.checked = result.viewImages ?? true;
      DOM.viewSponsored.checked = result.viewSponsored ?? true;
      DOM.naturalScroll.checked = result.naturalScroll ?? true;

      // Update state
      state.update({
        isRunning: result.isRunning || false,
        settings: this.getCurrentSettings()
      });

    } catch (error) {
      logger.log(`Error loading settings: ${error.message}`, 'error');
    }
  }

  getCurrentSettings() {
    return {
      keywords: DOM.keywords.value,
      viewDuration: parseInt(DOM.viewDuration.value),
      pauseDuration: parseInt(DOM.pauseDuration.value),
      viewImages: DOM.viewImages.checked,
      viewSponsored: DOM.viewSponsored.checked,
      naturalScroll: DOM.naturalScroll.checked
    };
  }

  async saveSettings() {
    try {
      const settings = this.getCurrentSettings();
      await chrome.storage.local.set(settings);
      state.update({ settings });
      logger.log('Settings saved');
    } catch (error) {
      logger.log(`Error saving settings: ${error.message}`, 'error');
    }
  }

  setupEventListeners() {
    // Save settings when changed
    const inputs = [
      DOM.keywords,
      DOM.viewDuration,
      DOM.pauseDuration,
      DOM.viewImages,
      DOM.viewSponsored,
      DOM.naturalScroll
    ];

    inputs.forEach(input => {
      input.addEventListener('change', () => this.debouncedSave());
      input.addEventListener('input', () => this.debouncedSave());
    });
  }
}

// UI management
class UIManager {
  constructor() {
    this.setupEventListeners();
  }

  updateStatus(isRunning) {
    DOM.statusDot.classList.toggle('active', isRunning);
    DOM.statusText.textContent = isRunning ? 'Active' : 'Inactive';
    DOM.startBtn.disabled = isRunning;
    DOM.stopBtn.disabled = !isRunning;
  }

  setupEventListeners() {
    // Start button
    DOM.startBtn.addEventListener('click', async () => {
      try {
        if (!DOM.keywords.value.trim()) {
          logger.log('Please enter at least one keyword', 'error');
          return;
        }

        await chrome.runtime.sendMessage({ command: 'start' });
        logger.log('Simulation started');
      } catch (error) {
        logger.log(`Error starting simulation: ${error.message}`, 'error');
      }
    });

    // Stop button
    DOM.stopBtn.addEventListener('click', async () => {
      try {
        await chrome.runtime.sendMessage({ command: 'stop' });
        logger.log('Simulation stopped');
      } catch (error) {
        logger.log(`Error stopping simulation: ${error.message}`, 'error');
      }
    });

    // Handle runtime messages
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'status') {
        state.update({ isRunning: message.isRunning });
      }
    });
  }
}

// Initialize popup
async function initializePopup() {
  const settingsManager = new SettingsManager();
  const uiManager = new UIManager();

  // Update UI when state changes
  state.onChange((newState) => {
    uiManager.updateStatus(newState.isRunning);
  });

  // Load initial settings
  await settingsManager.loadSettings();
  settingsManager.setupEventListeners();

  // Load activity logs
  const result = await chrome.storage.local.get(['activityLogs']);
  if (result.activityLogs) {
    result.activityLogs.forEach(log => {
      logger.log(log.text, log.type);
    });
  }

  logger.log('Popup initialized');
}

// Start initialization when DOM is loaded
document.addEventListener('DOMContentLoaded', initializePopup);
