type AuthHeadingProps = {
  headline: string;
  supportingLine: string;
  className?: string;
};

/**
 * The emotional H1 headline + supporting line, kept as a unit so the spacing
 * between them is always consistent (auth-design §5). The headline names what
 * the screen is for in human language, not UI labels (Design System §3).
 */
export default function AuthHeading({
  headline,
  supportingLine,
  className = "",
}: AuthHeadingProps) {
  return (
    <div className={className}>
      <h1 className="text-2xl font-bold leading-tight text-ink sm:text-3xl">
        {headline}
      </h1>
      <p className="mt-2 text-sm text-ink-muted sm:text-base">
        {supportingLine}
      </p>
    </div>
  );
}
