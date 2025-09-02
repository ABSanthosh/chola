import {
  PDFDocument,
  Quad,
  StructuredText,
  Matrix,
  ColorSpace,
  Buffer,
  type Rect,
  type Font as MuFont,
} from "mupdf";
import { IDocData, SpacingStat, FontStat } from "./types/DocData.types.ts";
import {
  BBox,
  MuBlock,
  FlatLine,
  Font,
  Line,
  PageData,
  Span,
} from "./types/PageData.types.ts";
import { getDebugFilePath } from "./utils/debug.ts";

export class DocData {
  public readonly length: number;
  private pages: PageData[] = [];
  private fontStats: { [key: string]: FontStat } = {};
  private docData: IDocData = {
    pages: [],
    lines: [],
    fontStats: [],
    bounds: {
      page: {
        x: 0,
        y: 0,
        w: 0,
        h: 0,
      },
      column: [],
    },
    spacingStats: {
      horizontal: [],
      vertical: [],
      lineHeight: [],
    },
  };
  private verticalSpacing: { [key: number]: SpacingStat } = {};
  private horizontalSpacing: { [key: number]: SpacingStat } = {};
  private lineHeightSpacing: { [key: number]: SpacingStat } = {};
  private flatLines: FlatLine[] = [];

  private pageBoundFrequency: {
    [key: string]: Partial<MuBlock>[];
  } = {};

  constructor(private doc: PDFDocument) {
    this.length = doc.countPages();

    for (let i = 0; i < this.length; i++) {
      const page = doc.loadPage(i);

      // const pixmap = page.toPixmap(
      //   Matrix.scale(2, 2),
      //   ColorSpace.DeviceRGB,
      //   false,
      //   false
      // );

      // Deno.writeFileSync(
      //   getDebugFilePath(`DocDataDebugPage${i + 1}.png`),
      //   new Buffer(pixmap.asPNG()).asUint8Array()
      // );
      // pixmap.destroy();

      const structuredPage = page.toStructuredText();
      this.pages.push({
        index: i,
        blocks: this.asJson(structuredPage, i),
      });
    }

    this.docData.pages = this.pages;
    this.docData.lines = this.flatLines;
    this.docData.fontStats = Object.values(this.fontStats).sort(
      (a, b) => b.frequency - a.frequency
    );
    this.docData.spacingStats.vertical = this.toArray(this.verticalSpacing);
    this.docData.spacingStats.horizontal = this.toArray(this.horizontalSpacing);
    this.docData.spacingStats.lineHeight = this.toArray(this.lineHeightSpacing);
    this.docData.bounds = this.enlargePageBound(this.pageBoundFrequency);

    // for (let i = 0; i < this.length; i++) {
    //   const page = this.doc.loadPage(i);
    //   this.docData.bounds.column.forEach((bound) => {
    //     const annotation = page.createAnnotation("Polygon");
    //     annotation.setColor([1, 0, 0]);
    //     annotation.setVertices([
    //       [bound.x, bound.y],
    //       [bound.x + bound.w, bound.y],
    //       [bound.x + bound.w, bound.y + bound.h],
    //       [bound.x, bound.y + bound.h],
    //     ]);
    //     annotation.update();
    //   });
    // }

    // Deno.writeFileSync(
    //   getDebugFilePath("BoundingBoxesDebug.pdf"),
    //   this.doc.saveToBuffer("incremental").asUint8Array()
    // );
  }

  public getDocData(): IDocData {
    return this.docData;
  }

  private enlargePageBound(freq: { [key: string]: Partial<MuBlock>[] }): {
    page: BBox;
    column: BBox[];
  } {
    const commonBounds = Object.fromEntries(
      Object.entries(freq)
        .sort(
          (a, b) =>
            (b[1] as Partial<MuBlock>[]).length -
            (a[1] as Partial<MuBlock>[]).length
        )
        .slice(0, 2)
    );

    // return 2 largest bounding boxes. take all blocks in each item of freq
    // and enlarge them into a single bounding box and return the two largest
    // bounding boxes.
    const enlargedPageBounds: BBox = {
      x: Infinity,
      y: Infinity,
      w: -Infinity,
      h: -Infinity,
    };
    const enlargedColumnBounds: BBox[] = [];
    Object.values(commonBounds).forEach((item) => {
      if (item.length === 0) return;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      item.forEach((block) => {
        if (!block.bbox) return;
        minX = Math.min(minX, block.bbox.x);
        minY = Math.min(minY, block.bbox.y);
        maxX = Math.max(maxX, block.bbox.x + block.bbox.w);
        maxY = Math.max(maxY, block.bbox.y + block.bbox.h);
      });

      enlargedColumnBounds.push({
        x: minX,
        y: minY,
        w: maxX - minX,
        h: maxY - minY,
      });
    });

    // Merge all column bounding boxes into a single page bounding box
    enlargedPageBounds.x = Math.min(
      ...enlargedColumnBounds.map((col) => col.x)
    );
    enlargedPageBounds.y = Math.min(
      ...enlargedColumnBounds.map((col) => col.y)
    );
    enlargedPageBounds.w =
      Math.max(...enlargedColumnBounds.map((col) => col.x + col.w)) -
      enlargedPageBounds.x;
    enlargedPageBounds.h =
      Math.max(...enlargedColumnBounds.map((col) => col.y + col.h)) -
      enlargedPageBounds.y;
    return {
      page: enlargedPageBounds,
      column: enlargedColumnBounds,
    };
  }

