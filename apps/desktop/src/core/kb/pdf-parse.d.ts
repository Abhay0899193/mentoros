/**
 * pdf-parse ships no types for its internal entrypoint. We import
 * `pdf-parse/lib/pdf-parse.js` directly (rather than the package root) to dodge
 * its debug-mode `module.parent` trap, which tries to read a bundled test PDF
 * when the module is loaded as the main module.
 */
declare module "pdf-parse/lib/pdf-parse.js" {
  interface PdfParseResult {
    text: string;
    numpages: number;
    numrender: number;
    info: unknown;
    metadata: unknown;
    version: string;
  }
  function pdfParse(data: Buffer | Uint8Array): Promise<PdfParseResult>;
  export default pdfParse;
}
