export interface PageData {
  index: number;
  blocks: MuBlock[];
}

export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FlatLine extends Line {
  pageIndex: number;
}

export interface Line {
  wmode: 0 | 1; // 0: horizontal, 1: vertical
  bbox: BBox;
  font: Font;
  text: string;
  spans: Span[];
}

export interface Span {
  bbox: BBox;
  text: string;
}

export interface MuBlock {
  type: "image" | "text";
  bbox: BBox;
  lines: Line[];
}

export type Font = {
  name: string;
  family: "serif" | "sans-serif" | "monospace";
  weight: "normal" | "bold";
  style: "normal" | "italic";
  size: number;
};
