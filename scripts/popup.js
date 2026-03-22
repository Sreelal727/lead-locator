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

document.addEventListener('DOMContentLoaded', () => {
  const nicheSelect = document.getElementById('niche-select');
  const customGroup = document.getElementById('custom-niche-group');
  const customNiche = document.getElementById('custom-niche');
  const productName = document.getElementById('product-name');
  const locationInput = document.getElementById('location-input');
  const searchBtn = document.getElementById('search-btn');
  const saveProfileBtn = document.getElementById('save-profile-btn');
  const presetsGrid = document.getElementById('presets-grid');
  const leadsList = document.getElementById('leads-list');
  const leadCount = document.getElementById('lead-count');
  const exportCsvBtn = document.getElementById('export-csv-btn');
  const clearLeadsBtn = document.getElementById('clear-leads-btn');

  // Load saved profile
  chrome.runtime.sendMessage({ type: 'GET_PROFILE' }, (res) => {
    if (res && res.profile) {
      productName.value = res.profile.productName || '';
      nicheSelect.value = res.profile.niche || '';
      locationInput.value = res.profile.location || '';
      if (res.profile.niche === 'custom') {
        customGroup.classList.remove('hidden');
        customNiche.value = res.profile.customNiche || '';
      }
    }
  });

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

    if (location) {
      searchQuery += ' in ' + location;
    }

    // Save filter preferences so content script can auto-apply them
    const filters = {
      noWebsite: document.getElementById('filter-no-website').checked,
      lowReviews: document.getElementById('filter-low-reviews').checked,
      lowRating: document.getElementById('filter-low-rating').checked,
    };
    chrome.storage.local.set({ activeFilters: filters });

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