  private toArray(records: { [key: string]: SpacingStat }): SpacingStat[] {
    return Object.values(records).sort((a, b) => b.frequency - a.frequency);
  }

  private asJson(sText: StructuredText, pageIndex: number): MuBlock[] {
    const blocks: MuBlock[] = [];
    const localFlatLines: FlatLine[] = [];

    // Key: `x||w`
    const localPageBoundFrequency: {
      [key: string]: Partial<MuBlock>[];
    } = this.pageBoundFrequency;

    let currentBlock: MuBlock | null = null;
    let previousLine: Line | null = null;
    let currentLine: Line | null = null;
    let currentSpans: Span[] = [];

    // Ref: https://github.com/ArtifexSoftware/mupdf.js/blob/b058c163d98ebfc2884ac1567b923e2d007dbbb9/examples/tasks/page-words.ts#L10
    let cWordBBox: BBox | undefined;
    let cWordFont: Font | undefined;
    let cWordSize: number | undefined;
    let cWordText = "";

    const localFontStats: { [key: string]: FontStat } = this.fontStats;

    const localHorizontalSpacing: { [key: number]: SpacingStat } =
      this.horizontalSpacing;
    const localLineHeightSpacing: { [key: number]: SpacingStat } =
      this.lineHeightSpacing;
    const localVerticalSpacing: { [key: number]: SpacingStat } =
      this.verticalSpacing;

    const endWord = (spaceSpan?: Span) => {
      if (cWordBBox && cWordFont && cWordSize && cWordText.trim() !== "") {
        currentSpans.push({
          bbox: cWordBBox,
          text: cWordText,
        });
        const fontKey = `${cWordFont.name}||${parseFloat(
          `${cWordSize.toFixed(7)}`
        )}`;
        if (fontKey in localFontStats) {
          localFontStats[fontKey].frequency += 1;
        } else {
          localFontStats[fontKey] = {
            ...cWordFont,
            size: parseFloat(`${cWordSize.toFixed(7)}`),
            frequency: 1,
          };
        }
      }

      if (spaceSpan) {
        currentSpans.push(spaceSpan);
      }

      cWordBBox = undefined;
      cWordFont = undefined;
      cWordSize = undefined;
      cWordText = "";
    };

    // Quad: [ ulx uly urx ury llx lly lrx lry ]
    // ulx, uly: upper left x, y
    // urx, ury: upper right x, y
    // llx, lly: lower left x, y
    // lrx, lry: lower right x, y
    // Rect: [minX, minY, maxX, maxY]
    // BBox: { x: number, y: number, w: number, h: number }
    const enlargeBBox = (quad: Quad) => {
      if (!cWordBBox) {
        cWordBBox = {
          x: quad[0],
          y: quad[1],
          w: quad[6] - quad[0],
          h: quad[7] - quad[1],
        };
        return;
      }
      cWordBBox.x = Math.min(cWordBBox.x, quad[0]);
      cWordBBox.y = Math.min(cWordBBox.y, quad[1]);
      cWordBBox.w = Math.max(cWordBBox.w, quad[6]) - cWordBBox.x;
      cWordBBox.h = Math.max(cWordBBox.h, quad[7]) - cWordBBox.y;
    };

    sText.walk({
      beginTextBlock(rect: Rect) {
        currentBlock = {
          type: "text",
          bbox: {
            x: rect[0],
            y: rect[1],
            w: rect[2] - rect[0],
            h: rect[3] - rect[1],
          },
          lines: [],
        };
      },
      beginLine(rect: Rect, wmode: number, _) {
        const lineBBox: BBox = {
          x: rect[0],
          y: rect[1],
          w: rect[2] - rect[0],
          h: rect[3] - rect[1],
        };
        if (currentBlock && currentBlock?.lines.length !== 0) {
          previousLine = currentBlock.lines[currentBlock.lines.length - 1];
        }
        currentLine = {
          wmode: wmode as 0 | 1,
          text: "",
          bbox: lineBBox,
          font: {
            name: "",
            family: "serif",
            weight: "normal",
            style: "normal",
            size: 0,
          },
          spans: [],
        };
        currentSpans = [];
      },
      endLine() {
        endWord();
        if (currentLine) {
          currentLine.spans = currentSpans;
          currentBlock?.lines.push(currentLine);
          localFlatLines.push({
            ...currentLine,
            pageIndex,
          });

          // Line height
          //         ┌────────────┐ ┬
          // variable│intervention│ h method
          //         └────────────┘ ┴
          const lineHeight = parseFloat(currentLine.bbox.h.toFixed(4));
          if (lineHeight in localLineHeightSpacing) {
            localLineHeightSpacing[lineHeight].frequency += 1;
            localLineHeightSpacing[lineHeight].value = lineHeight;
          } else {
            localLineHeightSpacing[lineHeight] = {
              value: lineHeight,
              frequency: 1,
            };
          }

          // Vertical spacing
          // ┌─────────────┐
          // │previous line│
          // └─────────────┘┬─Vertical space
          // ┌─────────────┐┘
          // │current line │
          // └─────────────┘
          if (previousLine) {
            const verticalSpacing = parseFloat(
              (
                currentLine.bbox.y -
                (previousLine.bbox.y + previousLine.bbox.h)
              ).toFixed(4)
            );
            if (verticalSpacing in localVerticalSpacing) {
              localVerticalSpacing[verticalSpacing].frequency += 1;
              localVerticalSpacing[verticalSpacing].value = verticalSpacing;
            } else {
              localVerticalSpacing[verticalSpacing] = {
                value: verticalSpacing,
                frequency: 1,
              };
            }
          }
        }

        currentLine = null;
        currentSpans = [];
      },
      endTextBlock() {
        if (currentBlock) {
          blocks.push(currentBlock);

          // Check if the block already exists in the pageBoundFrequency
          const key = `${Math.ceil(currentBlock.bbox.x)}||${Math.ceil(
            currentBlock.bbox.w
          )}`;
          if (key in localPageBoundFrequency) {
            localPageBoundFrequency[key].push({
              bbox: currentBlock.bbox,
              type: "text",
            });
          } else {
            localPageBoundFrequency[key] = [
              {
                bbox: currentBlock.bbox,
                type: "text",
              },
            ];
          }

          currentBlock = null;
        }
      },
      onChar(c: string, _, font: MuFont, size: number, quad: Quad) {
        enlargeBBox(quad);

        // Ref: https://mupdf.readthedocs.io/en/latest/reference/javascript/types/Font.html#Font
        cWordFont = {
          name: font.getName(),
          family: font.isMono()
            ? "monospace"
            : font.isSerif()
            ? "serif"
            : "sans-serif",
          weight: font.isBold() ? "bold" : "normal",
          style: font.isItalic() ? "italic" : "normal",
          size: size,
        };
        cWordSize = size;

        if (c === " ") {
          // Horizontal spacing
          //      ┌─┐
          // word1│ │word2
          //      └─┘
          //      └─┴─ space
          const spaceWidth = parseFloat((quad[2] - quad[0]).toFixed(4));
          // add it to the withinSpacingFrequency
          if (spaceWidth in localHorizontalSpacing) {
            localHorizontalSpacing[spaceWidth].frequency += 1;
            localHorizontalSpacing[spaceWidth].value = spaceWidth;
          } else {
            localHorizontalSpacing[spaceWidth] = {
              value: spaceWidth,
              frequency: 1,
            };
          }

          endWord({
            bbox: {
              x: quad[0],
              y: quad[1],
              w: quad[2] - quad[0],
              h: quad[3] - quad[1],
            },
            text: " ",
          });

          if (currentLine) {
            currentLine.text += " ";
          }
        } else {
          cWordText += c;
          if (currentLine) {
            currentLine.text += c;
            currentLine.font = cWordFont;
            currentLine.font.size = parseFloat(cWordSize.toFixed(7));
          }
        }
      },
    });

    this.horizontalSpacing = {
      ...this.horizontalSpacing,
      ...localHorizontalSpacing,
    };

    this.lineHeightSpacing = {
      ...this.lineHeightSpacing,
      ...localLineHeightSpacing,
    };

    this.verticalSpacing = {
      ...this.verticalSpacing,
      ...localVerticalSpacing,
    };

    this.flatLines = [...this.flatLines, ...localFlatLines];

    return blocks;
  }

  public debug(
    outputPath: string = "./DocDataDebug.pdf",
    writeFileSync: (path: string, data: Uint8Array) => void,
    color: {
      wordBorder?: [number, number, number];
      wordFill?: [number, number, number] | null;
    } = {
      wordBorder: [0, 0, 1],
      wordFill: null,
    }
  ): void {
    const pageLimit = this.length;
    let pageCount = 0;
    for (const pageData of this.pages) {
      const page = this.doc.loadPage(pageData.index);

      pageCount++;
      for (const block of pageData.blocks) {
        if (block.type !== "text") continue;
        for (const line of block.lines) {
          const { x, y, w, h } = line.bbox;
          const annotation = page.createAnnotation("Polygon");
          annotation.setColor(color.wordBorder || [0, 0, 1]);

          if (color.wordFill) {
            annotation.setInteriorColor(color.wordFill);
          }

          annotation.setVertices([
            [x, y],
            [x + w, y],
            [x + w, y + h],
            [x, y + h],
          ]);

          annotation.update();
        }
      }

      page.destroy();

      if (pageCount >= pageLimit) {
        break;
      }
    }

    const buffer = this.doc.saveToBuffer("incremental").asUint8Array();
    writeFileSync(outputPath, buffer);
  }
}
