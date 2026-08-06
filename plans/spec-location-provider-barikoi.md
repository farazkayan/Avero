# Migration Plan: LocationIQ → Barikoi Location Provider

## Overview
Switch location autocomplete provider from LocationIQ to Barikoi for improved Bangladesh coverage. Barikoi is a Bangladesh-specific location data provider with street-level address/POI granularity for Dhaka.

## Why This Switch
- **LocationIQ Problem**: Sparse/ambiguous Bangladesh results (e.g., "Uttara" ranking behind Indian places of same name)
- **Barikoi Advantage**: Bangladesh-focused, street-level granularity for Dhaka
- **Free Tier**: 30,000 requests/month, no credit card required
- **Storage**: Permits permanent storage of lat/lng coordinates (not temporary-display-only like Mapbox)
- **CORS**: Usable from browser
- **Features**: Autocomplete + forward geocoding

---

## 1. Verified API Details (V2 Endpoint)

### Endpoint
```
GET https://barikoi.xyz/v2/api/search/autocomplete/place
```

### Query Parameters
| Parameter | Required | Description |
|-----------|----------|-------------|
| `api_key` | Yes | Your Barikoi API key |
| `q` | Yes | Search query string |
| `bangla` | No | Include Bangla fields (OUT OF SCOPE) |
| `city` | No | Filter by city |
| `sub_area` | No | Filter by sub-area |
| `sub_district` | No | Filter by sub-district |
| `area` | No | Filter by area |
| `thana` | No | Filter by thana |
| `union` | No | Filter by union |
| `post_office` | No | Filter by post office |
| `industrial` | No | Filter by industrial area |
| `country_code` | No | Filter by country code |

### Response Structure (Live V2 Test)
```json
{
  "places": [
    {
      "id": 2968643,
      "longitude": "90.403378809019",
      "latitude": "23.868884840127",
      "address": "Uttara East, Uttara, Dhaka",
      "city": "Dhaka",
      "area": "Uttara",
      "postCode": 1230,
      "pType": "Admin",
      "subType": "Thana",
      "district": "Dhaka",
      "uCode": "DKRIH61713"
    }
  ],
  "status": 200
}
```

---

## 2. Type Definitions (`app/avero/src/types/location.ts`)

### New Types
```typescript
// Barikoi V2 autocomplete response item
export type BarikoiAutocompleteResult = {
  id: number;
  longitude: string;
  latitude: string;
  address: string;
  city: string;
  area: string;
  postCode: number;
  pType: string;
  subType: string;
  district: string;
  uCode: string;
};

// Full API response wrapper
export type BarikoiAutocompleteResponse = {
  places: BarikoiAutocompleteResult[];
  status: number;
};

// Unified search result for hybrid fallback
export type UnifiedSearchResult = 
  | { source: 'barikoi'; data: BarikoiAutocompleteResult }
  | { source: 'locationiq'; data: LocationIQSearchResult };
```

### Existing Types (Keep for Fallback)
```typescript
// LocationIQ - keep unchanged for hybrid fallback
export type LocationIQSearchResult = {
  place_id: number;
  licence: string;
  osm_type: string;
  osm_id: number;
  boundingbox: string[];
  lat: string;
  lon: string;
  display_name: string;
  class: string;
  type: string;
  importance: number;
};

// Provider-agnostic geocoded location
export type GeocodedLocation = {
  text: string;
  latitude: number;
  longitude: number;
};
```

---

## 3. Mapping Logic

### Barikoi → GeocodedLocation
| Barikoi Field | → | GeocodedLocation Field |
|---------------|---|------------------------|
| `address` | → | `text` |
| `parseFloat(latitude)` | → | `latitude` |
| `parseFloat(longitude)` | → | `longitude` |

### Dropdown Display
- **Primary**: `address` (e.g., "Uttara East, Uttara, Dhaka")
- **Secondary**: `${pType} · ${subType}` (e.g., "Admin · Thana", "Food · Restaurant")

---

## 4. Key Decisions

| Decision | Status | Rationale |
|----------|--------|-----------|
| **Endpoint** | V2 only | V1 deprecated after 31/12/2025 |
| **Bangla toggle** | OUT OF SCOPE | Not in V2 endpoint by default; separate parameter |
| **International search** | HYBRID FALLBACK | Barikoi first → LocationIQ if zero results |
| **LocationIQ code** | KEPT DISABLED | Wrapped in fallback function, controlled by feature flag |
| **Storage/Attribution** | PROCEED | No explicit clause in public docs; reasonable assumption storage permitted; flag for direct confirmation |

---

