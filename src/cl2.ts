import { IDocData, FontStat, SpacingStat } from "./types/DocData.types.ts";
import { FlatLine, BBox } from "./types/PageData.types.ts";
import { PDFDocument } from "mupdf";
import { getDebugFilePath } from "./utils/debug.ts";
import { DEBUG } from "./utils/Debug.enums.ts";

export enum BlockType {
  Heading = "Heading",
  Body = "Body",
  Caption = "Caption",
  List = "List",
}

export interface ClassifiedBlock {
  type: BlockType;
  lines: FlatLine[];
  bbox: BBox;
}

export class Classifier {
  private readonly docData: IDocData;
  private readonly doc: PDFDocument;
  private readonly bodyFont: FontStat;
  private readonly avgVerticalSpacing: number;
  private readonly avgLineHeight: number;
  private readonly leftMargin: number;
  private readonly textAlignmentTolerance: number = 2.0;
  private readonly minSharedMargin: number = 0.1;
  private readonly maxNonCapitalizedLargeWords: number = 2;

  constructor(docData: IDocData, doc: PDFDocument) {
    this.docData = docData;
    this.doc = doc;
    this.bodyFont = docData.fontStats[0]; // Most frequent font as body
    this.avgVerticalSpacing = this.calculateAverageSpacing(docData.spacingStats.vertical);
    this.avgLineHeight = this.calculateAverageSpacing(docData.spacingStats.lineHeight);
    this.leftMargin = this.calculateLeftMargin();
  }

  private calculateAverageSpacing(spacingStats: SpacingStat[]): number {
    if (!spacingStats.length) return 0;
    const total = spacingStats.reduce((sum, stat) => sum + stat.value * stat.frequency, 0);
    const totalFrequency = spacingStats.reduce((sum, stat) => sum + stat.frequency, 0);
    return total / totalFrequency;
  }

  private calculateLeftMargin(): number {
    const leftPositions = this.docData.lines.map(line => line.bbox.x);
    return leftPositions.sort((a, b) => a - b)[Math.floor(leftPositions.length * 0.1)] || 0;
  }

  public classifyLines(): ClassifiedBlock[] {
    const blocks = this.groupLinesIntoBlocks();
    return blocks.map(block => ({
      ...block,
      type: this.classifyBlock(block),
    }));
  }

  private groupLinesIntoBlocks(): { lines: FlatLine[]; bbox: BBox }[] {
    const blocks: { lines: FlatLine[]; bbox: BBox }[] = [];
    let currentBlock: FlatLine[] = [];
    let currentPageIndex = -1;

    const sortedLines = [...this.docData.lines].sort((a, b) => {
      if (a.pageIndex !== b.pageIndex) return a.pageIndex - b.pageIndex;
      return a.bbox.y - b.bbox.y;
    });

    for (let i = 0; i < sortedLines.length; i++) {
      const currentLine = sortedLines[i];
      const prevLine = i > 0 ? sortedLines[i - 1] : null;

      if (
        currentPageIndex !== currentLine.pageIndex ||
        (prevLine && this.isNewBlock(prevLine, currentLine))
      ) {
        if (currentBlock.length > 0) {
          blocks.push({
            lines: currentBlock,
            bbox: this.calculateBlockBBox(currentBlock),
          });
          currentBlock = [];
        }
        currentPageIndex = currentLine.pageIndex;
      }

      currentBlock.push(currentLine);
    }

    if (currentBlock.length > 0) {
      blocks.push({
        lines: currentBlock,
        bbox: this.calculateBlockBBox(currentBlock),
      });
    }

    return blocks;
  }

  private isNewBlock(prevLine: FlatLine, currentLine: FlatLine): boolean {
    if (prevLine.pageIndex !== currentLine.pageIndex) return true;

    const verticalSpacing = currentLine.bbox.y - (prevLine.bbox.y + prevLine.bbox.h);
    if (verticalSpacing > this.avgVerticalSpacing * 1.5) return true;

    const xDiff = Math.abs(currentLine.bbox.x - prevLine.bbox.x);
    if (xDiff > this.docData.bounds.page.w * 0.1) return true;

    if (
      currentLine.font.size > prevLine.font.size * 1.2 ||
      currentLine.font.size < prevLine.font.size * 0.8 ||
      currentLine.font.weight !== prevLine.font.weight ||
      currentLine.font.style !== prevLine.font.style
    ) return true;

    return false;
  }

