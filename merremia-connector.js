/**
 * Merremia Dashboard Connector v1.0
 * 
 * Fetches field-collected data from a GitHub data repository
 * and provides processed data for the Merremia Vanuatu Dashboard.
 * 
 * SETUP:
 * 1. Add this script to your dashboard HTML:
 *    <script src="merremia-connector.js"></script>
 * 
 * 2. Initialize with your data repo details:
 *    const connector = new MerremiaConnector({
 *      owner: 'welinrj',
 *      repo: 'merremia-field-data',
 *      branch: 'main'
 *    });
 * 
 * 3. Fetch and use the data:
 *    const data = await connector.fetchAll();
 *    // data.records    → all field records
 *    // data.stats      → aggregated statistics  
 *    // data.byIsland   → records grouped by island
 *    // data.bySpecies  → records grouped by species
 *    // data.timeline   → records sorted by date
 *    // data.geoJSON    → GeoJSON for mapping
 * 
 * AUTOMATIC REFRESH:
 *    connector.startAutoRefresh(300000, (data) => {
 *      // Called every 5 minutes with fresh data
 *      updateDashboard(data);
 *    });
 */

class MerremiaConnector {
  constructor(config = {}) {
    this.owner = config.owner || 'welinrj';
    this.repo = config.repo || 'merremia-field-data';
    this.branch = config.branch || 'main';
    this.cacheKey = `merremia_dashboard_cache_${this.owner}_${this.repo}`;
    this.cacheTTL = config.cacheTTL || 5 * 60 * 1000; // 5 min default
    this.refreshInterval = null;
    this.lastFetch = null;
    this.onError = config.onError || console.error;
  }

  /**
   * Base URL for raw GitHub content
   */
  get baseURL() {
    return `https://raw.githubusercontent.com/${this.owner}/${this.repo}/${this.branch}`;
  }

  /**
   * API URL for GitHub contents
   */
  get apiURL() {
    return `https://api.github.com/repos/${this.owner}/${this.repo}/contents`;
  }

  // ═══════════════════════════════════════
  // CORE DATA FETCHING
  // ═══════════════════════════════════════

  /**
   * Fetch all records and return processed data
   */
  async fetchAll() {
    try {
      // Try cache first
      const cached = this.getCache();
      if (cached) return cached;

      // Fetch master data file
      const response = await fetch(`${this.baseURL}/data/all-records.json?t=${Date.now()}`);

      if (!response.ok) {
        if (response.status === 404) {
          console.warn('[Connector] No data file found yet — repo may be empty');
          return this.emptyData();
        }
        throw new Error(`GitHub fetch failed: ${response.status}`);
      }

      const records = await response.json();
      const processed = this.processRecords(records);

      // Cache it
      this.setCache(processed);
      this.lastFetch = new Date();

      return processed;
    } catch (err) {
      this.onError('[Connector] Fetch error:', err);
      // Return cached data if available, even if stale
      const staleCache = this.getCache(true);
      if (staleCache) {
        console.warn('[Connector] Using stale cache');
        return staleCache;
      }
      return this.emptyData();
    }
  }

  /**
   * Fetch CSV version of data
   */
  async fetchCSV() {
    try {
      const response = await fetch(`${this.baseURL}/data/all-records.csv?t=${Date.now()}`);
      if (!response.ok) throw new Error(`CSV fetch failed: ${response.status}`);
      return await response.text();
    } catch (err) {
      this.onError('[Connector] CSV fetch error:', err);
      return null;
    }
  }

  /**
   * List available photo files for a record
   */
  async getRecordPhotos(recordId) {
    try {
      const response = await fetch(`${this.apiURL}/photos`, {
        headers: { 'Accept': 'application/vnd.github.v3+json' }
      });
      if (!response.ok) return [];

      const files = await response.json();
      return files
        .filter(f => f.name.startsWith(recordId))
        .map(f => ({
          name: f.name,
          url: f.download_url,
          size: f.size
        }));
    } catch {
      return [];
    }
  }

  // ═══════════════════════════════════════
  // DATA PROCESSING
  // ═══════════════════════════════════════

  /**
   * Process raw records into dashboard-ready data
   */
  processRecords(records) {
    if (!Array.isArray(records) || records.length === 0) return this.emptyData();

    // Sort by timestamp descending
    const sorted = [...records].sort((a, b) =>
      new Date(b.timestamp) - new Date(a.timestamp)
    );

    return {
      records: sorted,
      stats: this.calculateStats(sorted),
      byIsland: this.groupByIsland(sorted),
      bySpecies: this.groupBySpecies(sorted),
      byThreat: this.groupByThreat(sorted),
      timeline: this.buildTimeline(sorted),
      geoJSON: this.toGeoJSON(sorted),
      heatmapData: this.buildHeatmap(sorted),
      lastUpdated: sorted[0]?.timestamp || null,
      totalRecords: sorted.length
    };
  }

