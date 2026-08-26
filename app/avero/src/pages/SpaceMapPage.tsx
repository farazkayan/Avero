import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import BackLink from "../components/ui/BackLink";
import Spinner from "../components/ui/Spinner";
import EmptyState from "../components/ui/EmptyState";
import { SparkleIcon } from "../components/ui/icons";
import { useTheme } from "../context/ThemeContext";
import { supabase } from "../lib/supabase";
import {
  AUTHENTICATED_HOME_PATH,
  memoryDetailPath,
  spaceDetailPath,
} from "../constants/routes";
import type { Memory } from "../types/memory";
import type { Space } from "../types/space";
import { MapContainer, TileLayer, Marker, Popup, Tooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

/**
 * Space Map view (Phase 8 — Maps & Location).
 *
 * Renders a Leaflet map with OpenStreetMap tiles (light mode) or CartoDB Dark Matter
 * tiles (dark mode). Shows a pin for each geocoded Memory in the Space.
 * Clicking a pin navigates to the Memory detail page.
 *
 * Empty state: if zero geocoded memories, shows an inspiring message.
 */
export default function SpaceMapPage() {
  const { spaceId } = useParams();
  const { theme } = useTheme();

  const [space, setSpace] = useState<Space | null>(null);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);

  const mapRef = useRef<L.Map | null>(null);

  // Custom marker icon - Stitch design: circular with center dot and pin stem
  const customMarkerIcon = useMemo(() => {
    return L.divIcon({
      className: "avero-marker",
      html: `
        <div class="marker-wrapper">
          <div class="marker-circle" style="
            width: 16px;
            height: 16px;
            border-radius: 50%;
            background: #806540;
            border: 2px solid #fff;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            display: flex;
            align-items: center;
            justify-content: center;
          ">
            <div style="
              width: 4px;
              height: 4px;
              border-radius: 50%;
              background: white;
            "></div>
          </div>
          <div class="marker-stem" style="
            width: 2px;
            height: 16px;
            background: #806540;
            margin-top: -1px;
            opacity: 0.8;
          "></div>
        </div>
      `,
      iconSize: [16, 32],
      iconAnchor: [8, 32],
      popupAnchor: [0, -32],
    });
  }, []);

  // Tile layer configuration based on theme
  // LocationIQ ToS/docs require "© LocationIQ" + "© OpenStreetMap" in map attribution
  // See: https://docs.locationiq.com/docs/examples-leaflet
  const tileConfig = useMemo(() => {
    const locationIQAttribution =
      '&copy; <a href="https://locationiq.com/?ref=maps" target="_blank" rel="noopener noreferrer">LocationIQ</a>';
    const osmAttribution =
      '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors';

    if (theme === "dark") {
      return {
        url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        attribution: `${locationIQAttribution} ${osmAttribution} &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener noreferrer">CARTO</a>`,
        subdomains: "abcd",
      };
    }
    return {
      url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      attribution: `${locationIQAttribution} ${osmAttribution}`,
      subdomains: "abc",
    };
  }, [theme]);

  // Calculate map center and bounds from memories
  const mapCenter = useMemo(() => {
    if (memories.length === 0) return [0, 0] as [number, number];
    const validMemories = memories.filter(
      (m) => m.latitude !== null && m.longitude !== null
    );
    if (validMemories.length === 0) return [0, 0] as [number, number];
    const avgLat =
      validMemories.reduce((sum, m) => sum + (m.latitude ?? 0), 0) /
      validMemories.length;
    const avgLng =
      validMemories.reduce((sum, m) => sum + (m.longitude ?? 0), 0) /
      validMemories.length;
    return [avgLat, avgLng] as [number, number];
  }, [memories]);

  const mapBounds = useMemo(() => {
    const validMemories = memories.filter(
      (m) => m.latitude !== null && m.longitude !== null
    );
    if (validMemories.length === 0) return null;
    if (validMemories.length === 1) {
      const m = validMemories[0];
      return [
        [m.latitude! - 0.01, m.longitude! - 0.01],
        [m.latitude! + 0.01, m.longitude! + 0.01],
      ] as [[number, number], [number, number]];
    }
    const lats = validMemories.map((m) => m.latitude!);
    const lngs = validMemories.map((m) => m.longitude!);
    return [
      [Math.min(...lats), Math.min(...lngs)],
      [Math.max(...lats), Math.max(...lngs)],
    ] as [[number, number], [number, number]];
  }, [memories]);

  useEffect(() => {
    if (!spaceId) return;
    let cancelled = false;

    async function fetchSpaceMapData(id: string) {
      setIsLoading(true);
      setNotFound(false);
      setLoadError(undefined);

      try {
        const [spaceRes, memoriesRes] = await Promise.all([
          supabase.from("spaces").select("*").eq("id", id).maybeSingle(),
          supabase
            .from("memories")
            .select("id, title, memory_date, latitude, longitude, memory_type")
            .eq("space_id", id)
            .not("latitude", "is", null)
            .not("longitude", "is", null)
            .order("memory_date", { ascending: false }),
        ]);

        if (cancelled) return;

        if (spaceRes.error) {
          if (spaceRes.error.code === "22P02") {
            setNotFound(true);
          } else {
            setLoadError("We couldn't load this Space. Please try again.");
          }
          return;
        }

        if (!spaceRes.data) {
          setNotFound(true);
          return;
        }

        if (memoriesRes.error) {
          setLoadError("We couldn't load memories for the map. Please try again.");
          return;
        }

        setSpace(spaceRes.data as Space);
        setMemories((memoriesRes.data ?? []) as Memory[]);
      } catch {
        if (!cancelled) {
          setLoadError("We couldn't load this Space. Please try again.");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void fetchSpaceMapData(spaceId);
    return () => {
      cancelled = true;
    };
  }, [spaceId]);

  if (!spaceId) return null;

  // Loading state
  if (isLoading) {
    return (
      <div className="flex-1 flex flex-col gap-8">
        <BackLink to={spaceDetailPath(spaceId)} className="mb-8" />
        <div className="flex items-center justify-center py-24 flex-1">
          <Spinner size={28} />
        </div>
      </div>
    );
  }

  // Not found state
  if (notFound) {
    return (
      <div className="flex-1 flex flex-col gap-8">
        <BackLink to={spaceDetailPath(spaceId)} className="mb-8" />
        <div className="rounded-xl border border-outline-variant/20 dark:border-inverse-surface bg-surface-container-low dark:bg-card-dark p-8 text-center flex-1 flex items-center justify-center">
          <p className="text-sm text-on-surface-variant dark:text-secondary-fixed-dim">
            We couldn't find this Space, or you don't have access to it.
          </p>
          <div className="mt-6">
            <BackLink to={AUTHENTICATED_HOME_PATH} />
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (loadError) {
    return (
      <div className="flex-1 flex flex-col gap-8">
        <BackLink to={spaceDetailPath(spaceId)} className="mb-8" />
        <div className="rounded-xl border border-outline-variant/20 dark:border-inverse-surface bg-surface-container-low dark:bg-card-dark p-6 text-center flex-1 flex items-center justify-center">
          <p className="text-sm text-error">{loadError}</p>
        </div>
      </div>
    );
  }

  // No space data
  if (!space) {
    return null;
  }

  // Main content with space data
  return (
    <div className="flex-1 flex flex-col gap-8">
      {/* Back link - using BackLink component which matches Stitch design */}
      <BackLink to={spaceDetailPath(spaceId)} className="mb-8" />

      {/* Header - matches Stitch: headline-lg-mobile md:headline-lg, body-md */}
      <section className="mb-8">
        <h1 className="font-headline-lg-mobile md:font-headline-lg text-headline-lg-mobile md:text-headline-lg text-on-surface dark:text-surface-container-lowest tracking-tight">
          {space.name}
        </h1>
        <p className="mt-2 font-body-md text-body-md text-on-surface-variant dark:text-secondary-fixed-dim">
          {memories.length === 0
            ? "No memories pinned yet"
            : `${memories.length} memor${memories.length === 1 ? "y" : "ies"} on the map`}
        </p>
      </section>

      {/* Map or Empty State */}
      {memories.length === 0 ? (
        <EmptyState
          icon={<SparkleIcon />}
          title="No memories pinned yet"
          titleAs="h2"
          description="Add a location next time you create a Memory to see it on the map."
        >
          <Link
            to={spaceDetailPath(space.id) + "/memories/new"}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent-warm dark:bg-primary-fixed text-canvas-warm dark:text-on-primary-fixed font-body-sm text-body-sm font-medium px-6 py-3 transition-colors hover:bg-opacity-90 hover:-translate-y-0.5 shadow-sm active:scale-95"
          >
            Create your first memory
          </Link>
        </EmptyState>
      ) : (
        <div className={[
          "relative w-full min-h-[500px] md:min-h-[600px]",
          "rounded-xl overflow-hidden",
          "bg-card-warm dark:bg-card-dark",
          "border border-outline-variant/50 dark:border-white/10",
          "shadow-[0_4px_20px_-2px_rgba(28,25,23,0.05)] dark:shadow-[0_4px_20px_-2px_rgba(0,0,0,0.2)]",
          "transition-all duration-300 isolate group",
        ].join(" ")}>
          {/* Map */}
          <div className="relative h-[500px] md:h-[600px] w-full">
            <MapContainer
              center={mapCenter}
              zoom={memories.length === 1 ? 14 : 10}
              scrollWheelZoom={true}
              zoomControl={false}
              ref={mapRef}
              whenReady={() => {
                if (mapRef.current && mapBounds) {
                  mapRef.current.fitBounds(mapBounds, { padding: [50, 50] });
                }
              }}
              className="h-full w-full"
            >
              <TileLayer
                url={tileConfig.url}
                attribution={tileConfig.attribution}
                subdomains={tileConfig.subdomains}
                maxZoom={19}
              />
              {memories.map((memory) => (
                <Marker
                  key={memory.id}
                  position={[memory.latitude!, memory.longitude!]}
                  icon={customMarkerIcon}
                >
                  <Tooltip
                    content={memory.title}
                    direction="top"
                    offset={[0, -20]}
                    opacity={0.9}
                    className="avero-tooltip"
                  />
                  <Popup
                    className="avero-popup"
                    closeButton={false}
                    autoClose={false}
                    closeOnClick={false}
                  >
                    <div className="p-2 min-w-[200px]">
                      <Link
                        to={memoryDetailPath(spaceId, memory.id)}
                        className="block"
                      >
                        <h3 className="font-semibold text-ink truncate">
                          {memory.title}
                        </h3>
                        <p className="mt-1 text-xs text-ink-muted font-mono">
                          {new Date(memory.memory_date).toLocaleDateString(
                            undefined,
                            { month: "short", day: "numeric", year: "numeric" }
                          )}
                        </p>
                        {memory.memory_type && (
                          <span className="inline-block mt-1.5 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider rounded bg-accent-soft text-accent-600">
                            {memory.memory_type.replace("_", " ")}
                          </span>
                        )}
                      </Link>
                    </div>
                  </Popup>
                </Marker>
              ))}
            </MapContainer>

            {/* Custom Zoom Controls - Stitch design */}
            <div className={[
              "absolute top-6 left-6 flex flex-col",
              "bg-surface/80 dark:bg-canvas-dark/80",
              "backdrop-blur-md rounded-full",
              "border border-outline-variant/50 dark:border-white/10",
              "shadow-sm overflow-hidden z-10",
            ].join(" ")}>
              <button
                type="button"
                aria-label="Zoom in"
                onClick={() => mapRef.current?.zoomIn()}
                className={[
                  "w-10 h-10 flex items-center justify-center",
                  "text-on-surface dark:text-surface-container-lowest",
                  "hover:bg-surface-variant/50 dark:hover:bg-white/5",
                  "transition-colors",
                ].join(" ")}
              >
                <span className="material-symbols-outlined text-[20px]">add</span>
              </button>
              <div className="h-px w-full bg-outline-variant/50 dark:bg-white/10" />
              <button
                type="button"
                aria-label="Zoom out"
                onClick={() => mapRef.current?.zoomOut()}
                className={[
                  "w-10 h-10 flex items-center justify-center",
                  "text-on-surface dark:text-surface-container-lowest",
                  "hover:bg-surface-variant/50 dark:hover:bg-white/5",
                  "transition-colors",
                ].join(" ")}
              >
                <span className="material-symbols-outlined text-[20px]">remove</span>
              </button>
            </div>
          </div>

          {/* Attribution - LocationIQ + OSM (required) + Avero Cartography (Stitch) */}
          <div className="absolute bottom-4 right-4 flex flex-col items-end gap-2 z-10">
            {/* Avero Cartography attribution - Stitch style */}
            <div className={[
              "bg-surface/60 dark:bg-canvas-dark/60 backdrop-blur-sm",
              "px-2 py-1 rounded",
              "border border-outline-variant/50 dark:border-white/10",
            ].join(" ")}>
              <span className="font-mono-label text-[10px] uppercase tracking-wider text-on-surface-variant/80 dark:text-secondary-fixed-dim">
                © Avero Cartography
              </span>
            </div>
            {/* LocationIQ + OSM attribution - Required by ToS */}
            <div className={[
              "bg-surface/60 dark:bg-canvas-dark/60 backdrop-blur-sm",
              "px-3 py-1.5 rounded",
              "border border-outline-variant/50 dark:border-white/10",
            ].join(" ")}>
              <p className="text-xs text-on-surface-variant dark:text-secondary-fixed-dim">
                Location data by{" "}
                <a
                  href="https://locationiq.com/?ref=maps"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-accent-warm dark:hover:text-primary-fixed-dim"
                >
                  © LocationIQ
                </a>
                {" | "}
                <a
                  href="https://www.openstreetmap.org/copyright"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-accent-warm dark:hover:text-primary-fixed-dim"
                >
                  © OpenStreetMap
                </a>
                {theme === "dark" && (
                  <>
                    {" | "}
                    <a
                      href="https://carto.com/attributions"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-accent-warm dark:hover:text-primary-fixed-dim"
                    >
                      © CARTO
                    </a>
                  </>
                )}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}