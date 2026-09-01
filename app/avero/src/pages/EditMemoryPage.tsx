import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import TextField from "../components/ui/TextField";
import TagInput from "../components/ui/TagInput";
import PrimaryButton from "../components/ui/PrimaryButton";
import GhostLink from "../components/ui/GhostLink";
import Spinner from "../components/ui/Spinner";
import { LocationAutocomplete } from "../components/ui/LocationAutocomplete";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";
import {
  AUTHENTICATED_HOME_PATH,
  memoryDetailPath,
  spaceDetailPath,
} from "../constants/routes";
import type { Memory, MemoryType } from "../types/memory";
import type { SpaceMember } from "../types/space";
import { fetchMemoryTags, syncMemoryTags } from "../lib/tags";

/**
 * Maximum length for a Memory title (mirrors CreateMemoryPage).
 *
 * The `memories.title` column is `text NOT NULL` with no CHECK constraint
 * (backend-implementation §5.5). 100 characters mirrors the Space name ceiling
 * — long enough for any reasonable title, short enough to keep the timeline tidy.
 */
const MAX_TITLE_LENGTH = 100;

/**
 * Maximum length for a Memory description (mirrors CreateMemoryPage).
 *
 * Also unconstrained at the database level. 1000 characters is longer than the
 * Space description ceiling (500) because a Memory holds a real story — enough
 * room for a few paragraphs without becoming an essay.
 */
const MAX_DESCRIPTION_LENGTH = 1000;

/**
 * Maximum length for the free-text location field (mirrors CreateMemoryPage).
 *
 * The `memories.location` column is `text` (database §6 — "string for MVP, not
 * geocoded"). 200 characters is ample for a place name or short address.
 */
const MAX_LOCATION_LENGTH = 200;

/**
 * The set of Memory types the user can choose (feature-specs §2).
 *
 * Stored as lowercase snake_case in the database; the UI maps each value to a
 * friendly display label via {@link MEMORY_TYPE_LABELS}. The order here is the
 * order shown in the dropdown. Mirrors CreateMemoryPage so the two screens
 * always agree on the available types.
 */
const MEMORY_TYPES: MemoryType[] = [
  "trip",
  "milestone",
  "hangout",
  "celebration",
  "adventure",
  "side_quest",
];

/**
 * Friendly display labels for each {@link MemoryType}, keyed by the stored
 * snake_case value. Mirrors the labels used on the create and detail screens so
 * every Memories screen always agrees on how a type is shown.
 */
const MEMORY_TYPE_LABELS: Record<MemoryType, string> = {
  trip: "Trip",
  milestone: "Milestone",
  hangout: "Hangout",
  celebration: "Celebration",
  adventure: "Adventure",
  side_quest: "Side Quest",
};

/**
 * Edit Memory screen (feature-specs §2).
 *
 * Route: `/spaces/:spaceId/memories/:memoryId/edit`
 *
 * Pre-fills the form with the Memory's current values and updates the
 * `memories` row on submit. This is a text-fields-only edit — media is managed
 * separately (matching how Memory Detail was split into two tasks), so the
 * Photos & videos section from CreateMemoryPage is intentionally absent here.
 *
 * Access control mirrors the existing Space role-based permission pattern used
 * by Space settings/delete (spaces-design §6.3): only the Memory's creator OR
 * the Space owner may edit. This matches the `memories_update` RLS policy
 * (`is_space_owner(space_id) OR created_by = auth.uid()`). The page fetches the
 * Memory and the Space's members on mount; if the current user is neither the
 * creator nor an owner, it redirects away the same way other unauthorized-access
 * cases are handled — to the Memory detail page (a calm, in-place destination
 * rather than a jarring dashboard bounce), which itself renders a calm
 * "not found or no access" state for non-members via RLS.
 *
 * Data-fetching and the not-found / load-error states mirror
 * {@link MemoryDetailPage}: `.is("deleted_at", null).maybeSingle()`, a `22P02`
 * (invalid UUID) treated as "not found", and a calm "try again" message for real
 * failures. RLS returning no rows resolves to the same calm "not found or no
 * access" state rather than a raw error (spaces-design §8).
 *
 * Validation, error handling, and form state mirror CreateMemoryPage: per-field
 * errors validated on blur and on submit, a calm form-level error for Supabase
 * failures, and input is never lost on error (state is preserved across the
 * failed submission).
 */
