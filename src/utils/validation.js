/**
 * Puppeteer Service - Request Validation
 * Validates incoming RFQ fill requests
 */

const VALID_CONDITION_CODES = ['NE', 'NS', 'OH', 'SV', 'AR'];

function validateRfqRequest(body) {
  const errors = [];

  if (!body) {
    errors.push('Request body is required');
    return errors;
  }

  if (!body.rfq_details) {
    errors.push('rfq_details is required');
  } else if (!body.rfq_details.quote_submission_url) {
    errors.push('rfq_details.quote_submission_url is required');
  } else {
    try {
      const url = new URL(body.rfq_details.quote_submission_url);
      if (!['http:', 'https:'].includes(url.protocol)) {
        errors.push('rfq_details.quote_submission_url must use http or https protocol');
      }
    } catch {
      errors.push('rfq_details.quote_submission_url must be a valid URL');
    }
  }

  if (!body.quote_details) {
    errors.push('quote_details is required');
  } else if (body.quote_details.items && !Array.isArray(body.quote_details.items)) {
    errors.push('quote_details.items must be an array');
  } else if (Array.isArray(body.quote_details.items)) {
    // Validate conditionCode on each item if present
    body.quote_details.items.forEach((item, index) => {
      if (item.conditionCode !== undefined) {
        if (typeof item.conditionCode !== 'string' || item.conditionCode.trim() === '') {
          errors.push(`quote_details.items[${index}].conditionCode must be a non-empty string`);
        } else if (!VALID_CONDITION_CODES.includes(item.conditionCode.toUpperCase())) {
          errors.push(`quote_details.items[${index}].conditionCode must be one of: ${VALID_CONDITION_CODES.join(', ')}`);
        }
      }
    });
  }

  return errors;
}

function formatTagDate(value) {
  if (value === undefined || value === null) return undefined;

  const trimmed = String(value).trim();
  if (!trimmed) return undefined;

  const upper = trimmed.toUpperCase();
  if (/^[A-Z]{3}-\d{2}-\d{4}$/.test(upper)) {
    return upper;
  }

  const parsedDate = new Date(trimmed);
  if (Number.isNaN(parsedDate.getTime())) {
    return upper;
  }

  const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const month = MONTHS[parsedDate.getUTCMonth()];
  const day = String(parsedDate.getUTCDate()).padStart(2, '0');
  const year = parsedDate.getUTCFullYear();
  return `${month}-${day}-${year}`;
}

module.exports = {
  validateRfqRequest,
  formatTagDate,
  VALID_CONDITION_CODES
};