  /**
   * Calculate aggregate statistics
   */
  calculateStats(records) {
    const speciesSet = new Set();
    const islandSet = new Set();
    const siteSet = new Set();
    let totalCount = 0;
    let totalArea = 0;
    let highThreat = 0;
    let modThreat = 0;
    let lowThreat = 0;
    const observers = new Set();

    records.forEach(r => {
      (r.species || []).forEach(s => speciesSet.add(s));
      if (r.island) islandSet.add(r.island);
      if (r.siteName) siteSet.add(r.siteName);
      if (r.count) totalCount += r.count;
      if (r.coverageArea) totalArea += r.coverageArea;
      if (r.observer) observers.add(r.observer);
      if (r.threatLevel === 'high') highThreat++;
      else if (r.threatLevel === 'moderate') modThreat++;
      else lowThreat++;
    });

    return {
      speciesCount: speciesSet.size,
      speciesList: [...speciesSet].sort(),
      islandCount: islandSet.size,
      islandList: [...islandSet].sort(),
      siteCount: siteSet.size,
      totalObservations: totalCount,
      totalAreaHectares: Math.round(totalArea * 10) / 10,
      threatBreakdown: { high: highThreat, moderate: modThreat, low: lowThreat },
      observerCount: observers.size,
      recordCount: records.length,
      dateRange: {
        earliest: records[records.length - 1]?.timestamp,
        latest: records[0]?.timestamp
      }
    };
  }

  /**
   * Group records by island
   */
  groupByIsland(records) {
    const groups = {};
    records.forEach(r => {
      const island = r.island || 'Unknown';
      if (!groups[island]) groups[island] = { records: [], totalCount: 0, totalArea: 0, species: new Set() };
      groups[island].records.push(r);
      if (r.count) groups[island].totalCount += r.count;
      if (r.coverageArea) groups[island].totalArea += r.coverageArea;
      (r.species || []).forEach(s => groups[island].species.add(s));
    });

    // Convert Sets to arrays
    Object.values(groups).forEach(g => { g.species = [...g.species]; });
    return groups;
  }

  /**
   * Group records by species
   */
  groupBySpecies(records) {
    const groups = {};
    records.forEach(r => {
      (r.species || []).forEach(sp => {
        if (!groups[sp]) groups[sp] = { records: [], totalCount: 0, islands: new Set(), threats: { high: 0, moderate: 0, low: 0 } };
        groups[sp].records.push(r);
        if (r.count) groups[sp].totalCount += r.count;
        if (r.island) groups[sp].islands.add(r.island);
        if (r.threatLevel) groups[sp].threats[r.threatLevel]++;
      });
    });

    Object.values(groups).forEach(g => { g.islands = [...g.islands]; });
    return groups;
  }

  /**
   * Group records by threat level
   */
  groupByThreat(records) {
    return {
      high: records.filter(r => r.threatLevel === 'high'),
      moderate: records.filter(r => r.threatLevel === 'moderate'),
      low: records.filter(r => r.threatLevel === 'low')
    };
  }

  /**
   * Build timeline data for charts
   */
  buildTimeline(records) {
    const byMonth = {};
    records.forEach(r => {
      const d = new Date(r.timestamp);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!byMonth[key]) byMonth[key] = { month: key, records: 0, count: 0, area: 0 };
      byMonth[key].records++;
      if (r.count) byMonth[key].count += r.count;
      if (r.coverageArea) byMonth[key].area += r.coverageArea;
    });

