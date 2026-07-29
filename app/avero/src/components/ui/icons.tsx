type IconProps = {
  className?: string;
};

/**
 * Outline-style icons with a consistent stroke width (Design System §9).
 * Icons support text, they never replace it.
 */

export function EyeIcon({ className = "" }: IconProps) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function EyeOffIcon({ className = "" }: IconProps) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 3l18 18" />
      <path d="M10.6 6.1A9.7 9.7 0 0 1 12 6c6 0 9.5 6 9.5 6a16 16 0 0 1-2.3 3.1" />
      <path d="M6.2 7.8A16 16 0 0 0 2.5 12S6 18 12 18a9.6 9.6 0 0 0 4.2-1" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  );
}

export function SparkleIcon({ className = "" }: IconProps) {
  return (
    <svg
      className={className}
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3l1.9 5.6L19.5 10.5l-5.6 1.9L12 18l-1.9-5.6L4.5 10.5l5.6-1.9L12 3z" />
    </svg>
  );
}

/**
 * A magnifying-glass glyph used for the Memory search box on the Space
 * timeline (feature-specs §7). Matches the outline style of the other icons
 * (Design System §9) so it reads as part of the same set.
 */
export function SearchIcon({ className = "" }: IconProps) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}

/**
 * A gear/settings icon used for the Space settings link on the Memories
 * timeline page. Matches the outline style of the other icons (Design System
 * §9) so it reads as part of the same set.
 */
