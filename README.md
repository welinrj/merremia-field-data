# 🌿 Merremia Field Collector

Offline-first Progressive Web App for collecting invasive vine (*Merremia* spp.) field data across Vanuatu. Data syncs to GitHub and feeds directly into the [Merremia Vanuatu Dashboard](https://welinrj.github.io/merremia-vanuatu-dashboard/).

## Architecture

```
📱 Field Collector PWA          📊 Data Repo (GitHub)         🖥️ Dashboard
────────────────────           ─────────────────────         ──────────────
• GPS capture                   records/                     • Fetches from
• Photo capture        sync     ├── rec_abc123.json          data repo via
• Species forms      ──────►   ├── rec_def456.json          connector.js
• Offline queue                photos/                      • Auto-refreshes
• Auto-sync                    ├── rec_abc123_0.jpg         • Live maps &
                               data/                          charts
                               ├── all-records.json
                               └── all-records.csv
```

## Setup Guide

### Step 1: Create the Data Repository

1. Go to GitHub and create a new repository: `merremia-field-data`
2. Initialize it with a README
3. This repo will store all field-collected data

### Step 2: Generate a GitHub Token

1. Go to GitHub → Settings → Developer Settings → Personal Access Tokens → Fine-grained tokens
2. Create a new token with:
   - **Repository access**: Select `merremia-field-data`
   - **Permissions**: Contents → Read and Write
3. Copy the token (starts with `github_pat_...`)

### Step 3: Deploy the Field App

**Option A: GitHub Pages (recommended)**

1. Create a new repo: `merremia-field-collector`
2. Push these files to it:
   - `index.html`
   - `sw.js`
   - `manifest.json`
   - `icons/icon-192.png`
   - `icons/icon-512.png`
3. Enable GitHub Pages in repo Settings → Pages → Source: main branch
4. Your app will be live at: `https://welinrj.github.io/merremia-field-collector/`

**Option B: Any static host**

Upload the same files to Netlify, Vercel, or any static hosting.

### Step 4: Configure the App

1. Open the deployed app on your phone
2. Go to the **Settings** tab
3. Enter:
   - **Repository Owner**: `welinrj`
   - **Data Repository**: `merremia-field-data`
   - **GitHub Token**: paste your token
   - **Default Observer**: your name
4. Save settings
5. Tap "Install App" banner to add to your home screen

### Step 5: Connect to Your Dashboard

Add the connector to your existing dashboard HTML:

```html
<script src="merremia-connector.js"></script>
<script>
  const connector = initMerremiaLiveData({
    owner: 'welinrj',
    repo: 'merremia-field-data',
    refreshInterval: 300000, // 5 minutes
    onData: (data) => {
      console.log('Records:', data.totalRecords);
      console.log('Stats:', data.stats);
      console.log('GeoJSON:', data.geoJSON);
      
      // Update stats cards
      document.querySelector('.species-count').textContent = data.stats.speciesCount;
      document.querySelector('.site-count').textContent = data.stats.siteCount;
      document.querySelector('.area-affected').textContent = 
        data.stats.totalAreaHectares + ' ha';
      
      // Update Leaflet map with GeoJSON
      if (window.mapLayer) {
        window.mapLayer.clearLayers();
        L.geoJSON(data.geoJSON, {
          pointToLayer: (feature, latlng) => {
            const color = {
              high: '#c0392b',
              moderate: '#d4a017',
              low: '#4a7c4a'
            }[feature.properties.threatLevel] || '#888';
            return L.circleMarker(latlng, {
              radius: 8, fillColor: color,
              color: '#fff', weight: 2, fillOpacity: 0.8
            });
          },
          onEachFeature: (feature, layer) => {
            const p = feature.properties;
            layer.bindPopup(`
              <strong>${p.speciesLabel}</strong><br>
              ${p.island} · ${p.siteName || ''}<br>
              Count: ${p.count || '—'} · Threat: ${p.threatLevel}<br>
              <small>${new Date(p.timestamp).toLocaleDateString()}</small>
            `);
          }
        }).addTo(window.mapLayer);
      }
      
      // Update Chart.js bar chart
      if (window.islandChart) {
        const islands = Object.entries(data.byIsland);
        window.islandChart.data.labels = islands.map(([name]) => name);
        window.islandChart.data.datasets[0].data = 
          islands.map(([, d]) => d.totalCount);
        window.islandChart.update();
      }
    }
  });
</script>
```

## Team Deployment (5+ field collectors)

### Sharing Access

1. **Create a shared GitHub token** — either use a dedicated "field-bot" GitHub account, or generate a fine-grained token scoped only to the `merremia-field-data` repo
2. **Pre-configure the app** — set up one device, then share the Settings configuration with team members:
   - Owner: `welinrj`
   - Repo: `merremia-field-data`
   - Token: (the shared token)
3. **Each team member** sets their own observer name in Settings

### Field Team Workflow

1. Open the app (or tap the home screen icon)
2. GPS locks automatically
3. Select island and site name
4. Tap species observed, set count and threat level
5. Take photos with the camera button
6. Add any field notes
7. Tap **Save to Queue** — data is stored locally
8. When back in a coverage area, records auto-sync (or tap **Sync All** manually)

### Offline Behavior

The app is fully functional without internet:
- All form fields work offline
- GPS works offline (it uses device hardware)
- Camera and photos work offline
- Records save to the device's local storage
- When connectivity returns, pending records sync automatically (if auto-sync is enabled)
- The service worker caches the entire app for instant loading

## Connector API Reference

### MerremiaConnector

```javascript
const connector = new MerremiaConnector({
  owner: 'welinrj',           // GitHub username
  repo: 'merremia-field-data', // Data repository name
  branch: 'main',              // Branch (default: main)
  cacheTTL: 300000,            // Cache duration in ms (default: 5 min)
  onError: (msg, err) => {}    // Error handler
});
```

### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `fetchAll()` | `Promise<Data>` | Fetch and process all records |
| `fetchCSV()` | `Promise<string>` | Fetch CSV version of data |
| `getRecordPhotos(id)` | `Promise<Photo[]>` | List photos for a specific record |
| `filterRecords(records, filters)` | `Record[]` | Filter records by criteria |
| `startAutoRefresh(ms, callback)` | `void` | Start periodic data refresh |
| `stopAutoRefresh()` | `void` | Stop periodic refresh |
| `clearCache()` | `void` | Clear local cache |

### Data Structure

`fetchAll()` returns:

```javascript
{
  records: [...],          // All records, newest first
  stats: {
    speciesCount: 7,
    speciesList: ['M. peltata', ...],
    islandCount: 6,
    islandList: ['Efate', ...],
    siteCount: 34,
    totalObservations: 1105,
    totalAreaHectares: 2140,
    threatBreakdown: { high: 12, moderate: 8, low: 14 },
    observerCount: 5,
    recordCount: 34,
    dateRange: { earliest: '...', latest: '...' }
  },
  byIsland: {
    'Efate': { records: [...], totalCount: 200, totalArea: 50, species: [...] },
    ...
  },
  bySpecies: {
    'M. peltata': { records: [...], totalCount: 482, islands: [...], threats: {...} },
    ...
  },
  byThreat: { high: [...], moderate: [...], low: [...] },
  timeline: [
    { month: '2026-01', records: 5, count: 120, area: 30 },
    ...
  ],
  geoJSON: { type: 'FeatureCollection', features: [...] },
  heatmapData: [{ lat, lng, intensity, count }, ...],
  lastUpdated: '2026-02-08T...',
  totalRecords: 34
}
```

### Filtering

```javascript
const data = await connector.fetchAll();

// Filter by island
const efateRecords = connector.filterRecords(data.records, {
  island: 'Efate'
});

// Filter by species and threat
const highThreatPeltata = connector.filterRecords(data.records, {
  species: 'M. peltata',
  threat: 'high'
});

// Filter by date range
const janRecords = connector.filterRecords(data.records, {
  dateFrom: '2026-01-01',
  dateTo: '2026-01-31'
});

// Combine filters
const filtered = connector.filterRecords(data.records, {
  island: 'Epi',
  species: 'M. peltata',
  threat: 'high',
  dateFrom: '2026-01-01'
});
```

## Data Files

The sync process creates these files in the data repo:

| File | Format | Description |
|------|--------|-------------|
| `records/{id}.json` | JSON | Individual record with full details |
| `photos/{id}_{n}.jpg` | JPEG | Compressed field photos (max 1024px) |
| `data/all-records.json` | JSON | Master dataset (all synced records) |
| `data/all-records.csv` | CSV | Spreadsheet-friendly export |

## Troubleshooting

| Issue | Solution |
|-------|----------|
| GPS not working | Ensure location permissions are granted in browser/phone settings. Try refreshing GPS. |
| Sync fails with 404 | Make sure the data repository exists and is initialized with at least a README |
| Sync fails with 403 | Check the GitHub token has write permissions to the data repo |
| App not installing | Must be served over HTTPS (GitHub Pages handles this). Try clearing browser cache. |
| Photos not uploading | Photos are compressed to max 1024px. Very large batches may hit GitHub rate limits — sync in smaller batches. |
| Dashboard not updating | Check the connector config matches your data repo. Open browser console for errors. |
| Stale data on dashboard | Call `connector.clearCache()` to force a fresh fetch |

## Tech Stack

- **Field App**: Vanilla HTML/CSS/JS, Service Worker, IndexedDB via localStorage
- **Sync**: GitHub REST API (Contents endpoint)
- **Dashboard Connector**: Vanilla JS class, fetches from raw.githubusercontent.com
- **Hosting**: GitHub Pages (static)

## License

Built for the Merremia Vanuatu ecological monitoring project by VANUA SPATIAL SOLUTIONS.