  private calculateBlockBBox(lines: FlatLine[]): BBox {
    if (!lines.length) {
      return { x: 0, y: 0, w: 0, h: 0 };
    }

    const minX = Math.min(...lines.map(line => line.bbox.x));
    const minY = Math.min(...lines.map(line => line.bbox.y));
    const maxX = Math.max(...lines.map(line => line.bbox.x + line.bbox.w));
    const maxY = Math.max(...lines.map(line => line.bbox.y + line.bbox.h));

    return {
      x: minX,
      y: minY,
      w: maxX - minX,
      h: maxY - minY,
    };
  }

  private isAlignedOrCentered(bbox: BBox): boolean {
    const pageWidth = this.docData.bounds.page.w;
    const xCenter = bbox.x + bbox.w / 2;
    const isCentered =
      Math.abs(xCenter - pageWidth / 2) < this.textAlignmentTolerance;
    const isLeftAligned =
      Math.abs(bbox.x - this.leftMargin) < this.textAlignmentTolerance;
    return isCentered || isLeftAligned;
  }

  private isPrefixed(text: string): boolean {
    const numberRegex = /^[1-9][0-9]*(\.[1-9][0-9]*)*\.?$/;
    const romanNumeralsRegex = /^[IVX]+\.?$/;
    const letterNumberRegex = /^[A-Z](\.|([1-9][0-9]*\.?))$/;
    const appendixRegex = /^appendix\.?$/i;
    const words = text.trim().split(/\s+/);
    if (words.length < 2) return false;
    const firstWord = words[0];
    return (
      numberRegex.test(firstWord) ||
      romanNumeralsRegex.test(firstWord) ||
      letterNumberRegex.test(firstWord) ||
      appendixRegex.test(firstWord)
    );
  }

  private isHeading(block: { lines: FlatLine[]; bbox: BBox }): boolean {
    const firstLine = block.lines[0];
    const text = firstLine.text.trim();
    const words = text.split(/\s+/).filter(w => w.length > 3);
    const nonCapitalizedCount = words.filter(w => !/^[A-Z]/.test(w)).length;

    // Check for title-like formatting: large font, bold, or all-caps
    const isLargeFont = firstLine.font.size > this.bodyFont.size * 1.2;
    const isBold = firstLine.font.weight === "bold";
    const isAllCaps = !text.match(/[a-z]/);
    const hasTitleStyle = isLargeFont || isBold || isAllCaps;

    // Check for prefixed numbering or specific patterns
    const isPrefixedTitle = this.isPrefixed(text);

    // Check alignment with page margins or centered
    const isAligned = this.isAlignedOrCentered(block.bbox);

    // Check for short text and capitalization
    const isShortText = block.lines.length <= 3 && words.length <= 5;
    const isTitleStartText =
      text.length > 1 &&
      (isPrefixedTitle || /^[A-Z]/.test(text)) &&
      nonCapitalizedCount < this.maxNonCapitalizedLargeWords;

    // Avoid common false positives
    const blacklist = [/^proceedings of/i, /\bwe\b/i];
    const isBlacklisted = blacklist.some(regex => regex.test(text));

    return (
      hasTitleStyle &&
      isAligned &&
      isTitleStartText &&
      !isBlacklisted &&
      !this.isEquation(firstLine)
    );
  }

