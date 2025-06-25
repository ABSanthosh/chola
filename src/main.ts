import { PDFDocument } from "npm:mupdf";
import { getDebugFilePath, getTestInputFilePath } from "./utils/debug.ts";
import { DocData } from "./DocData.ts";
import { ReadingOrder } from "./ReadingOrder.ts";

if (import.meta.main) {
  const doc = PDFDocument.openDocument(
    Deno.readFileSync(getTestInputFilePath("input8.pdf")),
    "application/pdf"
  ) as PDFDocument;

  const docData = new DocData(doc);
  const readingOrder = new ReadingOrder(doc, docData.getDocData());
  readingOrder.debug(
    getDebugFilePath("ReadingOrderDebug.pdf"),
    Deno.writeFileSync
  );
}
