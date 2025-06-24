import { PDFDocument } from "npm:mupdf";
import { getDebugFilePath, getTestInputFilePath } from "./utils/debug.ts";
import { DocData } from "./DocData.ts";
import { writeFileSync } from "node:fs";

if (import.meta.main) {
  const doc = PDFDocument.openDocument(
    Deno.readFileSync(getTestInputFilePath("input7.pdf")),
    "application/pdf"
  ) as PDFDocument;

  const docData = new DocData(doc);
  Deno.writeTextFileSync(
    getDebugFilePath("DocDataDebug.json"),
    JSON.stringify(docData.getDocData(), null, 2)
  );

  // docData.debug(getDebugFilePath("DocDataDebug.pdf"), writeFileSync, {
  //   wordBorder: [1, 0, 0], // red border
  // });
}
