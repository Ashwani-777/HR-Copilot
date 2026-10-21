// Import the library entry directly: pdf-parse's index.js runs a debug self-test when it thinks it is
// the main module (which happens under ESM), trying to read a sample PDF that isn't shipped.
declare module 'pdf-parse/lib/pdf-parse.js' {
  import pdf from 'pdf-parse';
  export default pdf;
}
