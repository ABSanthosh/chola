import init from "pdf-oxide-wasm/web";
import { WasmPdfDocument } from "pdf-oxide-wasm";

// deno task run
if (import.meta.main) {
  await init();
  console.log("Hello, Deno!");

  const bytes = new Uint8Array(Deno.readFileSync("./tests/2603.16153v1.pdf"));
  const doc = new WasmPdfDocument(bytes);

  console.log(`Pages: ${doc.pageCount()}`);
  console.log(doc.extractText(0, [0, 0, 1000, 1000]));

  doc.free();
}
