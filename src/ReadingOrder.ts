import { PDFDocument } from "mupdf";
import { IDocData } from "./types/DocData.types.ts";
import { BBox, MuBlock } from "./types/PageData.types.ts";

type IndexedBlock = {
  block: MuBlock;
  index: number;
};

type VerticalCut = {
  x: number;
  width: number;
};

type MemoKey = string;

export class ReadingOrder {
  private blocks: IndexedBlock[] = [];
  private memo: Map<MemoKey, number[]> = new Map();
  private minColumnWidthRatio: number;
  private pageWidth: number;
  constructor(private doc: PDFDocument, private docData: IDocData) {
    this.pageWidth = this.docData.bounds.page.w;
    this.minColumnWidthRatio = this.minColumnWidthRatio =
      this.estimateMinColumnWidthRatio();

    this.flattenBlocks();
  }

  private isInsideBounds(bbox: BBox, bounds: BBox): boolean {
    const bx1 = bbox.x;
    const by1 = bbox.y;
    const bx2 = bbox.x + bbox.w;
    const by2 = bbox.y + bbox.h;

    const cx1 = bounds.x;
    const cy1 = bounds.y;
    const cx2 = bounds.x + bounds.w;
    const cy2 = bounds.y + bounds.h;

    // Check if center of bbox is inside content area
    const cx = (bx1 + bx2) / 2;
    const cy = (by1 + by2) / 2;

    return cx >= cx1 && cx <= cx2 && cy >= cy1 && cy <= cy2;
  }

  private estimateMinColumnWidthRatio(): number {
    const columns = this.docData.bounds.column;
    if (!columns.length) return 0.2; // fallback default

    const minColWidth = Math.min(...columns.map((col) => col.w));
    return minColWidth / this.pageWidth;
  }

  private flattenBlocks() {
    this.blocks = [];
    for (const page of this.docData.pages) {
      for (const block of page.blocks) {
        for (const line of block.lines) {
          const lineAsBlock: MuBlock = {
            type: "text",
            bbox: line.bbox,
            lines: [line],
          };
          if (this.isInsideBounds(line.bbox, this.docData.bounds.page)) {
            // console.log(`Processing line: ${line.text}`);
            this.blocks.push({ block: lineAsBlock, index: this.blocks.length });
          }
        }
      }
    }
    // for (const page of this.docData.pages) {
    //   for (const block of page.blocks) {
    //     if (
    //       block.type === "text" &&
    //       this.isInsideBounds(block.bbox, this.docData.bounds.page)
    //     ) {
    //       this.blocks.push({ block, index: this.blocks.length });
    //     }
    //   }
    // }
  }

  public computeReadingOrder(): MuBlock[] {
    const order = this.solve(0, []);
    return order.map((i) => this.blocks[i].block);
  }

  private solve(i: number, cuts: VerticalCut[]): number[] {
    if (i >= this.blocks.length) return [];

    const key = this.memoKey(i, cuts);
    if (this.memo.has(key)) {
      const memoValue = this.memo.get(key);
      return Array.isArray(memoValue) ? memoValue : [];
    }

    const current = this.blocks[i];
    const currentCuts = this.possibleVCuts(current.block);

    // Try continuing the vertical cut
    let continueCut: number[] = [];
    const sharedCuts = this.intersectCuts(cuts, currentCuts);

    if (cuts.length === 0 || sharedCuts.length > 0) {
      const rest = this.solve(i + 1, sharedCuts);
      continueCut = [i, ...rest];
    }

    // Try breaking vertical continuity
    const breakCut = [i, ...this.solve(i + 1, [])];

    // Score both
    const scoreA = this.scoreBlocks(continueCut, cuts.length > 0);
    const scoreB = this.scoreBlocks(breakCut, false);

    const result = scoreA >= scoreB ? continueCut : breakCut;
    this.memo.set(key, result);

    return result;
  }

  private possibleVCuts(block: MuBlock): VerticalCut[] {
    const cuts: VerticalCut[] = [];
    const { x, w } = block.bbox;
    const step = w / 4;
    for (let i = 1; i < 4; i++) {
      const cx = x + i * step;
      const width = step;
      if (width >= this.pageWidth * this.minColumnWidthRatio) {
        cuts.push({ x: cx, width });
      }
    }
    return cuts;
  }

  private intersectCuts(c1: VerticalCut[], c2: VerticalCut[]): VerticalCut[] {
    const threshold = 10;
    return c1.filter((a) =>
      c2.some(
        (b) =>
          Math.abs(a.x - b.x) < threshold &&
          Math.abs(a.width - b.width) < threshold
      )
    );
  }

  private scoreBlocks(indices: number[], isShared: boolean): number {
    if (indices.length === 0) return 0;
    let score = 0;
    for (const i of indices) {
      score += this.blocks[i].block.bbox.h;
    }

    if (isShared && indices.length >= 2) {
      for (let j = 1; j < indices.length; j++) {
        const b1 = this.blocks[indices[j - 1]].block.bbox;
        const b2 = this.blocks[indices[j]].block.bbox;
        const dist = Math.abs(b2.y - (b1.y + b1.h));
        score += 1 / (dist + 1); // avoid division by 0
      }
    }

    return score;
  }

  private memoKey(i: number, cuts: VerticalCut[]): string {
    return `${i}-${cuts
      .map((c) => `${c.x.toFixed(2)}:${c.width.toFixed(2)}`)
      .join("|")}`;
  }

  public debug(
    outputPath: string,
    writeFileSync: (path: string, data: Uint8Array) => void
  ): void {
    const ordered = this.computeReadingOrder();

    let count = 0;
    for (const pageData of this.docData.pages) {
      const page = this.doc.loadPage(pageData.index);

      for (const block of ordered) {
        // if (!pageData.blocks.includes(block)) continue;

        const { x, y, w, h } = block.bbox;

        // Draw block border and fill
        const annotation = page.createAnnotation("Polygon");
        annotation.setColor([0, 0, 1]); // border: blue
        annotation.setInteriorColor([0.8, 0.9, 1.0]); // pale blue
        annotation.setVertices([
          [x, y],
          [x + w, y],
          [x + w, y + h],
          [x, y + h],
        ]);
        annotation.update();

        // Add reading order number (centered)
        const label = page.createAnnotation("FreeText");
        label.setRect([
          x + w / 2 - 5,
          y + h / 2 - 5,
          x + w / 2 + 20,
          y + h / 2 + 5,
        ]);
        label.setContents(`${++count}`);
        label.getDefaultAppearance();
        label.update();
      }

      page.destroy();
    }

    const buffer = this.doc.saveToBuffer("incremental").asUint8Array();
    writeFileSync(outputPath, buffer);
  }
}
