import { useEffect, useRef, useState, useCallback } from "react";
import { SearchIcon, MapPinIcon, XIcon } from "./icons";
import type { BarikoiAutocompleteResult, BarikoiAutocompleteResponse, LocationIQSearchResult, GeocodedLocation } from "../../types/location";

interface LocationAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onSelect: (location: GeocodedLocation) => void;
  disabled?: boolean;
  error?: string;
  label?: string;
  helperText?: string;
  placeholder?: string;
  maxLength?: number;
  id?: string;
  name?: string;
}

const DEBOUNCE_MS = 350;
const MIN_QUERY_LENGTH = 2;
const AUTOCOMPLETE_LIMIT = 5;
const BARIKOI_API_BASE = "https://barikoi.xyz/v2/api/search/autocomplete/place";
const LOCATIONIQ_API_URL = "https://api.locationiq.com/v1/search";
const BANGLADESH_VIEWBOX = "88,20.6,92.7,26.6";

/**
 * LocationAutocomplete - Search-as-you-type location input using Barikoi V2 Autocomplete API.
 *
 * Features:
 * - Debounced requests (350ms) to respect rate limits
 * - Minimum 2 characters before firing request
 * - Keyboard navigation (arrows, Enter, Escape)
 * - Click outside to close
 * - Free-text fallback: if user types but never selects, onChange fires with text only,
 *   onSelect never called → lat/long remain null
 * - Hybrid fallback: Barikoi primary → LocationIQ fallback for zero results (international queries)
 * - Follows Design System input styling conventions
 */
