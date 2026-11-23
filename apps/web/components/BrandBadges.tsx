import Image from "next/image";

// Uses the official logo files in public/brand_logos. Each file is a full
// lockup; the badge window shows only its mark, and the text is set in the
// pixel font. Mark widths: Solana 110 of 646 × 96, MagicBlock 214 of 1134 × 205.
const BRANDS = [
  {
    id: "solana",
    src: "/brand_logos/solanaLogo.svg",
    width: 646,
    height: 96,
    lead: "Built on",
    name: "Solana",
  },
  {
    id: "magicblock",
    src: "/brand_logos/MagicBlock-Logo-Black.svg",
    width: 1134,
    height: 205,
    lead: "Powered by",
    name: "MagicBlock",
  },
] as const;

export default function BrandBadges() {
  return (
    <ul className="lobby-brands">
      {BRANDS.map((brand) => (
        <li key={brand.id} className="lobby-brand" data-brand={brand.id}>
          <span className="lobby-brand-mark" aria-hidden="true">
            <Image
              unoptimized
              src={brand.src}
              alt=""
              width={brand.width}
              height={brand.height}
            />
          </span>
          <span>
            {brand.lead} <strong>{brand.name}</strong>
          </span>
        </li>
      ))}
    </ul>
  );
}