    return Object.values(byMonth).sort((a, b) => a.month.localeCompare(b.month));
  }

  /**
   * Convert records to GeoJSON for mapping
   */
  toGeoJSON(records) {
    const features = records
      .filter(r => r.gps?.lat && r.gps?.lng)
      .map(r => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [r.gps.lng, r.gps.lat]
        },
        properties: {
          id: r.id,
          species: r.species,
          speciesLabel: r.species.join(', '),
          count: r.count,
          threatLevel: r.threatLevel,
          island: r.island,
          siteName: r.siteName,
          observer: r.observer,
          timestamp: r.timestamp,
          coverageArea: r.coverageArea,
          notes: r.notes,
          accuracy: r.gps.accuracy
        }
      }));

    return {
      type: 'FeatureCollection',
      features
    };
  }

  /**
   * Build heatmap-ready data
   */
  buildHeatmap(records) {
    return records
      .filter(r => r.gps?.lat && r.gps?.lng)
      .map(r => ({
        lat: r.gps.lat,
        lng: r.gps.lng,
        intensity: r.threatLevel === 'high' ? 1.0 : r.threatLevel === 'moderate' ? 0.6 : 0.3,
        count: r.count || 1
      }));
  }

  // ═══════════════════════════════════════
  // FILTERING
  // ═══════════════════════════════════════

  /**
   * Filter records by criteria
   */
  filterRecords(records, filters = {}) {
    return records.filter(r => {
      if (filters.island && r.island !== filters.island) return false;
      if (filters.species && !r.species.includes(filters.species)) return false;
      if (filters.threat && r.threatLevel !== filters.threat) return false;
      if (filters.observer && r.observer !== filters.observer) return false;
      if (filters.dateFrom && new Date(r.timestamp) < new Date(filters.dateFrom)) return false;
      if (filters.dateTo && new Date(r.timestamp) > new Date(filters.dateTo)) return false;
      if (filters.minCount && (r.count || 0) < filters.minCount) return false;
      return true;
    });
  }

  // ═══════════════════════════════════════
  // AUTO-REFRESH
  // ═══════════════════════════════════════

  /**
   * Start auto-refreshing data at an interval
   * @param {number} intervalMs - Refresh interval in milliseconds (default: 5 min)
   * @param {function} callback - Called with fresh data on each refresh
   */
  startAutoRefresh(intervalMs = 300000, callback) {
    this.stopAutoRefresh();

    // Initial fetch
    this.fetchAll().then(data => callback?.(data));

    this.refreshInterval = setInterval(async () => {
      try {
        this.clearCache(); // Force fresh fetch
        const data = await this.fetchAll();
        callback?.(data);
      } catch (err) {
        this.onError('[Connector] Auto-refresh error:', err);
      }
    }, intervalMs);
  }

  /**
   * Stop auto-refreshing
   */
  stopAutoRefresh() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  // ═══════════════════════════════════════
  // CACHING
  // ═══════════════════════════════════════

  getCache(ignoreExpiry = false) {
    try {
      const raw = localStorage.getItem(this.cacheKey);
      if (!raw) return null;
      const { data, timestamp } = JSON.parse(raw);
      if (!ignoreExpiry && Date.now() - timestamp > this.cacheTTL) return null;
      return data;
    } catch { return null; }
  }

  setCache(data) {
    try {
      localStorage.setItem(this.cacheKey, JSON.stringify({
        data,
        timestamp: Date.now()
      }));
    } catch (err) {
      console.warn('[Connector] Cache write failed:', err);
    }
  }

  clearCache() {
    localStorage.removeItem(this.cacheKey);
  }

  // ═══════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════

  emptyData() {
    return {
      records: [],
      stats: {
        speciesCount: 0, speciesList: [], islandCount: 0, islandList: [],
        siteCount: 0, totalObservations: 0, totalAreaHectares: 0,
        threatBreakdown: { high: 0, moderate: 0, low: 0 },
        observerCount: 0, recordCount: 0, dateRange: { earliest: null, latest: null }
      },
      byIsland: {},
      bySpecies: {},
      byThreat: { high: [], moderate: [], low: [] },
      timeline: [],
      geoJSON: { type: 'FeatureCollection', features: [] },
      heatmapData: [],
      lastUpdated: null,
      totalRecords: 0
    };
  }
}

// ═══════════════════════════════════════════
// DASHBOARD INTEGRATION HELPERS
// ═══════════════════════════════════════════

/**
 * Quick-start function for integrating with an existing dashboard.
 * 
 * Usage in your dashboard HTML:
 *   <script src="merremia-connector.js"></script>
 *   <script>
 *     initMerremiaLiveData({
 *       owner: 'welinrj',
 *       repo: 'merremia-field-data',
 *       onData: (data) => {
 *         // Update your dashboard elements
 *         document.getElementById('species-count').textContent = data.stats.speciesCount;
 *         document.getElementById('total-area').textContent = data.stats.totalAreaHectares + ' ha';
 *         updateMap(data.geoJSON);
 *         updateCharts(data.byIsland, data.timeline);
 *       },
 *       refreshInterval: 300000 // 5 min
 *     });
 *   </script>
 */
function initMerremiaLiveData(config) {
  const connector = new MerremiaConnector({
    owner: config.owner,
    repo: config.repo,
    branch: config.branch,
    onError: config.onError
  });

  connector.startAutoRefresh(config.refreshInterval || 300000, (data) => {
    if (config.onData) config.onData(data);
  });

  // Return connector for manual control
  return connector;
}

// Export for module environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MerremiaConnector, initMerremiaLiveData };
}
