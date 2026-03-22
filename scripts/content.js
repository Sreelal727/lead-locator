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
  let filteredResults = [];
  let savedNames = new Set();
  let activeFilters = { noWebsite: false, lowReviews: false, lowRating: false };
  let activeStrategy = 'default';

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
        <div class="ll-filters" id="ll-filters">
          <div class="ll-filters-title">Filter leads:</div>
          <div class="ll-filter-row">
            <label class="ll-filter-toggle"><input type="checkbox" id="ll-filter-nosite"> No website</label>
            <label class="ll-filter-toggle"><input type="checkbox" id="ll-filter-lowrev"> &lt; 50 reviews</label>
            <label class="ll-filter-toggle"><input type="checkbox" id="ll-filter-lowrate"> &lt; 4.0 rating</label>
          </div>
          <div class="ll-filter-row">
            <label class="ll-filter-toggle"><input type="checkbox" id="ll-filter-hasphone"> Has phone</label>
          </div>
        </div>
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

    // Filter checkboxes
    ['ll-filter-nosite', 'll-filter-lowrev', 'll-filter-lowrate', 'll-filter-hasphone'].forEach((id) => {
      document.getElementById(id).addEventListener('change', applyFilters);
    });

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
      // Score each lead for quality
      results.forEach((biz) => {
        biz.leadScore = computeLeadScore(biz);
      });
      // Sort by lead score (highest first = most likely to need services)
      results.sort((a, b) => b.leadScore - a.leadScore);

      scanning = false;
      scanBtn.disabled = false;
      scanBtn.textContent = 'Scan Visible Listings';
      statusDot.classList.add('ll-idle');
      applyFilters();
    }, 800);
  }

  // ---- Lead Quality Score ----
  // Higher score = more likely to need your product/service
  function computeLeadScore(biz) {
    let score = 50; // base score

    // No website = high opportunity (they need digital presence)
    if (!biz.website) score += 30;

    // Low rating = they need help improving their business
    const rating = parseFloat(biz.rating);
    if (rating && rating < 3.5) score += 20;
    else if (rating && rating < 4.0) score += 10;

    // Few reviews = small/new business, easier to approach
    const reviews = parseInt(biz.reviews);
    if (!reviews || reviews < 10) score += 20;
    else if (reviews < 50) score += 10;
    else if (reviews > 500) score -= 10; // big chain, harder to sell to

    // Has phone = you can actually reach them
    if (biz.phone) score += 5;

    // Has address = legitimate local business
    if (biz.address) score += 5;

    return Math.max(0, Math.min(100, score));
  }

  // ---- Apply Filters ----
  function applyFilters() {
    const noSite = document.getElementById('ll-filter-nosite').checked;
    const lowRev = document.getElementById('ll-filter-lowrev').checked;
    const lowRate = document.getElementById('ll-filter-lowrate').checked;
    const hasPhone = document.getElementById('ll-filter-hasphone').checked;

    filteredResults = results.filter((biz) => {
      if (noSite && biz.website) return false;
      if (lowRev) {
        const rev = parseInt(biz.reviews);
        if (rev && rev >= 50) return false;
      }
      if (lowRate) {
        const rat = parseFloat(biz.rating);
        if (rat && rat >= 4.0) return false;
      }
      if (hasPhone && !biz.phone) return false;
      return true;
    });

    const statusText = document.getElementById('ll-status-text');
    if (filteredResults.length !== results.length) {
      statusText.textContent = `Showing ${filteredResults.length} of ${results.length} businesses`;
    } else {
      statusText.textContent = `Found ${results.length} businesses`;
    }
    renderResults();
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
    const displayResults = filteredResults.length > 0 || results.length > 0 ? filteredResults : [];

    if (results.length === 0) {
      container.innerHTML = `
        <div class="ll-no-results">
          No listings found. Try scrolling the results panel on the left, then scan again.
        </div>
      `;
      return;
    }

    if (displayResults.length === 0) {
      container.innerHTML = `
        <div class="ll-no-results">
          No listings match your filters. Try unchecking some filters above.
        </div>
      `;
      return;
    }

    let html = `
      <div class="ll-results-header">
        <h3>Listings Found</h3>
        <span class="ll-results-count">${displayResults.length} results</span>
      </div>
    `;

    displayResults.forEach((biz, idx) => {
      const isSaved = savedNames.has(biz.name + '|' + biz.address);
      const scoreClass = biz.leadScore >= 70 ? 'll-score-hot' : biz.leadScore >= 50 ? 'll-score-warm' : 'll-score-cold';
      const scoreLabel = biz.leadScore >= 70 ? 'Hot' : biz.leadScore >= 50 ? 'Warm' : 'Low';
      // Build signal tags
      const signals = [];
      if (!biz.website) signals.push('No website');
      const rev = parseInt(biz.reviews);
      if (!rev || rev < 50) signals.push('Few reviews');
      const rat = parseFloat(biz.rating);
      if (rat && rat < 4.0) signals.push('Low rating');

      html += `
        <div class="ll-result-card" data-idx="${idx}">
          <div class="ll-card-top">
            <div class="ll-biz-name">${escapeHtml(biz.name)}</div>
            <span class="ll-lead-score ${scoreClass}" title="Lead score: ${biz.leadScore}/100">${scoreLabel} ${biz.leadScore}</span>
          </div>
          ${biz.category ? `<div class="ll-biz-category">${escapeHtml(biz.category)}</div>` : ''}
          ${biz.rating ? `<div class="ll-biz-rating">${'&#9733;'.repeat(Math.round(parseFloat(biz.rating)))} ${biz.rating} (${biz.reviews || '?'} reviews)</div>` : ''}
          ${biz.address ? `<div class="ll-biz-detail">${escapeHtml(biz.address)}</div>` : ''}
          ${biz.phone ? `<div class="ll-biz-detail">${escapeHtml(biz.phone)}</div>` : ''}
          ${signals.length > 0 ? `<div class="ll-signals">${signals.map(s => `<span class="ll-signal-tag">${s}</span>`).join('')}</div>` : ''}
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

    // Attach event listeners — idx maps to filteredResults
    container.querySelectorAll('.ll-save-btn').forEach((btn) => {
      btn.addEventListener('click', () => saveFilteredLead(parseInt(btn.dataset.idx), btn));
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
  function saveFilteredLead(idx, btn) {
    const biz = filteredResults[idx];
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
    filteredResults.forEach((biz, idx) => {
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
    if (filteredResults.length === 0) return;

    const headers = ['Name', 'Category', 'Address', 'Phone', 'Rating', 'Reviews', 'Website', 'Maps URL', 'Lead Score'];
    const rows = filteredResults.map((l) => [
      csvEscape(l.name),
      csvEscape(l.category),
      csvEscape(l.address),
      csvEscape(l.phone),
      l.rating || '',
      l.reviews || '',
      csvEscape(l.website),
      csvEscape(l.mapsUrl),
      l.leadScore || '',
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

  // ---- Listen for strategy and filters from popup ----
  chrome.storage.local.get(['activeStrategy', 'activeFilters'], (result) => {
    if (result.activeStrategy) {
      activeStrategy = result.activeStrategy;
      // Auto-check filters based on strategy
      if (activeStrategy === 'noWebsite') {
        const cb = document.getElementById('ll-filter-nosite');
        if (cb) cb.checked = true;
      } else if (activeStrategy === 'lowRated') {
        const cb = document.getElementById('ll-filter-lowrate');
        if (cb) cb.checked = true;
      }
    }
    // Apply filter preferences set in popup
    if (result.activeFilters) {
      const f = result.activeFilters;
      if (f.noWebsite) {
        const cb = document.getElementById('ll-filter-nosite');
        if (cb) cb.checked = true;
      }
      if (f.lowReviews) {
        const cb = document.getElementById('ll-filter-lowrev');
        if (cb) cb.checked = true;
      }
      if (f.lowRating) {
        const cb = document.getElementById('ll-filter-lowrate');
        if (cb) cb.checked = true;
      }
    }
  });

  // ---- Initialize ----
  createPanel();
})();
