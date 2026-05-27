import Image from "next/image";

const LOGO_SRC = "/fya_color_h.png";
// Native dimensions of fya_color_h.png are roughly 5:2 (heart + wordmark).
const NATURAL_W = 2000;
const NATURAL_H = 800;

type Variant = "header" | "card" | "inline";

const SIZE: Record<Variant, { h: number; padding: string }> = {
  header: { h: 56, padding: "px-4 py-2.5" },
  card: { h: 48, padding: "px-3.5 py-2" },
  inline: { h: 32, padding: "px-2 py-1" },
};

export function Logo({
  variant = "header",
  className = "",
}: {
  variant?: Variant;
  className?: string;
}) {
  const { h, padding } = SIZE[variant];
  const w = Math.round(h * (NATURAL_W / NATURAL_H));
  return (
    <div
      className={`bg-white rounded-2xl shadow-md inline-flex items-center justify-center ${padding} ${className}`}
    >
      <Image
        src={LOGO_SRC}
        alt="Fe y Alegría Venezuela"
        width={w}
        height={h}
        priority
        className="object-contain"
        style={{ height: `${h}px`, width: "auto" }}
      />
    </div>
  );
}
