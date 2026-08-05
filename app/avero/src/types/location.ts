/**
 * Location-related types for LocationIQ integration and geocoding.
 */

/**
 * LocationIQ Autocomplete API response item.
 * See: https://locationiq.com/docs#autocomplete
 */
export type LocationIQAutocompleteResult = {
  place_id: string;
  licence: string;
  osm_type: string;
  osm_id: string;
  boundingbox: string[];
  lat: string;
  lon: string;
  display_name: string;
  class: string;
  type: string;
  importance: number;
};

/**
 * A geocoded location selected by the user from autocomplete results.
 * Contains both the human-readable display text and machine-readable coordinates.
 */
export type GeocodedLocation = {
  text: string;
  latitude: number;
  longitude: number;
};