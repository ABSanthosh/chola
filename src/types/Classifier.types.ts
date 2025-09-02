import { BBox, Font } from "./PageData.types.ts";

export interface FigureItem {
  bbox: BBox;
  page: number;
  caption: {
    text: string;
    bbox: BBox;
    font: Font;
  };
}
