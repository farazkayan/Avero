/**
 * Location-related types for Barikoi and LocationIQ integration and geocoding.
 */

/**
 * Barikoi V2 Autocomplete API response item.
 * See: https://barikoi.xyz/v2/api/search/autocomplete/place
 * Live-tested response structure (2026-08-06).
 */
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

/**
 * Barikoi V2 Autocomplete API full response wrapper.
 */
export type BarikoiAutocompleteResponse = {
  places: BarikoiAutocompleteResult[];
  status: number;
};

/**
 * LocationIQ Search/Geocoding API response item.
 * See: https://locationiq.com/docs#search
 * Kept for hybrid fallback when Barikoi returns zero results.
 */
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

/**
 * Unified search result for hybrid fallback (Barikoi → LocationIQ).
 */
export type UnifiedSearchResult =
  | { source: 'barikoi'; data: BarikoiAutocompleteResult }
  | { source: 'locationiq'; data: LocationIQSearchResult };

/**
 * A geocoded location selected by the user from autocomplete results.
 * Contains both the human-readable display text and machine-readable coordinates.
 * Provider-agnostic — coordinates don't "belong" to whichever API produced them.
 */
export type GeocodedLocation = {
  text: string;
  latitude: number;
  longitude: number;
};