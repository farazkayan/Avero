type EndOfTimelineIndicatorProps = {
  /** Additional className for spacing/layout */
  className?: string;
};

/**
 * End of Timeline indicator — small dot + "End of Timeline" label.
 * Shown after the last real Memory card.
 * Matches Stitch source exactly.
 */
export default function EndOfTimelineIndicator({ className = "" }: EndOfTimelineIndicatorProps) {
  return (
    <div className={`flex flex-col items-center justify-center py-12 text-on-surface-variant/50 dark:text-secondary-fixed-dim/50 transition-colors duration-300 ${className}`}>
      <div className="w-1.5 h-1.5 rounded-full bg-outline-variant dark:bg-inverse-surface mb-4 shadow-[0_0_0_4px_rgba(209,196,183,0.2)] dark:shadow-[0_0_0_4px_rgba(51,48,44,0.4)] transition-all duration-300" />
      <p className="font-mono-label text-mono-label uppercase tracking-widest">End of Timeline</p>
    </div>
  );
}