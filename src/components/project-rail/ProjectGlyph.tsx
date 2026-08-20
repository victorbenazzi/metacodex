import { MetacodexMark } from "@/components/icons/brand";

/**
 * Shared default project mark for compact project surfaces. It inherits the
 * surrounding text color so it always reads in the default ink of its row.
 */
export function ProjectGlyph({ size = 16 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center"
      style={{ width: size, height: size }}
    >
      <MetacodexMark size={size - 2} />
    </span>
  );
}
