// Popup script for Lead Locator

const NICHE_MAP = {
  restaurant: 'restaurants',
  gym: 'gyms fitness centers',
  salon: 'salons spas',
  clinic: 'clinics doctors',
  retail: 'retail stores shops',
  hotel: 'hotels resorts',
  realestate: 'real estate agencies',
  auto: 'auto repair car dealerships',
  education: 'schools tutoring centers',
  pet: 'pet shops veterinary clinics',
  laundry: 'laundry dry cleaning',
  construction: 'construction contractors',
  photography: 'photography studios',
};

// Search strategies to find higher-quality leads
const SEARCH_STRATEGIES = {
  default: { label: 'All businesses', modifier: '' },
  small: { label: 'Small / local businesses', modifier: 'small local independent' },
  new: { label: 'Newly opened', modifier: 'new recently opened' },
  lowRated: { label: 'Low-rated (need help)', modifier: '' }, // filtered post-scan
  noWebsite: { label: 'Without website', modifier: '' }, // filtered post-scan
};

// Stop words to filter out from keyword extraction
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought', 'used',
  'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into',
  'through', 'during', 'before', 'after', 'above', 'below', 'between', 'out',
  'off', 'over', 'under', 'again', 'further', 'then', 'once', 'that', 'this',
  'these', 'those', 'it', 'its', 'they', 'them', 'their', 'we', 'our', 'you',
  'your', 'he', 'she', 'his', 'her', 'my', 'i', 'me', 'who', 'which', 'what',
  'where', 'when', 'how', 'all', 'each', 'every', 'both', 'few', 'more', 'most',
  'other', 'some', 'such', 'no', 'not', 'only', 'same', 'so', 'than', 'too',
  'very', 'just', 'about', 'also', 'based', 'using', 'helps', 'help', 'tool',
  'system', 'software', 'platform', 'app', 'application', 'solution', 'service',
  'provides', 'allows', 'enables', 'designed', 'built', 'made', 'handles',
  'cloud', 'web', 'online', 'digital', 'smart', 'new', 'simple', 'easy',
]);

// Extract meaningful keywords from product description
function extractKeywords(text) {
  if (!text || !text.trim()) return [];
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

  // Deduplicate and keep order of first occurrence
  const seen = new Set();
  const unique = [];
  for (const w of words) {
    if (!seen.has(w)) {
      seen.add(w);
      unique.push(w);
    }
  }

  // Also extract two-word phrases that might be meaningful
  const rawWords = text.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/);
  for (let i = 0; i < rawWords.length - 1; i++) {
    const phrase = rawWords[i] + ' ' + rawWords[i + 1];
    const bothUseful = !STOP_WORDS.has(rawWords[i]) && !STOP_WORDS.has(rawWords[i + 1])
      && rawWords[i].length > 2 && rawWords[i + 1].length > 2;
    if (bothUseful && !seen.has(phrase)) {
      seen.add(phrase);
      unique.push(phrase);
    }
  }

  return unique.slice(0, 12); // cap at 12 keywords
}

