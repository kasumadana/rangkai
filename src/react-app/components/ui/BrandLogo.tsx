import { Link } from "react-router";

type BrandLogoProps = { decorative?: boolean };

export function BrandLogo({ decorative = false }: BrandLogoProps) {
 const content = <><img src="/rangkai-icon.svg" alt="" width={32} height={32} /><span>rangkai</span></>;
 return decorative ? <span className="brand-logo" aria-hidden="true">{content}</span> : <Link className="brand-logo" to="/" aria-label="rangkai beranda">{content}</Link>;
}