## 5. Implementation Changes (`LocationAutocomplete.tsx`)

### Constants
```typescript
const BARIKOI_API_BASE = "https://barikoi.xyz/v2/api/search/autocomplete/place";
const DEBOUNCE_MS = 350;
const MIN_QUERY_LENGTH = 2;
const AUTOCOMPLETE_LIMIT = 5;
```

### Fetch Function (Barikoi Primary)
```typescript
const fetchSuggestions = async (query: string) => {
  const apiKey = import.meta.env.VITE_BARIKOI_API_KEY;
  if (!apiKey) { setApiError("Location search not configured"); return; }

  const params = new URLSearchParams({
    api_key: apiKey,
    q: query,
  });

  const url = `${BARIKOI_API_BASE}?${params}`;
  
  const response = await fetch(url, { signal: abortControllerRef.current.signal });
  
  if (!response.ok) {
    if (response.status === 429) throw new Error("Too many requests. Please wait a moment.");
    throw new Error("Search failed. Please try again.");
  }

  const data: BarikoiAutocompleteResponse = await response.json();
  const places = data.places?.slice(0, AUTOCOMPLETE_LIMIT) ?? [];
  
  setSuggestions(places);
  setIsOpen(places.length > 0);
  
  // HYBRID FALLBACK: If zero results and fallback enabled
  if (places.length === 0 && import.meta.env.VITE_USE_BARIKOI_FALLBACK === "true") {
    await fetchLocationIQFallback(query);
  }
};
```

### Selection Handler
```typescript
const handleSelect = (place: BarikoiAutocompleteResult) => {
  const geocoded: GeocodedLocation = {
    text: place.address,
    latitude: parseFloat(place.latitude),
    longitude: parseFloat(place.longitude),
  };
  onSelect(geocoded);
  onChange(place.address);
  closeDropdown();
};
```

### Dropdown Rendering
```tsx
{suggestions.map((suggestion, index) => (
  <li key={suggestion.id} ...>
    <div className="flex items-start gap-2.5">
      <MapPinIcon ... />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{suggestion.address}</p>
        <p className="truncate text-xs text-ink-muted capitalize">
          {suggestion.pType} · {suggestion.subType}
        </p>
      </div>
    </div>
  </li>
))}
```

---

## 6. Manual Setup Required

- [ ] Add `VITE_BARIKOI_API_KEY=your_key` to `.env`
- [ ] Add `VITE_USE_BARIKOI_FALLBACK=true` to `.env`
- [ ] Confirm ToS: permanent storage of lat/lng permitted
- [ ] Confirm attribution requirements (if any)

---

## 7. Verification Checklist

| Test | Expected |
|------|----------|
| "Uttara" | 10 results, Uttara addresses with `area: "Uttara"` |
| "Dhaka University" | Accurate campus results |
| "Centrepoint" | Mall/landmark result |
| "Dhaka" | City-level results |
| "Chittagong" | City-level results |
| "Sylhet" | City-level results |
| "Eiffel Tower" | Zero Barikoi results → LocationIQ fallback |
| "Times Square" | Zero Barikoi results → LocationIQ fallback |
| Debounce 350ms | Network tab: no excessive requests |
| Free-text fallback | Saves text, `null` coordinates |
| Space Map pins | Render with Barikoi coords |
| Attribution | Displays per Barikoi ToS |
| Build + Lint | Pass |

---

## 8. Commit Strategy

**Branch**: Continue on `feature/phase-8-maps-location` (no new branch)

**Commit Message**:
```
refactor: switch location provider from LocationIQ to Barikoi for improved Bangladesh coverage

- Replace LocationIQ autocomplete with Barikoi V2 /v2/api/search/autocomplete/place
- Add BarikoiAutocompleteResult type matching live V2 API response
- Implement hybrid fallback to LocationIQ for international queries (zero Barikoi results)
- Add 429 rate-limit handling with calm error state
- Update attribution per Barikoi ToS (pending verification)
- Preserve all existing UX: 350ms debounce, keyboard nav, free-text fallback
```

---

## 9. Files to Modify

1. `app/avero/src/types/location.ts` - Add new Barikoi types
2. `app/avero/src/components/ui/LocationAutocomplete.tsx` - Rewrite fetch logic for V2 endpoint
3. `.env` - Add API key and fallback flag (manual)

---

## 10. Open Questions (Flagged)

1. **Barikoi ToS**: Explicit confirmation needed for:
   - Permanent storage of coordinates permitted?
   - Required attribution text/link?
   - Free tier limits still 30,000/month no credit card?

2. **V2 Response Stability**: Confirmed identical to V1 response structure from live test.