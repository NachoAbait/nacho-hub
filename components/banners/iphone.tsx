// El template de iPhone fue la base; hoy todas las categorías usan CategoryBanner.
// Se mantiene este archivo para compatibilidad (scripts/preview-banner.tsx).
import { BANNER_SIZE, BANNER_TEMPLATE_VERSION, CategoryBanner, formatUsd, type BannerProduct } from "@/components/banners/category";

export const IPHONE_TEMPLATE_VERSION = BANNER_TEMPLATE_VERSION;
export const IPHONE_BANNER_SIZE = BANNER_SIZE;
export { formatUsd };

export interface IphoneBannerProps {
  products: BannerProduct[];
  dateLabel: string;
}

export function IphoneBanner({ products, dateLabel }: IphoneBannerProps) {
  return <CategoryBanner category="iphone" products={products} dateLabel={dateLabel} />;
}
