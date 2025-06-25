import type { BBox, Font, PageData } from "./PageData.types.ts";

export interface IDocData {
  pages: PageData[];
  fontStats: FontStat[];
  bounds: {
    page: BBox;
    column: BBox[];
  };
  spacingStats: {
    horizontal: SpacingStat[];
    vertical: SpacingStat[];
    lineHeight: SpacingStat[];
  };
}

export interface FontStat extends Font {
  frequency: number;
}

export interface SpacingStat {
  value: number;
  frequency: number;
}