export function LocationAutocomplete({
  value,
  onChange,
  onSelect,
  disabled = false,
  error,
  label,
  helperText,
  placeholder,
  maxLength = 200,
  id = "location-autocomplete",
  name = "location",
}: LocationAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<BarikoiAutocompleteResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [apiError, setApiError] = useState<string | undefined>(undefined);

  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const barikoiApiKey = import.meta.env.VITE_BARIKOI_API_KEY;
  const locationIqApiKey = import.meta.env.VITE_LOCATIONIQ_API_KEY;
  const useFallback = import.meta.env.VITE_USE_BARIKOI_FALLBACK === "true";

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
        setHighlightedIndex(-1);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const closeDropdown = useCallback(() => {
    setIsOpen(false);
    setHighlightedIndex(-1);
    setSuggestions([]);
  }, []);

  // LocationIQ fallback fetch (for international queries) - declared first so fetchBarikoiSuggestions can reference it
  const fetchLocationIQFallback = useCallback(
    async (query: string) => {
      if (!locationIqApiKey) return;

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      abortControllerRef.current = new AbortController();


      try {
        const params = new URLSearchParams({
          key: locationIqApiKey,
          q: query,
          limit: String(AUTOCOMPLETE_LIMIT),
          format: "json",
          viewbox: BANGLADESH_VIEWBOX,
          bounded: "0",
        });

        const response = await fetch(`${LOCATIONIQ_API_URL}?${params}`, {
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok) {
          if (response.status === 429) {
            throw new Error("Rate limit exceeded. Please wait a moment.");
          }
          throw new Error("Search failed. Please try again.");
        }

        const data = (await response.json()) as LocationIQSearchResult[];
        setSuggestions(data as unknown as BarikoiAutocompleteResult[]); // Type cast for unified rendering
        setIsOpen(data.length > 0);
        setHighlightedIndex(-1);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          return;
        }
        // Don't overwrite Barikoi error if fallback also fails
        if (!apiError) {
          setApiError(err instanceof Error ? err.message : "Search failed. Please try again.");
        }
        setSuggestions([]);
        setIsOpen(false);
      }
    },
    [locationIqApiKey, apiError]
  );

  // Barikoi V2 primary fetch
  const fetchBarikoiSuggestions = useCallback(
    async (query: string) => {
      if (!barikoiApiKey) {
        setApiError("Location search is not configured. Please contact support.");
        return;
      }

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      abortControllerRef.current = new AbortController();

      setIsLoading(true);
      setApiError(undefined);

      try {
        const params = new URLSearchParams({
          api_key: barikoiApiKey,
          q: query,
        });

        const response = await fetch(`${BARIKOI_API_BASE}?${params}`, {
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            throw new Error("Invalid API key. Please check configuration.");
          }
          if (response.status === 429) {
            throw new Error("Too many requests. Please wait a moment.");
          }
          throw new Error("Search failed. Please try again.");
        }

        const data = (await response.json()) as BarikoiAutocompleteResponse;
        const places = data.places?.slice(0, AUTOCOMPLETE_LIMIT) ?? [];
        
        setSuggestions(places);
        setIsOpen(places.length > 0);
        setHighlightedIndex(-1);

        // HYBRID FALLBACK: If zero results and fallback enabled, try LocationIQ
        if (places.length === 0 && useFallback && locationIqApiKey) {
          await fetchLocationIQFallback(query);
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          return; // Ignore aborted requests
        }
        setApiError(err instanceof Error ? err.message : "Search failed. Please try again.");
        setSuggestions([]);
        setIsOpen(false);
      } finally {
        setIsLoading(false);
      }
    },
    [barikoiApiKey, locationIqApiKey, useFallback, fetchLocationIQFallback]
  );

  const handleInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = event.target.value;
      onChange(newValue);

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      if (newValue.trim().length < MIN_QUERY_LENGTH) {
        setSuggestions([]);
        setIsOpen(false);
        setHighlightedIndex(-1);
        return;
      }

      debounceTimerRef.current = setTimeout(() => {
        fetchBarikoiSuggestions(newValue.trim());
      }, DEBOUNCE_MS);
    },
    [onChange, fetchBarikoiSuggestions]
  );

  const handleInputFocus = useCallback(() => {
    if (value.trim().length >= MIN_QUERY_LENGTH && suggestions.length > 0) {
      setIsOpen(true);
    }
  }, [value, suggestions.length]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (!isOpen || suggestions.length === 0) {
        if (event.key === "Escape") {
          inputRef.current?.blur();
        }
        return;
      }

      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          setHighlightedIndex((prev) =>
            prev < suggestions.length - 1 ? prev + 1 : 0
          );
          break;
        case "ArrowUp":
          event.preventDefault();
          setHighlightedIndex((prev) =>
            prev > 0 ? prev - 1 : suggestions.length - 1
          );
          break;
        case "Enter":
          event.preventDefault();
          if (highlightedIndex >= 0 && highlightedIndex < suggestions.length) {
            const selected = suggestions[highlightedIndex];
            const geocoded: GeocodedLocation = {
              text: selected.address,
              latitude: parseFloat(selected.latitude),
              longitude: parseFloat(selected.longitude),
            };
            onSelect(geocoded);
            onChange(selected.address);
            closeDropdown();
            inputRef.current?.blur();
          }
          break;
        case "Escape":
          closeDropdown();
          inputRef.current?.blur();
          break;
        case "Tab":
          closeDropdown();
          break;
      }
    },
    [isOpen, suggestions, highlightedIndex, onSelect, onChange, closeDropdown]
  );

  const handleSuggestionClick = useCallback(
    (result: BarikoiAutocompleteResult) => {
      const geocoded: GeocodedLocation = {
        text: result.address,
        latitude: parseFloat(result.latitude),
        longitude: parseFloat(result.longitude),
      };
      onSelect(geocoded);
      onChange(result.address);
      closeDropdown();
      inputRef.current?.focus();
    },
    [onSelect, onChange, closeDropdown]
  );

  const handleClear = useCallback(() => {
    onChange("");
    closeDropdown();
    inputRef.current?.focus();
  }, [onChange, closeDropdown]);

  const displayError = error || apiError;

  return (
    <div className="relative">
      <label
        htmlFor={id}
        className="block text-sm font-medium text-ink-muted mb-2"
      >
        {label}
      </label>

      <div className="relative">
        <div className="relative">
          <SearchIcon
            className="absolute left-3.5 top-1/2 -translate-y-1/2 h-5 w-5 text-ink-muted pointer-events-none"
            aria-hidden="true"
          />
          <input
            ref={inputRef}
            id={id}
            name={name}
            type="text"
            autoComplete="off"
            placeholder={placeholder ?? "Where did it happen?"}
            maxLength={maxLength}
            value={value}
            disabled={disabled}
            className={[
              "w-full rounded-lg border bg-canvas px-10 py-2.5 text-base text-ink",
              "transition-colors duration-200",
              "focus:outline-none focus:ring-2 focus:ring-accent-500/60 focus:border-accent-500",
              "placeholder:text-ink-disabled",
              disabled
                ? "pointer-events-none opacity-60 bg-canvas-soft"
                : "",
              displayError
                ? "border-error/60 focus:border-error focus:ring-error/30"
                : "border-ink/10 hover:border-ink/20",
            ].join(" ")}
            onChange={handleInputChange}
            onFocus={handleInputFocus}
            onKeyDown={handleKeyDown}
            aria-autocomplete="list"
            aria-controls={`${id}-suggestions`}
            aria-expanded={isOpen && suggestions.length > 0}
            aria-activedescendant={
              highlightedIndex >= 0 ? `${id}-suggestion-${highlightedIndex}` : undefined
            }
          />
          {isLoading && (
            <div
              className="absolute right-3.5 top-1/2 -translate-y-1/2 h-5 w-5 animate-spin text-accent-500"
              aria-label="Searching locations…"
            >
              <svg
                className="h-full w-full"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M12 2a10 10 0 0 1 10 10" />
              </svg>
            </div>
          )}
          {value && !isLoading && !disabled && (
            <button
              type="button"
              onClick={handleClear}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-ink-muted hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 transition-colors duration-200"
              aria-label="Clear location"
            >
              <XIcon className="h-5 w-5" aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Dropdown suggestions */}
        {isOpen && suggestions.length > 0 && (
          <div
            ref={dropdownRef}
            id={`${id}-suggestions`}
            role="listbox"
            className="absolute z-50 mt-1.5 w-full max-h-60 overflow-auto rounded-lg border border-ink/10 bg-canvas-soft shadow-lg"
          >
            <ul role="presentation">
              {suggestions.map((suggestion, index) => (
                <li
                  key={suggestion.id}
                  id={`${id}-suggestion-${index}`}
                  role="option"
                  aria-selected={index === highlightedIndex}
                  onClick={() => handleSuggestionClick(suggestion)}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  className={[
                    "px-3.5 py-2.5 text-sm text-ink cursor-pointer",
                    "transition-colors duration-150",
                    index === highlightedIndex
                      ? "bg-accent-soft text-accent-600"
                      : "hover:bg-canvas-raised",
                  ].join(" ")}
                >
                  <div className="flex items-start gap-2.5">
                    <MapPinIcon
                      className="mt-0.5 shrink-0 h-4 w-4 text-ink-muted"
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{suggestion.address}</p>
                      <p className="truncate text-xs text-ink-muted capitalize">
                        {suggestion.pType} · {suggestion.subType}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            {/* Attribution - Barikoi (verify exact requirements during ToS review) */}
            <div className="border-t border-ink/5 px-3.5 py-2">
              <p className="text-xs text-ink-muted text-center">
                Location data by{" "}
                <a
                  href="https://barikoi.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-accent-500"
                >
                  © Barikoi
                </a>
              </p>
            </div>
          </div>
        )}

        {isOpen && suggestions.length === 0 && !isLoading && value.trim().length >= MIN_QUERY_LENGTH && (
          <div
            ref={dropdownRef}
            id={`${id}-suggestions`}
            className="absolute z-50 mt-1.5 w-full rounded-lg border border-ink/10 bg-canvas-soft shadow-lg p-3.5"
          >
            <p className="text-sm text-ink-muted text-center">
              No locations found for "{value}"
            </p>
          </div>
        )}
      </div>

      {helperText && !displayError && (
        <p className="mt-1.5 text-sm text-ink-muted">{helperText}</p>
      )}
      {displayError && (
        <p className="mt-1.5 text-sm text-error" role="alert">
          {displayError}
        </p>
      )}
    </div>
  );
}