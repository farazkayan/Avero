import { useState } from "react";
import { useNavigate } from "react-router";
import AppShell from "../components/AppShell";
import TextField from "../components/ui/TextField";
import PrimaryButton from "../components/ui/PrimaryButton";
import GhostLink from "../components/ui/GhostLink";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";
import { AUTHENTICATED_HOME_PATH, spaceDetailPath } from "../constants/routes";
import type { Space } from "../types/space";

/**
 * Maximum length for a Space name.
 *
 * Neither spaces-design.md nor database.md specifies a length limit — the
 * `spaces.name` column is `text` with no CHECK constraint. 100 characters is
 * a sensible ceiling: long enough for any reasonable name, short enough to
 * keep the dashboard's SpaceCard tidy.
 */
const MAX_NAME_LENGTH = 100;

/**
 * Maximum length for a Space description.
 *
 * Also unconstrained at the database level. 500 characters is enough for a
 * short sentence or two of context without becoming an essay.
 */
const MAX_DESCRIPTION_LENGTH = 500;

/**
 * Create Space screen (spaces-design §6.2).
 *
 * A centered form inside `AppShell` that inserts a new row into the `spaces`
 * table. The `created_by` field is set explicitly to the current user's id —
 * the `spaces_insert` RLS policy enforces `created_by = auth.uid()`, and the
 * `handle_new_space()` AFTER INSERT trigger reads `NEW.created_by` to auto-add
 * the creator as an `owner` in `space_members` (backend-implementation §12).
 * There is no database default or trigger that sets `created_by`, so the
 * client must provide it.
 *
 * Validation, error handling, and form state mirror SignUpPage: per-field
 * errors validated on blur and on submit, a calm form-level error for
 * Supabase failures, and input is never lost on error (state is preserved
 * across the failed submission).
 *
 * On success the page redirects to the newly created Space's detail page
 * (`/spaces/:spaceId`), where the creator (auto-added as owner by the
 * `handle_new_space()` trigger) can review the Space and its members.
 */
export default function CreateSpacePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [descriptionError, setDescriptionError] = useState<string | undefined>(
    undefined
  );
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function validateName(value: string): string | undefined {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return "Enter a name for your Space.";
    }
    if (trimmed.length > MAX_NAME_LENGTH) {
      return `Keep the name under ${MAX_NAME_LENGTH} characters.`;
    }
    return undefined;
  }

  function validateDescription(value: string): string | undefined {
    if (value.length > MAX_DESCRIPTION_LENGTH) {
      return `Keep the description under ${MAX_DESCRIPTION_LENGTH} characters.`;
    }
    return undefined;
  }

  function handleNameBlur() {
    setNameError(validateName(name));
  }

  function handleDescriptionBlur() {
    setDescriptionError(validateDescription(description));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // Prevent duplicate submissions while a request is in flight.
    if (isSubmitting) {
      return;
    }

    const nextNameError = validateName(name);
    const nextDescriptionError = validateDescription(description);
    setNameError(nextNameError);
    setDescriptionError(nextDescriptionError);

    if (nextNameError || nextDescriptionError) {
      return;
    }

    // ProtectedRoute guarantees a user before this page mounts; this guard
    // only satisfies the type system for the insert below.
    if (!user) {
      return;
    }

    setFormError(undefined);
    setIsSubmitting(true);

    try {
      const { data, error } = await supabase
        .from("spaces")
        .insert({
          name: name.trim(),
          description: description.trim() || null,
          // Required by the spaces_insert RLS policy (created_by = auth.uid())
          // and read by handle_new_space() to auto-add the creator as owner.
          created_by: user.id,
        })
        .select()
        .single<Space>();

      if (error) {
        setFormError(mapCreateSpaceError(error));
        return;
      }

      // Success — navigate to the new Space's detail page. The creator was
      // auto-added as an owner by the handle_new_space() trigger, so the
      // detail page's fetch will return the Space and its single-member list.
      navigate(spaceDetailPath(data.id), { replace: true });
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
            Create a Space
          </h1>
          <p className="mt-2 text-sm text-ink-muted sm:text-base">
            A private home for your shared memories.
          </p>
        </div>

        <form
          className="space-y-5"
          onSubmit={handleSubmit}
          noValidate
          aria-describedby={formError ? "create-space-form-error" : undefined}
        >
          <TextField
            id="name"
            name="name"
            type="text"
            label="Space name"
            autoComplete="off"
            placeholder="Our adventures"
            maxLength={MAX_NAME_LENGTH}
            value={name}
            disabled={isSubmitting}
            error={nameError}
            onChange={(event) => setName(event.target.value)}
            onBlur={handleNameBlur}
          />

          <TextField
            id="description"
            name="description"
            type="text"
            label="Description"
            helperText="Optional"
            placeholder="A few words about this Space"
            maxLength={MAX_DESCRIPTION_LENGTH}
            value={description}
            disabled={isSubmitting}
            error={descriptionError}
            onChange={(event) => setDescription(event.target.value)}
            onBlur={handleDescriptionBlur}
          />

          {formError && (
            <p
              id="create-space-form-error"
              role="alert"
              className="text-sm text-error"
            >
              {formError}
            </p>
          )}

          <PrimaryButton type="submit" loading={isSubmitting}>
            {isSubmitting ? "Creating…" : "Create Space"}
          </PrimaryButton>
        </form>

        <p className="mt-8 text-center text-sm text-ink-muted">
          <GhostLink to={AUTHENTICATED_HOME_PATH}>Back to Spaces</GhostLink>
        </p>
      </div>
    </AppShell>
  );
}

/**
 * Maps a Supabase insert error to a calm, human-friendly message
 * (auth-design §7 voice). Raw Supabase error messages are never shown to
 * users. The `spaces_insert` RLS policy failure and any database error both
 * resolve to the same honest fallback — the user cannot act on the specifics.
 */
function mapCreateSpaceError(error: {
  code?: string;
  status?: number;
}): string {
  switch (error.code) {
    case "42501": // insufficient_privilege — RLS denied the insert
      return "You can't create a Space right now. Please refresh and try again.";
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
