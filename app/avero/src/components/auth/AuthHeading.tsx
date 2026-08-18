type AuthHeadingProps = {
  headline: string;
  supportingLine: string;
  className?: string;
};

/**
 * The emotional H1 headline + supporting line, kept as a unit so the spacing
 * between them is always consistent (auth-design §5). The headline names what
 * the screen is for in human language, not UI labels (Design System §3).
 *
 * Styled per the Stitch source (avero_sign_up_responsive_v2.1): headline-md
 * (20px / 1.4 / -0.01em / 500) for the H2, body-md (16px / 1.6 / 400) for the
 * supporting line. Theme is driven by the app's `html.light` convention via
 * the `.auth-*` classes in index.css.
 */
export default function AuthHeading({
  headline,
  supportingLine,
  className = "",
}: AuthHeadingProps) {
  return (
    <div className={className}>
      <h2 className="auth-heading-headline">
        {headline}
      </h2>
      <p className="auth-heading-supporting mt-2">
        {supportingLine}
      </p>
    </div>
  );
}
