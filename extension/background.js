// background.js — Service Worker (context menu only, translation handled by content.js)

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'translate-selection',
    title: '📖 Dịch sang tiếng Việt',
    contexts: ['selection'],
  });
  chrome.contextMenus.create({
    id: 'translate-page-summary',
    title: '📄 Tóm tắt trang này',
    contexts: ['page'],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;

  if (info.menuItemId === 'translate-selection' && info.selectionText) {
    // Inject content script first (in case page was open before extension install)
    chrome.scripting.executeScript(
      { target: { tabId: tab.id }, files: ['content.js'] },
      () => {
        // Ignore "already injected" error
        chrome.runtime.lastError;
        // Small delay to ensure script is ready
        setTimeout(() => {
          chrome.tabs.sendMessage(tab.id, {
            action: 'translateText',
            text: info.selectionText,
          }).catch(() => {
            // Content script not ready — try injecting CSS too
            chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['content.css'] });
          });
        }, 100);
      }
    );
  }

  if (info.menuItemId === 'translate-page-summary') {
    chrome.scripting.executeScript(
      { target: { tabId: tab.id }, files: ['content.js'] },
      () => {
        chrome.runtime.lastError;
        setTimeout(() => {
          chrome.tabs.sendMessage(tab.id, { action: 'summarizePage' }).catch(() => {});
        }, 100);
      }
    );
  }
});
