import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import AppShell from "../components/AppShell";
import TextField from "../components/ui/TextField";
import TagInput from "../components/ui/TagInput";
import PrimaryButton from "../components/ui/PrimaryButton";
import GhostLink from "../components/ui/GhostLink";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";
import { spaceDetailPath } from "../constants/routes";
import type { MemoryType } from "../types/memory";
import {
  classifyMediaType,
  uploadMediaItem,
  MAX_VIDEO_SIZE_BYTES,
  STATUS_LABELS,
  type SelectedMediaFile,
} from "../lib/media";
import { syncMemoryTags } from "../lib/tags";

/**
 * Maximum length for a Memory title.
 *
 * The `memories.title` column is `text NOT NULL` with no CHECK constraint
 * (backend-implementation §5.5). 100 characters mirrors the Space name ceiling
 * — long enough for any reasonable title, short enough to keep the timeline tidy.
 */
const MAX_TITLE_LENGTH = 100;

/**
 * Maximum length for a Memory description.
 *
 * Also unconstrained at the database level. 1000 characters is longer than the
 * Space description ceiling (500) because a Memory holds a real story — enough
 * room for a few paragraphs without becoming an essay.
 */
const MAX_DESCRIPTION_LENGTH = 1000;

/**
 * Maximum length for the free-text location field.
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
 * order shown in the dropdown.
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
 * snake_case value. Keeping the mapping in one place ensures the create and
 * detail screens always agree on how a type is shown.
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
 * Returns today's date as a `YYYY-MM-DD` string, suitable for an
 * `<input type="date">` value. Uses the user's local date (not UTC) so the
 * default matches what they see on their calendar.
 */
function todayLocalDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Create Memory screen (feature-specs §2, §3; roadmap Phase 3 Step 1).
 *
 * A centered form inside `AppShell` that inserts a new row into the `memories`
 * table. The `created_by` field is set explicitly to the current user's id —
 * the `memories_insert` RLS policy enforces `created_by = auth.uid()`, and
 * there is no database default or trigger that sets it, so the client must
 * provide it (same pattern as CreateSpacePage).
 *
 * Media selection is supported in this pass: the user can pick multiple image
 * and video files, each is validated client-side (type and, for videos, size),
 * and the resulting list is shown inline with per-file status. Files that fail
 * validation are marked `failed` and can be removed. The actual upload
 * (compression, presigned URL, PUT, media-row insert) is a separate next step
 * and is intentionally not implemented here.
 *
 * Validation, error handling, and form state mirror CreateSpacePage: per-field
 * errors validated on blur and on submit, a calm form-level error for Supabase
 * failures, and input is never lost on error (state is preserved across the
 * failed submission).
 */