document.addEventListener('DOMContentLoaded', () => {
  const nicheSelect = document.getElementById('niche-select');
  const customGroup = document.getElementById('custom-niche-group');
  const customNiche = document.getElementById('custom-niche');
  const productName = document.getElementById('product-name');
  const productDesc = document.getElementById('product-desc');
  const keywordBar = document.getElementById('keyword-bar');
  const keywordChips = document.getElementById('keyword-chips');
  const locationInput = document.getElementById('location-input');
  const searchBtn = document.getElementById('search-btn');
  const saveProfileBtn = document.getElementById('save-profile-btn');
  const presetsGrid = document.getElementById('presets-grid');
  const leadsList = document.getElementById('leads-list');
  const leadCount = document.getElementById('lead-count');
  const exportCsvBtn = document.getElementById('export-csv-btn');
  const clearLeadsBtn = document.getElementById('clear-leads-btn');

  let activeKeywords = []; // keywords currently included in search
  let excludedKeywords = new Set(); // keywords user toggled off

  // Load saved profile
  chrome.runtime.sendMessage({ type: 'GET_PROFILE' }, (res) => {
    if (res && res.profile) {
      productName.value = res.profile.productName || '';
      nicheSelect.value = res.profile.niche || '';
      locationInput.value = res.profile.location || '';
      productDesc.value = res.profile.productDesc || '';
      if (res.profile.niche === 'custom') {
        customGroup.classList.remove('hidden');
        customNiche.value = res.profile.customNiche || '';
      }
      if (res.profile.excludedKeywords) {
        excludedKeywords = new Set(res.profile.excludedKeywords);
      }
      if (res.profile.productDesc) {
        refreshKeywords();
      }
    }
  });

  // Extract keywords on description input (debounced)
  let descTimer = null;
  productDesc.addEventListener('input', () => {
    clearTimeout(descTimer);
    descTimer = setTimeout(refreshKeywords, 400);
  });

  function refreshKeywords() {
    const allKeywords = extractKeywords(productDesc.value);
    activeKeywords = allKeywords.filter((k) => !excludedKeywords.has(k));

    if (allKeywords.length === 0) {
      keywordBar.classList.add('hidden');
      keywordChips.innerHTML = '';
      return;
    }

    keywordBar.classList.remove('hidden');
    keywordChips.innerHTML = allKeywords
      .map((kw) => {
        const isExcluded = excludedKeywords.has(kw);
        return `<span class="keyword-chip ${isExcluded ? 'excluded' : ''}" data-kw="${escapeAttr(kw)}" title="Click to ${isExcluded ? 'include' : 'exclude'}">${escapeHtml(kw)} <span class="chip-x">${isExcluded ? '+' : '×'}</span></span>`;
      })
      .join('');

    // Toggle keyword on click
    keywordChips.querySelectorAll('.keyword-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const kw = chip.dataset.kw;
        if (excludedKeywords.has(kw)) {
          excludedKeywords.delete(kw);
        } else {
          excludedKeywords.add(kw);
        }
        refreshKeywords();
      });
    });
  }

  // Load leads
  loadLeads();

  // Toggle custom niche field
  nicheSelect.addEventListener('change', () => {
    if (nicheSelect.value === 'custom') {
      customGroup.classList.remove('hidden');
    } else {
      customGroup.classList.add('hidden');
    }
  });

  // Search button
  searchBtn.addEventListener('click', () => {
    const niche = nicheSelect.value;
    const location = locationInput.value.trim();
    const strategySelect = document.getElementById('strategy-select');
    const strategy = strategySelect ? strategySelect.value : 'default';
    let searchQuery = '';

    if (niche === 'custom') {
      searchQuery = customNiche.value.trim();
    } else if (niche && NICHE_MAP[niche]) {
      searchQuery = NICHE_MAP[niche];
    }

    if (!searchQuery) {
      alert('Please select an industry or enter a custom search term.');
      return;
    }

    // Apply search strategy modifier to the query
    const strat = SEARCH_STRATEGIES[strategy] || SEARCH_STRATEGIES.default;
    if (strat.modifier) {
      searchQuery = strat.modifier + ' ' + searchQuery;
    }

    // Append active keywords from product description to refine the search
    if (activeKeywords.length > 0) {
      // Pick the top 3-4 most relevant keywords to avoid overly long queries
      const topKeywords = activeKeywords.slice(0, 4).join(' ');
      searchQuery += ' ' + topKeywords;
    }

    if (location) {
      searchQuery += ' in ' + location;
    }

    // Save filter preferences so content script can auto-apply them
    const filters = {
      noWebsite: document.getElementById('filter-no-website').checked,
      lowReviews: document.getElementById('filter-low-reviews').checked,
      lowRating: document.getElementById('filter-low-rating').checked,
    };
    chrome.storage.local.set({ activeFilters: filters, productKeywords: activeKeywords });

    // Send strategy info so content script can filter results
    chrome.runtime.sendMessage({
      type: 'OPEN_MAPS_SEARCH',
      query: searchQuery,
      strategy: strategy,
    });
  });

  // Save profile
  saveProfileBtn.addEventListener('click', () => {
    const profile = {
      productName: productName.value.trim(),
      productDesc: productDesc.value.trim(),
      excludedKeywords: Array.from(excludedKeywords),
      niche: nicheSelect.value,
      customNiche: customNiche.value.trim(),
      location: locationInput.value.trim(),
    };
    chrome.runtime.sendMessage({ type: 'SAVE_PROFILE', profile }, () => {
      saveProfileBtn.textContent = 'Saved!';
      setTimeout(() => {
        saveProfileBtn.textContent = 'Save Profile';
      }, 1500);
    });
  });

  // Preset chips
  presetsGrid.addEventListener('click', (e) => {
    const chip = e.target.closest('.preset-chip');
    if (!chip) return;
    const query = chip.dataset.query;
    const location = locationInput.value.trim();
    const fullQuery = location ? `${query.replace(' near me', '')} in ${location}` : query;
    chrome.runtime.sendMessage({ type: 'OPEN_MAPS_SEARCH', query: fullQuery });
  });

  // Export CSV
  exportCsvBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'GET_LEADS' }, (res) => {
      const leads = res.leads || [];
      if (leads.length === 0) return;

      const headers = ['Name', 'Category', 'Address', 'Phone', 'Rating', 'Reviews', 'Website', 'Saved At'];
      const rows = leads.map((l) => [
        escapeCsv(l.name),
        escapeCsv(l.category),
        escapeCsv(l.address),
        escapeCsv(l.phone),
        l.rating || '',
        l.reviews || '',
        escapeCsv(l.website),
        l.savedAt || '',
      ]);

      const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = `lead-locator-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    });
  });

  // Clear leads
  clearLeadsBtn.addEventListener('click', () => {
    if (confirm('Delete all saved leads?')) {
      chrome.runtime.sendMessage({ type: 'CLEAR_LEADS' }, () => {
        loadLeads();
      });
    }
  });

  function loadLeads() {
    chrome.runtime.sendMessage({ type: 'GET_LEADS' }, (res) => {
      const leads = res.leads || [];
      leadCount.textContent = leads.length;
      exportCsvBtn.disabled = leads.length === 0;
      clearLeadsBtn.disabled = leads.length === 0;

      if (leads.length === 0) {
        leadsList.innerHTML =
          '<p class="empty-state">No leads saved yet. Search and collect leads from Google Maps!</p>';
        return;
      }

      leadsList.innerHTML = leads
        .slice()
        .reverse()
        .map(
          (l) => `
        <div class="lead-item">
          <div class="lead-info">
            <div class="lead-name">${escapeHtml(l.name)}</div>
            <div class="lead-detail">${escapeHtml(l.address || l.category || '')}</div>
          </div>
          <button class="lead-remove" data-name="${escapeAttr(l.name)}" data-address="${escapeAttr(l.address)}" title="Remove">&times;</button>
        </div>
      `
        )
        .join('');

      // Attach remove handlers
      leadsList.querySelectorAll('.lead-remove').forEach((btn) => {
        btn.addEventListener('click', () => {
          chrome.runtime.sendMessage(
            { type: 'REMOVE_LEAD', name: btn.dataset.name, address: btn.dataset.address },
            () => loadLeads()
          );
        });
      });
    });
  }

  function escapeCsv(str) {
    if (!str) return '';
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

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
});
