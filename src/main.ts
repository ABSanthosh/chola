import { PDFDocument } from "npm:mupdf";
import { getDebugFilePath, getTestInputFilePath } from "./utils/debug.ts";
import { DocData } from "./DocData.ts";
import { ReadingOrder } from "./ReadingOrder.ts";
import { Classifier } from "./Classifier.ts";

if (import.meta.main) {
  const doc = PDFDocument.openDocument(
    Deno.readFileSync(getTestInputFilePath("input2.pdf")),
    "application/pdf"
  ) as PDFDocument;

  const docData = new DocData(doc);
  console.log("Extracted document data");
  // const classifier = new Classifier(docData.getDocData(), doc);

  // // Classify lines and generate debug output
  // classifier.classifyLines();
  // classifier.debug();

  // Optional: Print line classifications
  // const lineClassifications = classifier.getLineClassifications();
  // console.log(JSON.stringify(lineClassifications, null, 2));

  // const readingOrder = new ReadingOrder(doc, docData.getDocData());
  // readingOrder.debug(getDebugFilePath("reading_order.pdf"), Deno.writeFileSync);
}
