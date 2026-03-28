/**
 * Normalize text for classifier matching.
 *
 * Handles Unicode variations common in Ukrainian/Russian text:
 * curly quotes → straight, em/en dashes → hyphens, ё → е, etc.
 */
export function normalizeText(input: string): string {
  let text = input;

  // Lowercase
  text = text.toLowerCase();

  // Normalize quotes and dashes
  text = text.replace(/[\u2018\u2019\u0060]/g, "'");  // curly single quotes → straight
  text = text.replace(/[\u2013\u2014]/g, "-");         // en/em dash → hyphen
  text = text.replace(/[\u00AB\u00BB\u201C\u201D\u201E\u201F]/g, '"'); // fancy double quotes → straight

  // Normalize Ukrainian specific: і/ї/є/ґ are fine, but handle ё→е in RU text
  text = text.replace(/\u0451/g, '\u0435');

  // Trim whitespace, collapse multiple spaces
  text = text.replace(/\s+/g, ' ').trim();

  return text;
}
