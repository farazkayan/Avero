import React from "react";
import { Link } from "react-router";
import { spaceMapPath, spaceStatsPath, spaceSettingsPath } from "../../constants/routes";

type SegmentedControlProps = {
  /** The Space ID for building navigation links */
  spaceId: string;
  /** Additional className for spacing/layout */
  className?: string;
};

/**
 * Segmented control (pill-shaped container) with three icon buttons:
 * Map, Statistics (bar_chart), Space Settings (gear).
 * Separated by thin vertical dividers.
 * Matches Stitch source exactly.
 */
export default function SegmentedControl({ spaceId, className = "" }: SegmentedControlProps) {
  const segments = [
    {
      label: "Map",
      icon: "map",
      to: spaceMapPath(spaceId),
      ariaLabel: "Map View",
    },
    {
      label: "Statistics",
      icon: "bar_chart",
      to: spaceStatsPath(spaceId),
      ariaLabel: "Statistics",
    },
    {
      label: "Space Settings",
      icon: "settings",
      to: spaceSettingsPath(spaceId),
      ariaLabel: "Space Settings",
    },
  ] as const;

  return (
    <div className={`flex items-center gap-2 bg-surface dark:bg-inverse-surface rounded-full p-1 border border-outline-variant/50 dark:border-outline-variant/20 shadow-sm transition-colors duration-300 ${className}`}>
      {segments.map((segment, index) => (
        <React.Fragment key={segment.label}>
          <Link
            to={segment.to}
            aria-label={segment.ariaLabel}
            className="w-10 h-10 rounded-full flex items-center justify-center text-on-surface-variant dark:text-secondary-fixed-dim hover:bg-surface-container-low dark:hover:bg-outline hover:text-accent-warm dark:hover:text-primary-fixed-dim transition-colors"
          >
            <span className="material-symbols-outlined text-[20px]" data-icon={segment.icon}>
              {segment.icon}
            </span>
          </Link>
          {index < segments.length - 1 && (
            <div className="w-px h-5 bg-outline-variant/30 dark:bg-outline-variant/20 transition-colors duration-300" />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}