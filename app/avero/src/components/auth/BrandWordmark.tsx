type BrandWordmarkProps = {
  className?: string;
};

/**
 * The Avero mark, used consistently at the top of every auth screen
 * (auth-design §5). Text-based so it remains accessible and crisp at any
 * size (auth-design §8: "The wordmark is text where possible").
 */
export default function BrandWordmark({ className = "" }: BrandWordmarkProps) {
  return (
    <span
      className={[
        "text-lg font-semibold tracking-[0.2em] uppercase text-ink",
        className,
      ].join(" ")}
    >
      Avero
    </span>
  );
}