  private isCaption(block: { lines: FlatLine[]; bbox: BBox }): boolean {
    const text = block.lines.map(line => line.text).join(" ").toLowerCase();
    const firstLine = block.lines[0];

    // Check for caption keywords
    const captionKeywords = ["figure", "table", "caption"];
    const hasCaptionKeyword = captionKeywords.some(keyword => text.includes(keyword));

    // Check for short text (captions are typically concise)
    const isShort = block.lines.length <= 3;

    // Check font consistency with body font but allow slight variations
    const isFontConsistent =
      Math.abs(firstLine.font.size - this.bodyFont.size) < 2 &&
      firstLine.font.name === this.bodyFont.name;

    // Check proximity to graphical elements (simplified, assuming graphics data is available)
    const isNearGraphics =
      this.docData.lines.some(
        line =>
          line.pageIndex === firstLine.pageIndex &&
          line.bbox.y > block.bbox.y &&
          line.bbox.y < block.bbox.y + block.bbox.h + this.avgVerticalSpacing &&
          line.text.includes("graphic") // Placeholder for actual graphics detection
      );

    return hasCaptionKeyword && isShort && isFontConsistent && isNearGraphics;
  }

  private isList(block: { lines: FlatLine[]; bbox: BBox }): boolean {
    const firstLine = block.lines[0];
    const text = firstLine.text.trim();
    const isIndented =
      firstLine.bbox.x > this.leftMargin + this.docData.bounds.page.w * 0.05;

    // Check for list markers (e.g., "-", "•", or numbered items)
    const listRegex = /^([1-9][0-9]*|[IVX]+|[a-zA-Z])(\.|:|-|\s)/;
    const hasListMarker = listRegex.test(text);

    // Check for consistent indentation across lines
    const isConsistentlyIndented =
      block.lines.every(
        line => Math.abs(line.bbox.x - firstLine.bbox.x) < this.textAlignmentTolerance
      );

    return (isIndented || hasListMarker) && isConsistentlyIndented;
  }

  private isEquation(line: FlatLine): boolean {
    const text = line.text;
    const nonStandardCharCount = text.split("").filter(c => c.charCodeAt(0) > 128).length;
    const totalChars = text.length;
    return !this.isPrefixed(text) && nonStandardCharCount > 3 && nonStandardCharCount > totalChars * 0.4;
  }

  private isBody(block: { lines: FlatLine[]; bbox: BBox }): boolean {
    // Default classification: not a heading, caption, or list
    const firstLine = block.lines[0];
    return (
      !this.isHeading(block) &&
      !this.isCaption(block) &&
      !this.isList(block) &&
      firstLine.font.size <= this.bodyFont.size * 1.1 &&
      Math.abs(firstLine.bbox.x - this.leftMargin) < this.textAlignmentTolerance
    );
  }

  private classifyBlock(block: { lines: FlatLine[]; bbox: BBox }): BlockType {
    if (this.isHeading(block)) return BlockType.Heading;
    if (this.isCaption(block)) return BlockType.Caption;
    if (this.isList(block)) return BlockType.List;
    return BlockType.Body;
  }

  public getLineClassifications(): { line: FlatLine; type: BlockType }[] {
    const blocks = this.classifyLines();
    const lineClassifications: { line: FlatLine; type: BlockType }[] = [];

    for (const block of blocks) {
      for (const line of block.lines) {
        lineClassifications.push({ line, type: block.type });
      }
    }

    return lineClassifications;
  }

  public debug(outputPath: string = getDebugFilePath("ClassifiedBlocksDebug.pdf")): void {
    const blocks = this.classifyLines();

    const blockColors: { [key in BlockType]: [number, number, number] } = {
      [BlockType.Heading]: DEBUG.COLOR.RED,
      [BlockType.Body]: DEBUG.COLOR.BLUE,
      [BlockType.Caption]: DEBUG.COLOR.GREEN,
      [BlockType.List]: DEBUG.COLOR.YELLOW,
    };

    for (const block of blocks) {
      const pageIndex = block.lines[0].pageIndex;
      const page = this.doc.loadPage(pageIndex);
      const annotation = page.createAnnotation("Polygon");

      annotation.setColor(blockColors[block.type]);

      const { x, y, w, h } = block.bbox;
      annotation.setVertices([
        [x, y],
        [x + w, y],
        [x + w, y + h],
        [x, y + h],
      ]);

      // annotation.setBorder(1);
      // annotation.setOpacity(0.3);

      annotation.update();
    }

    Deno.writeFileSync(
      outputPath,
      this.doc.saveToBuffer("incremental").asUint8Array()
    );
  }
}