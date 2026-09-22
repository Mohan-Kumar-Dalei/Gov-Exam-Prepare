const fs = require('node:fs/promises');
const ApiError = require('../utils/ApiError.js');
const logger = require('../utils/logger.js');

// Require the library entry point directly: pdf-parse's index.js runs a debug
// block that reads a sample file from disk when it is loaded as the main module.
const pdfParse = require('pdf-parse/lib/pdf-parse.js');

/**
 * Below this many characters the text layer is not worth analysing — the PDF is
 * scanned, image-only, or protected. Those go to Gemini as page images instead.
 */
const TEXT_LAYER_THRESHOLD = 200;

/** Collapses the ragged whitespace typical of two-column government PDFs. */
function normalise(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/ /g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();
}

/**
 * Reads a PDF, preferring the cheap text layer and falling back to vision.
 *
 * A scanned notification is a normal input, not an error: when there is no
 * usable text, `needsVision` is set and the caller hands the bytes to Gemini,
 * which reads the pages as images.
 *
 * @param {string} filePath absolute path to a PDF on disk
 * @returns {Promise<{ text: string, pageCount: number, charCount: number,
 *                     needsVision: boolean, buffer: Buffer|null, info: object }>}
 */
async function parsePdf(filePath) {
  let buffer;
  try {
    buffer = await fs.readFile(filePath);
  } catch {
    throw ApiError.notFound('Uploaded file could not be read from disk.');
  }

  let parsed = null;
  try {
    parsed = await pdfParse(buffer, { max: 0 });
  } catch (err) {
    // A broken text layer is not fatal — the model may still read the pages.
    logger.warn(`pdf-parse failed (${err.message}); falling back to vision`);
  }

  const text = normalise(parsed?.text);
  const needsVision = text.length < TEXT_LAYER_THRESHOLD;

  if (needsVision) {
    logger.info(
      `No usable text layer (${text.length} chars) — sending ${parsed?.numpages || '?'} page(s) to Gemini as images`,
    );
  }

  return {
    text,
    pageCount: parsed?.numpages || 0,
    charCount: text.length,
    needsVision,
    // Only carried when needed: holding the bytes of a large PDF is not free.
    buffer: needsVision ? buffer : null,
    info: parsed?.info || {},
  };
}

async function removeFile(filePath) {
  try {
    await fs.unlink(filePath);
  } catch {
    /* already gone — nothing to clean up */
  }
}

module.exports = { parsePdf, removeFile };
Object.assign(module.exports, { parsePdf, removeFile });