export default function EditMemoryPage() {
  const { spaceId, memoryId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [memory, setMemory] = useState<Memory | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);

  // Form state — populated from the fetched Memory once loading completes.
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [memoryType, setMemoryType] = useState<MemoryType | "">("");
  const [memoryDate, setMemoryDate] = useState<string>("");
  const [location, setLocation] = useState("");
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);

  // Tags state (feature-specs §6). Pre-filled from the Memory's existing tags
  // once the Memory loads, then synced via the sync_memory_tags RPC on save.
  const [tags, setTags] = useState<string[]>([]);

  const [titleError, setTitleError] = useState<string | undefined>(undefined);
  const [descriptionError, setDescriptionError] = useState<
    string | undefined
  >(undefined);
  const [memoryTypeError, setMemoryTypeError] = useState<string | undefined>(
    undefined
  );
  const [memoryDateError, setMemoryDateError] = useState<string | undefined>(
    undefined
  );
  const [locationError, setLocationError] = useState<string | undefined>(
    undefined
  );
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!memoryId) {
      // React Router guarantees :memoryId is present when this page mounts
      // (the route only matches /spaces/:spaceId/memories/:memoryId/edit).
      // This guard only satisfies the type system. It must not call setState
      // synchronously (react-hooks/set-state-in-effect), and since the branch
      // is unreachable in practice, leaving the initial loading state is fine.
      return;
    }

    let cancelled = false;

    async function fetchMemoryForEdit(id: string) {
      setIsLoading(true);
      setNotFound(false);
      setLoadError(undefined);

      try {
        const { data, error } = await supabase
          .from("memories")
          .select("*")
          .eq("id", id)
          // Respect soft-delete (database §6). The memories_select RLS policy
          // already excludes rows with a non-null deleted_at, but filtering
          // here makes the intent explicit at the query site.
          .is("deleted_at", null)
          .maybeSingle();

        if (cancelled) {
          return;
        }

        // A PostgREST error here is either a malformed id (treated as "not
        // found") or a real failure (treated as "try again"). RLS returning no
        // rows resolves to null data with no error, which is the normal "not a
        // member / doesn't exist" path.
        if (error) {
          if (error.code === "22P02") {
            // invalid_text_representation — not a valid UUID
            setNotFound(true);
          } else {
            setLoadError("We couldn't load this Memory. Please try again.");
          }
          return;
        }

        if (!data) {
          // RLS returned no rows — the Memory doesn't exist, was soft-deleted,
          // or the user isn't a member of its Space. All resolve to the same
          // calm state.
          setNotFound(true);
          return;
        }

        const loaded = data as Memory;
        setMemory(loaded);
        // Pre-fill the form fields from the loaded Memory. Done here inside
        // the async callback (not a separate effect) to avoid synchronous
        // setState in an effect body (react-hooks/set-state-in-effect).
        setTitle(loaded.title);
        setDescription(loaded.description ?? "");
        setMemoryType(
          loaded.memory_type && isKnownMemoryType(loaded.memory_type)
            ? loaded.memory_type
            : ""
        );
        setMemoryDate(loaded.memory_date ?? "");
        setLocation(loaded.location ?? "");
        setLatitude(loaded.latitude ?? null);
        setLongitude(loaded.longitude ?? null);

        // Pre-fill the tags from the Memory's existing tag links. A fetch
        // failure here is non-fatal — the edit form still works, just without
        // pre-filled tags (the user can add them fresh).
        try {
          const existingTags = await fetchMemoryTags(id);
          if (!cancelled) {
            setTags(existingTags.map((t) => t.name));
          }
        } catch {
          // Non-fatal: leave tags empty; the user can re-add them.
        }
      } catch {
        if (cancelled) {
          return;
        }
        setLoadError("We couldn't load this Memory. Please try again.");
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void fetchMemoryForEdit(memoryId);

    return () => {
      cancelled = true;
    };
  }, [memoryId]);

  // --- Authorization (creator OR Space owner) ---
  //
  // The `memories_update` RLS policy is `is_space_owner(space_id) OR
  // created_by = auth.uid()`. We mirror that gate client-side so an
  // unauthorized user never sees the edit form: we fetch the Space's members
  // and check whether the current user is the Memory's creator or an owner of
  // the Space. If not, redirect to the Memory detail page — the same calm,
  // in-place destination used elsewhere for unauthorized access, which itself
  // renders a calm "not found or no access" state for non-members via RLS.
  const [members, setMembers] = useState<SpaceMember[]>([]);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    if (!memory || !user || !spaceId) {
      return;
    }

    let cancelled = false;

    async function checkAuthorization() {
      // Fast path: if the current user is the creator, no member lookup is
      // needed — `created_by = auth.uid()` is sufficient under the RLS policy.
      if (memory!.created_by === user!.id) {
        if (!cancelled) {
          setAuthChecked(true);
        }
        return;
      }

      // Otherwise the user must be an owner of the Space. Fetch the Space's
      // members (RLS restricts this to members; a non-member receives an empty
      // list, which correctly resolves to "not authorized"). We only need
      // (user_id, role) to determine if the current user is an owner — avoid
      // fetching every column of every member (M-21).
      const { data, error } = await supabase
        .from("space_members")
        .select("user_id, role")
        .eq("space_id", spaceId!);

      if (cancelled) {
        return;
      }

      if (error) {
        // A failure here is unexpected once the Memory loaded (RLS passed for
        // the Memory, so membership is established). Treat it as "not
        // authorized" and redirect — safer than showing an edit form the user
        // may not be allowed to submit.
        setAuthChecked(true);
        return;
      }

      setMembers((data ?? []) as SpaceMember[]);
      setAuthChecked(true);
    }

    void checkAuthorization();

    return () => {
      cancelled = true;
    };
  }, [memory, user, spaceId]);

  const isCreator = user !== null && memory !== null && memory.created_by === user.id;
  const isOwner =
    user !== null &&
    members.some((m) => m.user_id === user.id && m.role === "owner");
  const canEdit = isCreator || isOwner;

  // Redirect unauthorized users away once the auth check has settled. Done in
  // an effect (not during render) to avoid calling navigate during render.
  useEffect(() => {
    if (!authChecked || !memory || !spaceId || !memoryId) {
      return;
    }
    if (!canEdit) {
      navigate(memoryDetailPath(spaceId, memoryId), { replace: true });
    }
  }, [authChecked, canEdit, memory, spaceId, memoryId, navigate]);

  // --- Validation (mirrors CreateMemoryPage) ---

  function validateTitle(value: string): string | undefined {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return "Enter a title for this Memory.";
    }
    if (trimmed.length > MAX_TITLE_LENGTH) {
      return `Keep the title under ${MAX_TITLE_LENGTH} characters.`;
    }
    return undefined;
  }

  function validateDescription(value: string): string | undefined {
    if (value.length > MAX_DESCRIPTION_LENGTH) {
      return `Keep the description under ${MAX_DESCRIPTION_LENGTH} characters.`;
    }
    return undefined;
  }

  function validateMemoryType(value: MemoryType | ""): string | undefined {
    if (value === "") {
      return "Choose a type for this Memory.";
    }
    return undefined;
  }

  function validateMemoryDate(value: string): string | undefined {
    if (value.trim().length === 0) {
      return "Pick the date this happened.";
    }
    // <input type="date"> returns "" when empty and "YYYY-MM-DD" when set.
    // A non-empty value that fails to parse as a valid calendar date is
    // treated as missing — the browser's native picker normally prevents this,
    // but a manual paste could produce it.
    if (Number.isNaN(Date.parse(value))) {
      return "Use a valid calendar date.";
    }
    return undefined;
  }

  function validateLocation(value: string): string | undefined {
    if (value.length > MAX_LOCATION_LENGTH) {
      return `Keep the location under ${MAX_LOCATION_LENGTH} characters.`;
    }
    return undefined;
  }

  function handleTitleBlur() {
    setTitleError(validateTitle(title));
  }

  function handleDescriptionBlur() {
    setDescriptionError(validateDescription(description));
  }

  function handleMemoryTypeBlur() {
    setMemoryTypeError(validateMemoryType(memoryType));
  }

  function handleMemoryDateBlur() {
    setMemoryDateError(validateMemoryDate(memoryDate));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // Prevent duplicate submissions while a request is in flight.
    if (isSubmitting) {
      return;
    }

    const nextTitleError = validateTitle(title);
    const nextDescriptionError = validateDescription(description);
    const nextMemoryTypeError = validateMemoryType(memoryType);
    const nextMemoryDateError = validateMemoryDate(memoryDate);
    const nextLocationError = validateLocation(location);
    setTitleError(nextTitleError);
    setDescriptionError(nextDescriptionError);
    setMemoryTypeError(nextMemoryTypeError);
    setMemoryDateError(nextMemoryDateError);
    setLocationError(nextLocationError);

    if (
      nextTitleError ||
      nextDescriptionError ||
      nextMemoryTypeError ||
      nextMemoryDateError ||
      nextLocationError
    ) {
      return;
    }

    // ProtectedRoute guarantees a user and the route params before this page
    // mounts; these guards only satisfy the type system for the update below.
    if (!memoryId || !spaceId) {
      return;
    }

    setFormError(undefined);
    setIsSubmitting(true);

    try {
      const { error } = await supabase
        .from("memories")
        .update({
          title: title.trim(),
          description: description.trim() || null,
          memory_type: memoryType,
          memory_date: memoryDate,
          location: location.trim() || null,
          latitude,
          longitude,
        })
        .eq("id", memoryId);

      if (error) {
        setFormError(mapEditMemoryError(error));
        return;
      }

      // Sync the Memory's tag set (feature-specs §6). The RPC atomically
      // upserts tags (reusing existing Space tags) and replaces the
      // memory_tags links. If this fails, the core Memory update already
      // committed — we surface a calm form error and stay on the page so the
      // user can retry, rather than navigating away with stale tags.
      try {
        await syncMemoryTags(memoryId, spaceId, tags);
      } catch {
        setFormError(
          "Memory updated, but tags couldn't be saved. Please try again.",
        );
        return;
      }

      // Success — redirect back to the Memory Detail page showing the
      // updated content. `replace` so the back button doesn't return to the
      // edit form with stale values.
      navigate(memoryDetailPath(spaceId, memoryId), { replace: true });
    } catch {
      // Network failures and other unexpected thrown errors resolve to the
      // same calm, honest message (auth-design §7 voice). Input is preserved.
      setFormError("Something went wrong on our end. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <div className="mb-6">
        {spaceId && memoryId ? (
          <GhostLink to={memoryDetailPath(spaceId, memoryId)}>
            Back to Memory
          </GhostLink>
        ) : spaceId ? (
          <GhostLink to={spaceDetailPath(spaceId)}>Back to Space</GhostLink>
        ) : (
          <GhostLink to={AUTHENTICATED_HOME_PATH}>Back to Spaces</GhostLink>
        )}
      </div>

      {isLoading ? (
        <div
          className="flex items-center justify-center py-24 text-accent-400"
          role="status"
          aria-live="polite"
        >
          <Spinner size={28} />
        </div>
      ) : notFound ? (
        <div className="py-16 text-center">
          <h1 className="text-2xl font-bold leading-tight text-ink sm:text-3xl">
            Memory not found
          </h1>
          <p className="mx-auto mt-3 max-w-sm text-sm text-ink-muted sm:text-base">
            This Memory may have been deleted, or you may not have access to it.
          </p>
          <div className="mt-8">
            {spaceId ? (
              <GhostLink to={spaceDetailPath(spaceId)}>Back to Space</GhostLink>
            ) : (
              <GhostLink to={AUTHENTICATED_HOME_PATH}>Back to Spaces</GhostLink>
            )}
          </div>
        </div>
      ) : loadError ? (
        <div className="rounded-xl border border-ink/5 bg-canvas-soft p-6 text-center">
          <p className="text-sm text-error">{loadError}</p>
        </div>
      ) : memory ? (
        <div className="mx-auto w-full max-w-[420px]">
          <div className="mb-8">
            <h1 className="text-2xl font-bold leading-tight text-ink sm:text-3xl">
              Edit Memory
            </h1>
            <p className="mt-2 text-sm text-ink-muted sm:text-base">
              Update the details of this Memory.
            </p>
          </div>

          <form
            className="space-y-5"
            onSubmit={handleSubmit}
            noValidate
            aria-describedby={formError ? "edit-memory-form-error" : undefined}
          >
            <TextField
              id="title"
              name="title"
              type="text"
              label="Title"
              autoComplete="off"
              placeholder="Our weekend in the mountains"
              maxLength={MAX_TITLE_LENGTH}
              value={title}
              disabled={isSubmitting}
              error={titleError}
              onChange={(event) => setTitle(event.target.value)}
              onBlur={handleTitleBlur}
            />

            {/* Description — multi-line textarea (M-6). Styled to match the
                v2.0 auth-input so the rest of the form looks identical. */}
            <div>
              <label htmlFor="description" className="sr-only">
                Description
              </label>
              <textarea
                id="description"
                name="description"
                placeholder="What happened?"
                maxLength={MAX_DESCRIPTION_LENGTH}
                value={description}
                disabled={isSubmitting}
                aria-describedby={descriptionError ? "description-describe" : undefined}
                aria-invalid={Boolean(descriptionError) || undefined}
                onChange={(event) => setDescription(event.target.value)}
                onBlur={handleDescriptionBlur}
                rows={4}
                className="auth-input w-full rounded-md py-3 px-4 text-base transition-all resize-y min-h-[96px]"
              />
              {descriptionError && (
                <p id="description-describe" className="auth-helper mt-2 text-sm auth-helper-error">
                  {descriptionError}
                </p>
              )}
            </div>

            {/* Memory type — a native <select> styled to match TextField. */}
            <div>
              <label
                htmlFor="memory-type"
                className="block text-sm font-medium text-ink-muted mb-2"
              >
                Type
              </label>
              <select
                id="memory-type"
                name="memory_type"
                value={memoryType}
                disabled={isSubmitting}
                aria-invalid={Boolean(memoryTypeError) || undefined}
                aria-describedby={
                  memoryTypeError ? "memory-type-describe" : undefined
                }
                onChange={(event) =>
                  setMemoryType(event.target.value as MemoryType | "")
                }
                onBlur={handleMemoryTypeBlur}
                className={[
                  "w-full rounded-lg border bg-canvas px-3.5 py-2.5 text-base text-ink",
                  "transition-colors duration-200",
                  "focus:outline-none focus:ring-2 focus:ring-accent-500/60 focus:border-accent-500",
                  memoryTypeError
                    ? "border-error/60 focus:border-error focus:ring-error/30"
                    : "border-ink/10 hover:border-ink/20",
                ].join(" ")}
              >
                <option value="" disabled>
                  Select a type
                </option>
                {MEMORY_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {MEMORY_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
              {memoryTypeError && (
                <p
                  id="memory-type-describe"
                  className="mt-1.5 text-sm text-error"
                >
                  {memoryTypeError}
                </p>
              )}
            </div>

            <TextField
              id="memory-date"
              name="memory_date"
              type="date"
              label="Date"
              value={memoryDate}
              disabled={isSubmitting}
              error={memoryDateError}
              onChange={(event) => setMemoryDate(event.target.value)}
              onBlur={handleMemoryDateBlur}
            />

            <LocationAutocomplete
              id="location"
              name="location"
              label="Location"
              helperText="Optional"
              placeholder="Where did it happen?"
              maxLength={MAX_LOCATION_LENGTH}
              value={location}
              onChange={setLocation}
              onSelect={({ text, latitude: lat, longitude: lon }) => {
                setLocation(text);
                setLatitude(lat);
                setLongitude(lon);
              }}
              disabled={isSubmitting}
              error={locationError}
            />

            {/* Tags — simple multi-tag input (feature-specs §6). Pre-filled
                from the Memory's existing tags and synced on save via the
                sync_memory_tags RPC. */}
            <TagInput
              id="tags"
              label="Tags"
              helperText="Optional"
              value={tags}
              onChange={setTags}
              disabled={isSubmitting}
            />

            {formError && (
              <p
                id="edit-memory-form-error"
                role="alert"
                className="text-sm text-error"
              >
                {formError}
              </p>
            )}

            <PrimaryButton type="submit" loading={isSubmitting}>
              {isSubmitting ? "Saving…" : "Save changes"}
            </PrimaryButton>
          </form>
        </div>
      ) : null}
    </>
  );
}

/**
 * Type guard for the known {@link MemoryType} union.
 *
 * The `memories.memory_type` column is `text` (database §6), so a value stored
 * before the UI's type set was finalized — or a future type added to the
 * database before the UI is updated — would not be assignable to the union.
 * This guard lets the form pre-fill only known types and fall back to the
 * "Select a type" placeholder otherwise, rather than crashing on an unknown
 * value.
 */
function isKnownMemoryType(value: string): value is MemoryType {
  return (MEMORY_TYPES as readonly string[]).includes(value);
}

/**
 * Maps a Supabase update error to a calm, human-friendly message
 * (auth-design §7 voice). Raw Supabase error messages are never shown to
 * users. The `memories_update` RLS policy failure and any database error both
 * resolve to the same honest fallback — the user cannot act on the specifics.
 */
function mapEditMemoryError(error: {
  code?: string;
  status?: number;
}): string {
  switch (error.code) {
    case "42501": // insufficient_privilege — RLS denied the update
      return "You can't edit this Memory right now. Please refresh and try again.";
    case "23502": // not_null_violation
      return "Some required information is missing. Please check your input.";
    default:
      // Network problems, unexpected failures, and any unmapped codes all
      // resolve to the same calm, honest message (auth-design §7).
      return "Something went wrong on our end. Please try again.";
  }
}
