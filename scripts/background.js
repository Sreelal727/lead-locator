// Background service worker for Lead Locator

// Listen for messages from popup or content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'OPEN_MAPS_SEARCH') {
    const query = encodeURIComponent(message.query);
    const url = `https://www.google.com/maps/search/${query}`;
    chrome.tabs.create({ url }, (tab) => {
      sendResponse({ success: true, tabId: tab.id });
    });
    return true; // keep message channel open for async response
  }

  if (message.type === 'GET_LEADS') {
    chrome.storage.local.get(['leads'], (result) => {
      sendResponse({ leads: result.leads || [] });
    });
    return true;
  }

  if (message.type === 'SAVE_LEAD') {
    chrome.storage.local.get(['leads'], (result) => {
      const leads = result.leads || [];
      // Avoid duplicates by name + address
      const exists = leads.some(
        (l) => l.name === message.lead.name && l.address === message.lead.address
      );
      if (!exists) {
        leads.push({ ...message.lead, savedAt: new Date().toISOString() });
        chrome.storage.local.set({ leads }, () => {
          sendResponse({ success: true, count: leads.length });
        });
      } else {
        sendResponse({ success: false, reason: 'duplicate' });
      }
    });
    return true;
  }

  if (message.type === 'REMOVE_LEAD') {
    chrome.storage.local.get(['leads'], (result) => {
      let leads = result.leads || [];
      leads = leads.filter(
        (l) => !(l.name === message.name && l.address === message.address)
      );
      chrome.storage.local.set({ leads }, () => {
        sendResponse({ success: true, count: leads.length });
      });
    });
    return true;
  }

  if (message.type === 'CLEAR_LEADS') {
    chrome.storage.local.set({ leads: [] }, () => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === 'SAVE_PROFILE') {
    chrome.storage.local.set({ profile: message.profile }, () => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === 'GET_PROFILE') {
    chrome.storage.local.get(['profile'], (result) => {
      sendResponse({ profile: result.profile || null });
    });
    return true;
  }
});
