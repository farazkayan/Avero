import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import GhostLink from "../components/ui/GhostLink";
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
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
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

  // Custom marker icon using Avero's accent color
  const customMarkerIcon = useMemo(() => {
    return L.divIcon({
      className: "avero-marker",
      html: `
        <div style="
          width: 28px;
          height: 28px;
          border-radius: 50% 50% 50% 0;
          background: #9c7d52;
          transform: rotate(-45deg);
          border: 2px solid white;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        ">
          <div style="
            width: 12px;
            height: 12px;
            border-radius: 50%;
            background: white;
            margin: 6px auto 0;
            transform: rotate(45deg);
          "></div>
        </div>
      `,
      iconSize: [28, 28],
      iconAnchor: [14, 28],
      popupAnchor: [0, -28],
    });
  }, []);

  // Tile layer configuration based on theme
  const tileConfig = useMemo(() => {
    if (theme === "dark") {
      return {
        url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: "abcd",
      };
    }
    return {
      url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
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

  return (
    <>
      <div className="mx-auto max-w-7xl px-6 py-10">
        {/* Back link */}
        <div className="mb-6">
          <GhostLink to={spaceDetailPath(spaceId)}>Back to timeline</GhostLink>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-24">
            <Spinner size={28} />
          </div>
        ) : notFound ? (
          <div className="rounded-xl border border-ink/5 bg-canvas-soft p-8 text-center">
            <p className="text-sm text-ink-muted">
              We couldn't find this Space, or you don't have access to it.
            </p>
            <div className="mt-6">
              <GhostLink to={AUTHENTICATED_HOME_PATH}>Back to Spaces</GhostLink>
            </div>
          </div>
        ) : loadError ? (
          <div className="rounded-xl border border-ink/5 bg-canvas-soft p-6 text-center">
            <p className="text-sm text-error">{loadError}</p>
          </div>
        ) : space ? (
          <>
            {/* Header */}
            <section className="mb-8">
              <h1 className="text-2xl font-bold leading-tight text-ink sm:text-3xl">
                {space.name}
              </h1>
              <p className="mt-2 text-sm text-ink-muted sm:text-base">
                {memories.length === 0
                  ? "No memories pinned yet"
                  : `${memories.length} memory${memories.length === 1 ? "" : "s"} on the map`}
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
                  to={spaceDetailPath(space.id).replace("/spaces/", "/spaces/") + "/memories/new"}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors duration-200 hover:bg-accent-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                >
                  Create your first memory
                </Link>
              </EmptyState>
            ) : (
              <div className="rounded-xl border border-ink/5 bg-canvas-soft overflow-hidden">
                <div className="relative h-[600px] w-full">
                    <MapContainer
                      center={mapCenter}
                      zoom={memories.length === 1 ? 14 : 10}
                      scrollWheelZoom={true}
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
                </div>

                {/* LocationIQ Attribution - placeholder, must verify against actual ToS */}
                <div className="px-4 py-2 text-center">
                  <p className="text-xs text-ink-muted">
                    Location data provided by{" "}
                    <a
                      href="https://locationiq.com/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-accent-500"
                    >
                      LocationIQ
                    </a>
                  </p>
                </div>
              </div>
            )}
          </>
        ) : null}
      </div>
    </>
  );
}