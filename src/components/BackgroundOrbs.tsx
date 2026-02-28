/**
 * Renders 3 large, softly blurred, semi-transparent circles that float
 * slowly behind the page content. Their color is controlled entirely by
 * CSS rules in index.css keyed off the `[data-age-group]` attribute on
 * <html>, so this component carries no logic — just structure.
 */
export default function BackgroundOrbs() {
  return (
    <div className="bg-orbs" aria-hidden="true">
      <div className="bg-orb bg-orb--1" />
      <div className="bg-orb bg-orb--2" />
      <div className="bg-orb bg-orb--3" />
    </div>
  );
}
