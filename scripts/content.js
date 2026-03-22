// Content script - runs on Google Maps pages
// Scrapes visible business listings and provides an overlay UI to save leads

(function () {
  'use strict';

  // Prevent double injection
  if (window.__leadLocatorLoaded) return;
  window.__leadLocatorLoaded = true;

  let panelVisible = true;
  let scanning = false;
  let results = [];
  let savedNames = new Set();

  // Load existing saved leads to mark them
  chrome.runtime.sendMessage({ type: 'GET_LEADS' }, (res) => {
    const leads = res.leads || [];
    leads.forEach((l) => savedNames.add(l.name + '|' + l.address));
  });

  // ---- Build Overlay Panel ----
  function createPanel() {
    const panel = document.createElement('div');
    panel.id = 'll-overlay-panel';
    panel.innerHTML = `
      <div id="ll-panel-header">
        <span class="ll-title">Lead Locator</span>
        <div class="ll-controls">
          <button id="ll-minimize-btn" title="Minimize">&#8722;</button>
          <button id="ll-close-btn" title="Close">&#10005;</button>
        </div>
      </div>
      <div id="ll-panel-body">
        <div class="ll-status">
          <span class="ll-status-dot ll-idle" id="ll-status-dot"></span>
          <span id="ll-status-text">Ready - navigate to a Maps search to scan</span>
        </div>
        <button class="ll-scan-btn" id="ll-scan-btn">Scan Visible Listings</button>
        <div id="ll-results-container"></div>
      </div>
    `;
    document.body.appendChild(panel);

    // Toggle button (shown when panel is closed)
    const toggleBtn = document.createElement('button');
    toggleBtn.id = 'll-toggle-btn';
    toggleBtn.innerHTML = '&#9678;';
    toggleBtn.title = 'Open Lead Locator';
    document.body.appendChild(toggleBtn);

    // Event listeners
    document.getElementById('ll-minimize-btn').addEventListener('click', () => {
      panel.classList.toggle('ll-collapsed');
    });

    document.getElementById('ll-close-btn').addEventListener('click', () => {
      panel.style.display = 'none';
      toggleBtn.style.display = 'flex';
    });

    toggleBtn.addEventListener('click', () => {
      panel.style.display = '';
      toggleBtn.style.display = 'none';
    });

    document.getElementById('ll-scan-btn').addEventListener('click', scanListings);

    // Make panel draggable
    makeDraggable(panel, document.getElementById('ll-panel-header'));
  }

  // ---- Draggable ----
  function makeDraggable(el, handle) {
    let offsetX, offsetY, isDragging = false;

    handle.addEventListener('mousedown', (e) => {
      isDragging = true;
      offsetX = e.clientX - el.getBoundingClientRect().left;
      offsetY = e.clientY - el.getBoundingClientRect().top;
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      el.style.left = (e.clientX - offsetX) + 'px';
      el.style.top = (e.clientY - offsetY) + 'px';
      el.style.right = 'auto';
    });

    document.addEventListener('mouseup', () => {
      isDragging = false;
    });
  }

  // ---- Scan Listings ----
  function scanListings() {
    if (scanning) return;
    scanning = true;

    const scanBtn = document.getElementById('ll-scan-btn');
    const statusDot = document.getElementById('ll-status-dot');
    const statusText = document.getElementById('ll-status-text');

    scanBtn.disabled = true;
    scanBtn.innerHTML = '<span class="ll-spinner"></span> Scanning...';
    statusDot.classList.remove('ll-idle');
    statusText.textContent = 'Scanning visible listings...';

    // Small delay to let UI update
    setTimeout(() => {
      results = extractListings();
      scanning = false;
      scanBtn.disabled = false;
      scanBtn.textContent = 'Scan Visible Listings';
      statusDot.classList.add('ll-idle');
      statusText.textContent = `Found ${results.length} businesses`;
      renderResults();
    }, 800);
  }

  // ---- Extract business data from Google Maps DOM ----
  function extractListings() {
    const listings = [];

    // Google Maps search results are in elements with role="feed" or specific class patterns
    // Try multiple selectors for robustness
    const selectors = [
      'div[role="feed"] > div > div > a[href*="/maps/place/"]',
      'a[href*="/maps/place/"]',
      'div.Nv2PK',
    ];

    const seen = new Set();
    let elements = [];

    for (const sel of selectors) {
      const found = document.querySelectorAll(sel);
      if (found.length > 0) {
        elements = found;
        break;
      }
    }

    // Also try to find the feed container and iterate its children
    if (elements.length === 0) {
      const feed = document.querySelector('div[role="feed"]');
      if (feed) {
        elements = feed.children;
      }
    }

    for (const el of elements) {
      try {
        const listing = parseListingElement(el);
        if (listing && listing.name && !seen.has(listing.name)) {
          seen.add(listing.name);
          listings.push(listing);
        }
      } catch (e) {
        // Skip unparseable elements
      }
    }

    return listings;
  }

  function parseListingElement(el) {
    const listing = {
      name: '',
      category: '',
      address: '',
      phone: '',
      rating: '',
      reviews: '',
      website: '',
      mapsUrl: '',
    };

    // Try to get name from aria-label of the link
    const link = el.tagName === 'A' ? el : el.querySelector('a[href*="/maps/place/"]');
    if (link) {
      listing.name = link.getAttribute('aria-label') || '';
      listing.mapsUrl = link.href || '';
    }

    // If no name from link, try other approaches
    if (!listing.name) {
      // Look for prominent text elements
      const nameEl = el.querySelector('.fontHeadlineSmall, .qBF1Pd, .NrDZNb');
      if (nameEl) {
        listing.name = nameEl.textContent.trim();
      }
    }

    // Get all text content and try to parse it
    const allText = el.textContent || '';

    // Rating (e.g., "4.5" followed by stars)
    const ratingMatch = allText.match(/(\d\.\d)\s*\([\d,]+\)/);
    if (ratingMatch) {
      listing.rating = ratingMatch[1];
    }

    // Review count
    const reviewMatch = allText.match(/\(([\d,]+)\)/);
    if (reviewMatch) {
      listing.reviews = reviewMatch[1].replace(/,/g, '');
    }

    // Category - usually appears after rating info
    const categoryEl = el.querySelector('.W4Efsd:nth-child(2) .W4Efsd span:first-child, .fontBodyMedium > span');
    if (categoryEl) {
      const catText = categoryEl.textContent.trim();
      if (catText && catText.length < 60 && !/^\d/.test(catText)) {
        listing.category = catText.replace(/^·\s*/, '').trim();
      }
    }

    // Address - look for common patterns
    const addressMatch = allText.match(/(\d+\s+[\w\s]+(?:St|Ave|Blvd|Rd|Dr|Ln|Way|Ct|Pl|Pkwy|Hwy|Cir)[.\s,]*[\w\s]*)/i);
    if (addressMatch) {
      listing.address = addressMatch[1].trim();
    } else {
      // Fallback: look for text nodes that look like addresses
      const spans = el.querySelectorAll('.W4Efsd span, .fontBodyMedium span');
      for (const span of spans) {
        const text = span.textContent.trim();
        if (text.length > 10 && text.length < 100 && /\d/.test(text) && !text.includes('(')) {
          listing.address = text.replace(/^·\s*/, '').trim();
          break;
        }
      }
    }

    // Phone
    const phoneMatch = allText.match(/(\+?[\d\s\-().]{10,})/);
    if (phoneMatch) {
      const phone = phoneMatch[1].trim();
      if (phone.replace(/\D/g, '').length >= 10) {
        listing.phone = phone;
      }
    }

    // Website - from any link that's not a maps link
    const websiteLinks = el.querySelectorAll('a[href]:not([href*="google.com/maps"])');
    for (const wl of websiteLinks) {
      const href = wl.href;
      if (href && href.startsWith('http') && !href.includes('google.com')) {
        listing.website = href;
        break;
      }
    }

    return listing;
  }

  // ---- Render Results ----
  function renderResults() {
    const container = document.getElementById('ll-results-container');

    if (results.length === 0) {
      container.innerHTML = `
        <div class="ll-no-results">
          No listings found. Try scrolling the results panel on the left, then scan again.
        </div>
      `;
      return;
    }

    let html = `
      <div class="ll-results-header">
        <h3>Listings Found</h3>
        <span class="ll-results-count">${results.length} results</span>
      </div>
    `;

    results.forEach((biz, idx) => {
      const isSaved = savedNames.has(biz.name + '|' + biz.address);
      html += `
        <div class="ll-result-card" data-idx="${idx}">
          <div class="ll-biz-name">${escapeHtml(biz.name)}</div>
          ${biz.category ? `<div class="ll-biz-category">${escapeHtml(biz.category)}</div>` : ''}
          ${biz.rating ? `<div class="ll-biz-rating">${'&#9733;'.repeat(Math.round(parseFloat(biz.rating)))} ${biz.rating} (${biz.reviews || '?'} reviews)</div>` : ''}
          ${biz.address ? `<div class="ll-biz-detail">${escapeHtml(biz.address)}</div>` : ''}
          ${biz.phone ? `<div class="ll-biz-detail">${escapeHtml(biz.phone)}</div>` : ''}
          <div class="ll-result-actions">
            <button class="ll-save-btn ${isSaved ? 'll-saved' : ''}" data-idx="${idx}">
              ${isSaved ? 'Saved' : 'Save Lead'}
            </button>
            ${biz.mapsUrl ? `<button class="ll-open-btn" data-url="${escapeAttr(biz.mapsUrl)}">View</button>` : ''}
          </div>
        </div>
      `;
    });

    html += `
      <div class="ll-export-bar">
        <button class="ll-select-all" id="ll-save-all-btn">Save All</button>
        <button class="ll-export-csv" id="ll-export-btn">Export CSV</button>
      </div>
    `;

    container.innerHTML = html;

    // Attach event listeners
    container.querySelectorAll('.ll-save-btn').forEach((btn) => {
      btn.addEventListener('click', () => saveLead(parseInt(btn.dataset.idx), btn));
    });

    container.querySelectorAll('.ll-open-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        window.open(btn.dataset.url, '_blank');
      });
    });

    const saveAllBtn = document.getElementById('ll-save-all-btn');
    if (saveAllBtn) {
      saveAllBtn.addEventListener('click', saveAllLeads);
    }

    const exportBtn = document.getElementById('ll-export-btn');
    if (exportBtn) {
      exportBtn.addEventListener('click', exportCurrentResults);
    }
  }

  // ---- Save Lead ----
  function saveLead(idx, btn) {
    const biz = results[idx];
    if (!biz) return;

    chrome.runtime.sendMessage({ type: 'SAVE_LEAD', lead: biz }, (res) => {
      if (res && res.success) {
        btn.classList.add('ll-saved');
        btn.textContent = 'Saved';
        savedNames.add(biz.name + '|' + biz.address);
      } else if (res && res.reason === 'duplicate') {
        btn.classList.add('ll-saved');
        btn.textContent = 'Already Saved';
      }
    });
  }

  function saveAllLeads() {
    results.forEach((biz, idx) => {
      const key = biz.name + '|' + biz.address;
      if (!savedNames.has(key)) {
        chrome.runtime.sendMessage({ type: 'SAVE_LEAD', lead: biz }, (res) => {
          if (res && res.success) {
            savedNames.add(key);
          }
        });
      }
    });

    // Update all buttons
    setTimeout(() => {
      document.querySelectorAll('.ll-save-btn').forEach((btn) => {
        btn.classList.add('ll-saved');
        btn.textContent = 'Saved';
      });
    }, 500);
  }

  // ---- Export CSV directly from content script ----
  function exportCurrentResults() {
    if (results.length === 0) return;

    const headers = ['Name', 'Category', 'Address', 'Phone', 'Rating', 'Reviews', 'Website', 'Maps URL'];
    const rows = results.map((l) => [
      csvEscape(l.name),
      csvEscape(l.category),
      csvEscape(l.address),
      csvEscape(l.phone),
      l.rating || '',
      l.reviews || '',
      csvEscape(l.website),
      csvEscape(l.mapsUrl),
    ]);

    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ---- Helpers ----
  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function escapeAttr(str) {
    if (!str) return '';
    return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function csvEscape(str) {
    if (!str) return '';
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  // ---- Initialize ----
  createPanel();
})();