export default function CreateMemoryPage() {
  const { spaceId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [memoryType, setMemoryType] = useState<MemoryType | "">("");
  const [memoryDate, setMemoryDate] = useState<string>(todayLocalDate());
  const [location, setLocation] = useState("");

  // --- Tags state (feature-specs §6) ---
  // A simple list of tag names the user has added. Synced to the
  // memory_tags relation via the sync_memory_tags RPC after the Memory is
  // created. Tags are non-critical metadata: a sync failure does not block
  // the success state, but surfaces a calm inline notice (see tagWarning).
  const [tags, setTags] = useState<string[]>([]);
  const [tagWarning, setTagWarning] = useState<string | undefined>(undefined);

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
  const [memoryId, setMemoryId] = useState<string | null>(null);

  // --- Media selection state ---

  /**
   * The list of selected files with their validation status. Files are added by
   * `handleFileSelect` and never reordered — the list order matches the order
   * the user selected them.
   */
  const [selectedFiles, setSelectedFiles] = useState<SelectedMediaFile[]>([]);

  const memoryCreated = memoryId !== null;
  const allUploadsDone = selectedFiles.length === 0 || selectedFiles.every((f) => f.status === "done");

  // --- Validation (unchanged from the original form) ---

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

  function handleLocationBlur() {
    setLocationError(validateLocation(location));
  }

  // --- Media handlers ---

  /**
   * Validates and adds selected files to the list. Each file is classified as
   * an image or video by its MIME type, with the file extension used as a
   * fallback when the browser does not report a reliable MIME type:
   *
   * - Files that are neither image nor video are added with `mediaType: null`
   *   and a `failed` status so the user sees what was rejected and why.
   * - Videos larger than {@link MAX_VIDEO_SIZE_BYTES} are added with a `failed`
   *   status.
   * - All other files are added as `pending`, ready for the upload step.
   *
   * The input value is reset afterwards so selecting the same file again still
   * fires `onChange`.
   */
  function handleFileSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const fileList = event.target.files;
    if (!fileList || fileList.length === 0) return;

    const newFiles: SelectedMediaFile[] = [];
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      const mediaType = classifyMediaType(file);

      if (mediaType === null) {
        newFiles.push({
          id: crypto.randomUUID(),
          file,
          name: file.name,
          size: file.size,
          mediaType: null,
          status: "failed",
          error: "Not an image or video file.",
        });
        continue;
      }

      if (mediaType === "video" && file.size > MAX_VIDEO_SIZE_BYTES) {
        newFiles.push({
          id: crypto.randomUUID(),
          file,
          name: file.name,
          size: file.size,
          mediaType: "video",
          status: "failed",
          error: "Videos must be under 100MB.",
        });
        continue;
      }

      newFiles.push({
        id: crypto.randomUUID(),
        file,
        name: file.name,
        size: file.size,
        mediaType,
        status: "pending",
      });
    }

    setSelectedFiles((prev) => [...prev, ...newFiles]);
    // Clear the input so selecting the same file again still fires onChange.
    event.target.value = "";
  }

  /**
   * Removes a file from the selection list. In this pass only `failed` files
   * expose a Remove control, but the handler itself is generic so the upcoming
   * upload step can reuse it for other states.
   */
  function handleRemoveFile(id: string) {
    setSelectedFiles((prev) => prev.filter((file) => file.id !== id));
  }

  function updateFileStatus(id: string, status: SelectedMediaFile["status"], error?: string) {
    setSelectedFiles((prev) =>
      prev.map((f) => (f.id === id ? { ...f, status, error } : f))
    );
  }

  async function uploadOneFile(item: SelectedMediaFile, targetSpaceId: string, targetMemoryId: string): Promise<void> {
    if (item.mediaType === null) return;

    const result = await uploadMediaItem({
      file: item.file,
      mediaType: item.mediaType,
      spaceId: targetSpaceId,
      memoryId: targetMemoryId,
      onStatus: (status) => updateFileStatus(item.id, status),
    });

    if (result.ok) {
      updateFileStatus(item.id, "done");
    } else {
      updateFileStatus(item.id, "failed", result.error);
    }
  }

  async function handleRetryFile(id: string) {
    if (!memoryId || !spaceId) return;
    const file = selectedFiles.find((f) => f.id === id);
    if (!file || file.mediaType === null) return;
    updateFileStatus(id, "pending");
    await uploadOneFile(file, spaceId, memoryId);
  }

  function handleContinueToSpace() {
    if (!spaceId) return;
    navigate(`${spaceDetailPath(spaceId)}?memory_created=1`, { replace: true });
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

    // ProtectedRoute guarantees a user and the route param before this page
    // mounts; these guards only satisfy the type system for the insert below.
    if (!user || !spaceId) {
      return;
    }

    setFormError(undefined);
    setTagWarning(undefined);
    setIsSubmitting(true);

    try {
      const { data, error } = await supabase
        .from("memories")
        .insert({
          space_id: spaceId,
          // Required by the memories_insert RLS policy (created_by = auth.uid()).
          created_by: user.id,
          title: title.trim(),
          description: description.trim() || null,
          memory_type: memoryType,
          memory_date: memoryDate,
          location: location.trim() || null,
        })
        .select()
        .single();

      if (error) {
        setFormError(mapCreateMemoryError(error));
        return;
      }

      const newMemoryId = (data as { id: string }).id;
      setMemoryId(newMemoryId);

      // Sync tags (feature-specs §6). Tags are non-critical metadata: the
      // Memory is already saved, so a tag-sync failure does not block the
      // success state. Instead it surfaces a calm inline notice so the user
      // knows their tags didn't make it and can retry via Edit.
      if (tags.length > 0) {
        try {
          await syncMemoryTags(newMemoryId, spaceId, tags);
        } catch {
          setTagWarning(
            "Memory saved, but tags couldn't be added — edit the Memory to try again.",
          );
        }
      }

      const pendingFiles = selectedFiles.filter((f) => f.status === "pending");
      for (const file of pendingFiles) {
        await uploadOneFile(file, spaceId, newMemoryId);
      }
    } catch {
      // Network failures and other unexpected thrown errors resolve to the
      // same calm, honest message (auth-design §7 voice). Input is preserved.
      setFormError("Something went wrong on our end. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-[420px]">
        <div className="mb-8">
          <h1 className="text-2xl font-bold leading-tight text-ink sm:text-3xl">
            Create a Memory
          </h1>
          <p className="mt-2 text-sm text-ink-muted sm:text-base">
            Capture a moment you shared in this Space.
          </p>
        </div>

        <form
          className="space-y-5"
          onSubmit={handleSubmit}
          noValidate
          aria-describedby={formError ? "create-memory-form-error" : undefined}
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
            disabled={isSubmitting || memoryCreated}
            error={titleError}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={handleTitleBlur}
          />

          <TextField
            id="description"
            name="description"
            type="text"
            label="Description"
            helperText="Optional"
            placeholder="What happened?"
            maxLength={MAX_DESCRIPTION_LENGTH}
            value={description}
            disabled={isSubmitting || memoryCreated}
            error={descriptionError}
            onChange={(event) => setDescription(event.target.value)}
            onBlur={handleDescriptionBlur}
          />

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
              disabled={isSubmitting || memoryCreated}
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
            disabled={isSubmitting || memoryCreated}
            error={memoryDateError}
            onChange={(event) => setMemoryDate(event.target.value)}
            onBlur={handleMemoryDateBlur}
          />

          <TextField
            id="location"
            name="location"
            type="text"
            label="Location"
            helperText="Optional"
            autoComplete="off"
            placeholder="Where did it happen?"
            maxLength={MAX_LOCATION_LENGTH}
            value={location}
            disabled={isSubmitting || memoryCreated}
            error={locationError}
            onChange={(event) => setLocation(event.target.value)}
            onBlur={handleLocationBlur}
          />

          {/* Tags — simple multi-tag input (feature-specs §6). Type + Enter or
              comma to add, click × to remove. Tags are shared within the Space
              and deduped case-insensitively by the sync_memory_tags RPC. */}
          <TagInput
            id="tags"
            label="Tags"
            helperText="Optional"
            value={tags}
            onChange={setTags}
            disabled={isSubmitting || memoryCreated}
          />

          {/* Photos & videos — multi-select file input above the submit button. */}
          <div>
            <label
              htmlFor="media-files"
              className="block text-sm font-medium text-ink-muted mb-2"
            >
              Photos & videos
            </label>
            <label
              htmlFor="media-files"
              className={[
                "flex cursor-pointer items-center justify-center rounded-lg",
                "border border-dashed border-ink/15 px-4 py-6",
                "text-sm text-ink-muted transition-colors duration-200",
                "hover:border-ink/25 hover:text-ink",
                "focus-within:ring-2 focus-within:ring-accent-500/60 focus-within:border-accent-500",
                (isSubmitting || memoryCreated) ? "pointer-events-none opacity-60" : "",
              ].join(" ")}
            >
              <input
                id="media-files"
                type="file"
                multiple
                accept="image/*,video/*"
                className="sr-only"
                onChange={handleFileSelect}
                disabled={isSubmitting || memoryCreated}
              />
              <span>Tap to add photos or videos</span>
            </label>
            <p className="mt-1.5 text-sm text-ink-muted">
              Videos must be under 100MB.
            </p>
          </div>

          {/* Per-file selection status list. */}
          {selectedFiles.length > 0 && (
            <ul className="space-y-2">
              {selectedFiles.map((file) => {
                const isFailed = file.status === "failed";
                return (
                  <li
                    key={file.id}
                    className="flex items-start justify-between gap-3 rounded-lg border border-ink/10 bg-canvas-soft px-3.5 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-ink">{file.name}</p>
                      <p
                        className={`text-xs ${STATUS_LABELS[file.status].className}`}
                      >
                        {STATUS_LABELS[file.status].text}
                      </p>
                      {file.error && (
                        <p className="mt-0.5 text-xs text-error">
                          {file.error}
                        </p>
                      )}
                    </div>
                    {isFailed && (
                      <div className="flex shrink-0 items-center gap-3">
                        {file.mediaType !== null && (
                          <button
                            type="button"
                            onClick={() => handleRetryFile(file.id)}
                            className="rounded-md text-xs font-medium text-ink-muted transition-colors duration-200 hover:text-accent-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60"
                          >
                            Retry
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleRemoveFile(file.id)}
                          className="rounded-md text-xs font-medium text-ink-muted transition-colors duration-200 hover:text-error focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60"
                        >
                          Remove
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {formError && (
            <p
              id="create-memory-form-error"
              role="alert"
              className="text-sm text-error"
            >
              {formError}
            </p>
          )}

          {/* Calm inline notice when the Memory was saved but its tags could not
              be synced (non-blocking — the Memory exists; tags can be retried
              via Edit). Shown only on the success screen. */}
          {memoryCreated && tagWarning && (
            <p className="text-sm text-ink-muted" role="status">
              {tagWarning}
            </p>
          )}

          {memoryCreated ? (
            <PrimaryButton type="button" disabled={!allUploadsDone} onClick={handleContinueToSpace}>
              Continue to Space
            </PrimaryButton>
          ) : (
            <PrimaryButton type="submit" loading={isSubmitting}>
              {isSubmitting ? "Creating…" : "Create Memory"}
            </PrimaryButton>
          )}
        </form>

        <p className="mt-8 text-center text-sm text-ink-muted">
          {spaceId ? (
            <GhostLink to={spaceDetailPath(spaceId)}>
              Back to Space
            </GhostLink>
          ) : (
            <GhostLink to="/spaces">Back to Spaces</GhostLink>
          )}
        </p>
      </div>
    </AppShell>
  );
}

/**
 * Maps a Supabase insert error to a calm, human-friendly message
 * (auth-design §7 voice). Raw Supabase error messages are never shown to
 * users. The `memories_insert` RLS policy failure and any database error both
 * resolve to the same honest fallback — the user cannot act on the specifics.
 */
function mapCreateMemoryError(error: {
  code?: string;
  status?: number;
}): string {
  switch (error.code) {
    case "42501": // insufficient_privilege — RLS denied the insert
      return "You can't create a Memory right now. Please refresh and try again.";
    case "23502": // not_null_violation
      return "Some required information is missing. Please check your input.";
    case "23505": // unique_violation
      return "Something went wrong on our end. Please try again.";
    default:
      // Network problems, unexpected failures, and any unmapped codes all
      // resolve to the same calm, honest message (auth-design §7).
      return "Something went wrong on our end. Please try again.";
  }
}