export function GearIcon({ className = "" }: IconProps) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
    );
  }
  
  /**
   * A play affordance used over video thumbnails and in the lightbox. Matches
   * the outline style of the other icons (Design System §9). Filled rather than
   * stroked so it reads clearly as a "play" glyph at small sizes over a poster.
   */
  export function PlayIcon({ className = "" }: IconProps) {
    return (
      <svg
        className={className}
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M8 5.14v13.72a1 1 0 0 0 1.52.85l11.18-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14z" />
      </svg>
    );
  }
  
  /**
   * A close (×) glyph used for the lightbox dismiss control. Matches the outline
   * style of the other icons (Design System §9).
   */
  export function CloseIcon({ className = "" }: IconProps) {
    return (
      <svg
        className={className}
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M18 6 6 18" />
        <path d="M6 6l12 12" />
      </svg>
    );
  }
  
  /**
   * A left chevron used for the lightbox "previous" control. Matches the outline
   * style of the other icons (Design System §9).
   */
  export function ChevronLeftIcon({ className = "" }: IconProps) {
    return (
      <svg
        className={className}
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M15 18l-6-6 6-6" />
      </svg>
    );
  }
  
  /**
   * A right chevron used for the lightbox "next" control. Matches the outline
   * style of the other icons (Design System §9).
   */
  export function ChevronRightIcon({ className = "" }: IconProps) {
    return (
      <svg
        className={className}
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M9 18l6-6-6-6" />
      </svg>
    );
  }
  
  /**
   * A photo/image glyph used for the media empty state emblem. Matches the
   * outline style of the other icons (Design System §9).
   */
  export function PhotoIcon({ className = "" }: IconProps) {
    return (
      <svg
        className={className}
        width="28"
        height="28"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="3" y="3" width="18" height="18" rx="2.5" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <path d="M21 15l-5-5L5 21" />
      </svg>
    );
  }
  
  /**
   * A trash/delete glyph used for the per-tile delete affordance in the media
   * gallery. Matches the outline style of the other icons (Design System §9).
   */
  export function TrashIcon({ className = "" }: IconProps) {
    return (
      <svg
        className={className}
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M3 6h18" />
        <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
        <path d="M10 11v6" />
        <path d="M14 11v6" />
      </svg>
    );
  }

  /**
   * An outline heart glyph used as the neutral state of the timeline reaction
   * pill (feature-specs §5). When the user has not reacted, the pill shows
   * this outline heart; once they react, the pill shows the specific emoji
   * instead. Matches the outline style of the other icons (Design System §9)
   * so it reads as part of the same set. Slightly smaller (16px) so it sits
   * comfortably inside the compact pill alongside the count.
   */
  export function HeartIcon({ className = "" }: IconProps) {
    return (
      <svg
        className={className}
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
      </svg>
    );
  }

  /**
   * A vertical "more" (⋮) glyph used as the trigger for a comment's overflow
   * menu (feature-specs §4 comments enhancement). Three dots, matching the
   * outline style of the other icons (Design System §9).
   */
  export function MoreIcon({ className = "" }: IconProps) {
    return (
      <svg
        className={className}
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
      >
        <circle cx="12" cy="5" r="1.6" />
        <circle cx="12" cy="12" r="1.6" />
        <circle cx="12" cy="19" r="1.6" />
      </svg>
    );
  }

  /**
   * An outline pencil glyph used for the "Edit" affordance in a comment's
   * overflow menu (feature-specs §4 comments enhancement). Matches the
   * outline style of the other icons (Design System §9).
   */
  export function PencilIcon({ className = "" }: IconProps) {
    return (
      <svg
        className={className}
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
      </svg>
    );
  }

  /**
   * A simple bar-chart glyph used for the Space Stats link on the Memories
   * timeline header (SPEC A.4 — Stats is a secondary view reached from within
   * a Space). Matches the outline style of the other icons (Design System §9).
   */
  export function ChartIcon({ className = "" }: IconProps) {
    return (
      <svg
        className={className}
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M4 20V4" />
        <path d="M4 20h16" />
        <path d="M8 16v-4M13 16V8M18 16v-6" />
      </svg>
    );
  }

  // ===========================================================================
  // Achievement icons (SPEC A.2)
  // ---------------------------------------------------------------------------
  // Outline glyphs used by the Space Stats achievements grid. Each matches the
  // Design System §9 outline style (1.5 stroke, rounded joins) so the set
  // reads as one family. The `icon` string stored in the `achievements` catalog
  // is mapped to a rendered glyph by {@link AchievementIcon} below.
  // ===========================================================================

  /** A stacked-layers glyph — "Ten Stories" / "Fifty Stories". */
  export function StackIcon({ className = "" }: IconProps) {
    return (
      <svg
        className={className}
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 3l9 5-9 5-9-5 9-5z" />
        <path d="M3 13l9 5 9-5" />
        <path d="M3 17l9 5 9-5" />
      </svg>
    );
  }

  /** A calendar glyph — "One Month In" / "A Year of Memories". */
  export function CalendarIcon({ className = "" }: IconProps) {
    return (
      <svg
        className={className}
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="3" y="4.5" width="18" height="16.5" rx="2" />
        <path d="M3 9h18" />
        <path d="M8 2.5v4M16 2.5v4" />
      </svg>
    );
  }

  /** A leaf glyph — "Every Season". */
  export function LeafIcon({ className = "" }: IconProps) {
    return (
      <svg
        className={className}
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M5 21c0-9 7-16 16-16 0 9-7 16-16 16z" />
        <path d="M5 21c4-4 7-7 11-11" />
      </svg>
    );
  }

  /** A people glyph — "Everyone's Story". */
  export function PeopleIcon({ className = "" }: IconProps) {
    return (
      <svg
        className={className}
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="9" cy="8" r="3" />
        <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
        <path d="M16 5.5a3 3 0 0 1 0 5" />
        <path d="M17 14c2.8.5 5 3 5 6" />
      </svg>
    );
  }

  /** A chat-bubble glyph — "Lots to Say". */
  export function ChatIcon({ className = "" }: IconProps) {
    return (
      <svg
        className={className}
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M21 12a8 8 0 0 1-11.5 7.2L4 21l1.8-5.5A8 8 0 1 1 21 12z" />
      </svg>
    );
  }

  /** A tag glyph — "Well Organized". */
  export function TagIcon({ className = "" }: IconProps) {
    return (
      <svg
        className={className}
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M3 11.5V4h7.5L21 14.5 14.5 21 3 11.5z" />
        <circle cx="7.5" cy="7.5" r="1.4" />
      </svg>
    );
  }

  /** A film glyph — "Moving Pictures". */
  export function FilmIcon({ className = "" }: IconProps) {
    return (
      <svg
        className={className}
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M7 4v16M17 4v16M3 9h4M17 9h4M3 15h4M17 15h4" />
      </svg>
    );
  }

  /**
   * Maps an achievement catalog `icon` identifier to its rendered glyph.
   * Used by the Stats achievements grid so the catalog (seeded in SQL) stays
   * the single source of truth for which icon each achievement shows, while
   * the actual SVG lives here in the icon system (Design System §9).
   *
   * Falls back to {@link SparkleIcon} for any unknown identifier so a future
   * catalog addition never renders a blank card.
   */
  export function AchievementIcon({
    name,
    className = "",
  }: { name: string; className?: string }) {
    switch (name) {
      case "sparkle":
        return <SparkleIcon className={className} />;
      case "stack":
        return <StackIcon className={className} />;
      case "image":
        return <PhotoIcon className={className} />;
      case "calendar":
        return <CalendarIcon className={className} />;
      case "leaf":
        return <LeafIcon className={className} />;
      case "people":
        return <PeopleIcon className={className} />;
      case "chat":
        return <ChatIcon className={className} />;
      case "heart":
        return <HeartIcon className={className} />;
      case "tag":
        return <TagIcon className={className} />;
      case "film":
        return <FilmIcon className={className} />;
      default:
        return <SparkleIcon className={className} />;
    }
  }
