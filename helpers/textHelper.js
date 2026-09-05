/**
 * SSF EventStore Hub - Reusable Text & Formatting Helpers
 * Enterprise utility functions for text manipulation, word counting, truncation, and date formatting.
 */

/**
 * Truncate a text string to a maximum number of words.
 *
 * @param {string} text - Raw input text.
 * @param {number} [maxWords=50] - Maximum word threshold.
 * @param {string} [suffix='...'] - Ellipsis suffix appended if truncated.
 * @returns {{ text: string, isTruncated: boolean, wordCount: number, original: string }}
 */
function truncateWords(text, maxWords = 50, suffix = '...') {
  if (!text || typeof text !== 'string') {
    return { text: '', isTruncated: false, wordCount: 0, original: '' };
  }

  const trimmed = text.trim();
  if (!trimmed) {
    return { text: '', isTruncated: false, wordCount: 0, original: '' };
  }

  const words = trimmed.split(/\s+/).filter(Boolean);
  const wordCount = words.length;

  if (wordCount <= maxWords) {
    return {
      text: trimmed,
      isTruncated: false,
      wordCount,
      original: trimmed
    };
  }

  return {
    text: words.slice(0, maxWords).join(' ') + suffix,
    isTruncated: true,
    wordCount,
    original: trimmed
  };
}

/**
 * Format date string into standard human-readable display.
 * E.g., "2026-04-15" -> "15 Apr 2026"
 *
 * @param {string|Date} dateVal - Date representation.
 * @returns {string}
 */
function formatDate(dateVal) {
  if (!dateVal) return '';
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return String(dateVal);

  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
}

/**
 * Safe string slugifier for DOM element IDs and URL parameters.
 *
 * @param {string} str - Raw string.
 * @returns {string}
 */
function slugify(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

module.exports = {
  truncateWords,
  formatDate,
  slugify
};
