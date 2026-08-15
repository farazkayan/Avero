type BrandWordmarkProps = {
  className?: string;
};

/**
 * The Avero mark, used consistently at the top of every auth screen
 * (auth-design §5). Text-based so it remains accessible and crisp at any
 * size (auth-design §8: "The wordmark is text where possible").
 * Uses JetBrains Mono per Design System §3 for the mono-label role.
 */
export default function BrandWordmark({ className = "" }: BrandWordmarkProps) {
  return (
    <span
      className={[
        "text-lg font-mono font-medium tracking-[0.2em] uppercase text-ink",
        className,
      ].join(" ")}
    >
      Avero
    </span>
  );
}
