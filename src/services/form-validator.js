/**
 * Puppeteer Service - Form Validator
 *
 * Validates filled form fields against a source of truth (ingest service),
 * auto-corrects mismatches, and produces an audit report.
 */

const logger = require('../utils/logger');
const { formatTagDate } = require('../utils/validation');
const {
  fillRepeaterFieldBySuffix,
  selectDropdownBySuffix,
  clickElementBySuffix
} = require('./form-filler');

const VALIDATE_QUOTE_URL = process.env.VALIDATE_QUOTE_URL || 'http://localhost:8000/api/v1/validate-quote';

// =============================================================================
// SOURCE OF TRUTH: Ingest Service Callback
// =============================================================================

/**
 * Call the ingest service validate-quote endpoint to get freshly computed
 * quote data with all business rules applied using live Shopify data.
 */
async function fetchValidatedQuoteData(items, requestId) {
  const quotableItems = items.filter((item) => !item.no_quote);

  const partNumbers = quotableItems.map((item) => item.part_no).filter(Boolean);
  const requestedQuantities = {};
  for (const item of quotableItems) {
    if (item.part_no) {
      requestedQuantities[item.part_no] = parseInt(item.qty_available, 10) || 1;
    }
  }

  const tagDate = quotableItems[0]?.tag_date || null;

  logger.info('Calling validate-quote endpoint', {
    requestId,
    url: VALIDATE_QUOTE_URL,
    partCount: partNumbers.length,
  });

  const response = await fetch(VALIDATE_QUOTE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      part_numbers: partNumbers,
      requested_quantities: requestedQuantities,
      tag_date: tagDate,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    logger.error('validate-quote endpoint failed', { requestId, status: response.status, body });
    return null;
  }

  const data = await response.json();
  logger.info('validate-quote response received', {
    requestId,
    itemCount: data.items?.length || 0,
    errors: data.errors?.length || 0,
  });

  return data;
}

// =============================================================================
// DOM READBACK
// =============================================================================

/**
 * Read back all field values for a single item row from the form DOM.
 * Single page.evaluate per row for minimal IPC overhead.
 */
async function readbackItemRow(page, conditionCode, index) {
  const code = conditionCode.toUpperCase();

  return page.evaluate(({ code, index }) => {
    function getInputValue(suffix, idx) {
      const inputs = Array.from(document.querySelectorAll('input'))
        .filter((el) => el.id && el.id.endsWith(suffix));
      const target = inputs[idx];
      return target ? target.value.trim() : null;
    }

    function getSelectValue(suffix, idx) {
      const selects = Array.from(document.querySelectorAll('select'))
        .filter((el) => el.id && el.id.endsWith(suffix));
      const target = selects[idx];
      return target ? target.value.trim() : null;
    }

    function getRadioState(suffixOutright, suffixExchange, idx) {
      const outrightInputs = Array.from(document.querySelectorAll('input'))
        .filter((el) => el.id && el.id.endsWith(suffixOutright));
      const exchangeInputs = Array.from(document.querySelectorAll('input'))
        .filter((el) => el.id && el.id.endsWith(suffixExchange));
      if (outrightInputs[idx]?.checked) return 'OUTRIGHT';
      if (exchangeInputs[idx]?.checked) return 'EXCHANGE';
      return null;
    }

    return {
      qty: getInputValue(`txt${code}Qty1`, index),
      traceability: getSelectValue(`ddl${code}Traceability1`, index),
      uom: getInputValue(`txt${code}UnitMeasure1`, index),
      price: getInputValue(`txt${code}Price1`, index),
      price_type: getRadioState(`rbOutright${code}1`, `rbExchange${code}1`, index),
      lead_time: getInputValue(`txt${code}Lead1`, index),
      tag_date: getInputValue(`txt${code}Date1`, index),
      min_qty: getInputValue(`txt${code}MinQuantity1`, index),
      comments: getInputValue(`txt${code}Comments1`, index),
    };
  }, { code, index });
}

// =============================================================================
// FIELD COMPARISON
// =============================================================================

function normalizePrice(value) {
  if (value === null || value === undefined) return '';
  const cleaned = String(value).replace(/[$,\s]/g, '').trim();
  const num = parseFloat(cleaned);
  if (isNaN(num)) return cleaned;
  return num.toString();
}

/**
 * Compare expected item against actual DOM values.
 * Returns array of mismatch objects. Empty = all match.
 */
function compareFields(expectedItem, actualValues) {
  const mismatches = [];
  const formattedTagDate = formatTagDate(expectedItem.tag_date);

  const checks = [
    { field: 'qty_available', expected: String(expectedItem.qty_available || ''), actual: actualValues.qty },
    { field: 'uom', expected: String(expectedItem.uom || ''), actual: actualValues.uom },
    { field: 'lead_time', expected: String(expectedItem.lead_time || ''), actual: actualValues.lead_time },
    { field: 'tag_date', expected: formattedTagDate || '', actual: actualValues.tag_date },
    { field: 'min_qty', expected: String(expectedItem.min_qty || ''), actual: actualValues.min_qty },
    { field: 'traceability', expected: expectedItem.traceability || '', actual: actualValues.traceability },
    { field: 'price_usd', expected: normalizePrice(expectedItem.price_usd), actual: normalizePrice(actualValues.price) },
  ];

  if (expectedItem.comments) {
    checks.push({ field: 'comments', expected: String(expectedItem.comments), actual: actualValues.comments });
  }

  if (expectedItem.price_type) {
    checks.push({ field: 'price_type', expected: expectedItem.price_type.toUpperCase(), actual: actualValues.price_type });
  }

  for (const check of checks) {
    const expected = (check.expected || '').trim();
    const actual = (check.actual || '').trim();
    if (expected && expected !== actual) {
      mismatches.push({ field: check.field, expected, actual: actual || '(empty)' });
    }
  }

  return mismatches;
}

// =============================================================================
// CORRECTION
// =============================================================================

async function correctMismatchedFields(page, item, index, mismatches, requestId) {
  const code = (item.conditionCode || 'NE').toUpperCase();
  const formattedTagDate = formatTagDate(item.tag_date);

  for (const mismatch of mismatches) {
    logger.info('Correcting field', {
      requestId,
      partNo: item.part_no,
      field: mismatch.field,
      expected: mismatch.expected,
      actual: mismatch.actual,
    });

    switch (mismatch.field) {
      case 'qty_available':
        await fillRepeaterFieldBySuffix(page, `txt${code}Qty1`, index, item.qty_available);
        break;
      case 'uom':
        await fillRepeaterFieldBySuffix(page, `txt${code}UnitMeasure1`, index, item.uom);
        break;
      case 'price_usd':
        await fillRepeaterFieldBySuffix(page, `txt${code}Price1`, index, item.price_usd);
        break;
      case 'lead_time':
        await fillRepeaterFieldBySuffix(page, `txt${code}Lead1`, index, item.lead_time);
        break;
      case 'tag_date':
        await fillRepeaterFieldBySuffix(page, `txt${code}Date1`, index, formattedTagDate, { removeReadonly: true });
        break;
      case 'min_qty':
        await fillRepeaterFieldBySuffix(page, `txt${code}MinQuantity1`, index, item.min_qty);
        break;
      case 'comments':
        await fillRepeaterFieldBySuffix(page, `txt${code}Comments1`, index, item.comments);
        break;
      case 'traceability':
        await selectDropdownBySuffix(page, `ddl${code}Traceability1`, index, item.traceability);
        break;
      case 'price_type': {
        const suffix = item.price_type.toLowerCase() === 'exchange'
          ? `rbExchange${code}1` : `rbOutright${code}1`;
        await clickElementBySuffix(page, suffix, index);
        break;
      }
    }
  }
}

// =============================================================================
// ORCHESTRATOR
// =============================================================================

/**
 * Validate all filled form fields and auto-correct mismatches.
 *
 * Flow:
 * 1. Call ingest service validate-quote to get freshly computed source of truth
 * 2. If endpoint fails, fall back to validating against original payload
 * 3. Read back every field from the DOM
 * 4. Compare and correct (up to maxAttempts retries)
 * 5. Return validation report
 */
async function validateAndCorrect(page, quoteDetails, requestId, maxAttempts = 2) {
  const startTime = Date.now();
  const { items } = quoteDetails;
  const report = {
    status: 'pass',
    source: 'payload',
    items_validated: 0,
    fields_checked: 0,
    mismatches_found: [],
    correction_attempts: 0,
    duration_ms: 0,
  };

  if (!items || items.length === 0) {
    report.duration_ms = Date.now() - startTime;
    return report;
  }

  // Step 1: Get source of truth from ingest service
  let validationSource = items; // fallback to original payload
  const validatedData = await fetchValidatedQuoteData(items, requestId);

  if (validatedData && validatedData.items && validatedData.items.length > 0) {
    report.source = 'ingest_service';
    // Build lookup by part_no for matching against payload items
    const validatedByPart = {};
    for (const vItem of validatedData.items) {
      if (!vItem.no_quote && vItem.part_no) {
        validatedByPart[vItem.part_no] = vItem;
      }
    }

    // Merge validated data into the items we'll compare against
    validationSource = items.map((item) => {
      if (item.no_quote) return item;
      const validated = validatedByPart[item.part_no];
      return validated ? { ...item, ...validated } : item;
    });

    logger.info('Using ingest service as validation source', { requestId });
  } else {
    logger.warn('Falling back to payload as validation source', { requestId });
  }

  // Step 2: Sort and build index map (same logic as fillRfqForm)
  const sortedItems = [...validationSource].sort((a, b) => {
    const aNum = a.item_number || '';
    const bNum = b.item_number || '';
    return aNum.localeCompare(bNum);
  });

  // Step 3: Readback, compare, correct loop
  for (let attempt = 0; attempt <= maxAttempts; attempt++) {
    const currentMismatches = [];
    const codeIndexMap = {};

    for (let i = 0; i < sortedItems.length; i++) {
      const item = sortedItems[i];
      const code = (item.conditionCode || 'NE').toUpperCase();
      if (!codeIndexMap[code]) codeIndexMap[code] = 0;

      if (item.no_quote) {
        codeIndexMap[code]++;
        continue;
      }

      const formIndex = codeIndexMap[code];
      const actualValues = await readbackItemRow(page, code, formIndex);
      const itemMismatches = compareFields(item, actualValues);

      report.items_validated = Math.max(report.items_validated, i + 1);
      report.fields_checked += 9;

      if (itemMismatches.length > 0) {
        for (const m of itemMismatches) {
          currentMismatches.push({
            item_index: i,
            part_no: item.part_no || 'unknown',
            field: m.field,
            expected: m.expected,
            actual: m.actual,
            corrected: false,
          });
        }
      }

      codeIndexMap[code]++;
    }

    // Record mismatches from first pass
    if (attempt === 0 && currentMismatches.length > 0) {
      report.mismatches_found = currentMismatches;
      logger.warn(`Validation found ${currentMismatches.length} mismatch(es)`, {
        requestId,
        mismatches: currentMismatches.map((m) => ({
          part: m.part_no, field: m.field, expected: m.expected, actual: m.actual
        })),
      });
    }

    // All good
    if (currentMismatches.length === 0) {
      if (attempt > 0) {
        report.mismatches_found = report.mismatches_found.map((m) => ({ ...m, corrected: true }));
        logger.info(`Validation passed after ${attempt} correction(s)`, { requestId });
      } else {
        logger.info('Validation passed on first check', { requestId });
      }
      report.status = 'pass';
      report.duration_ms = Date.now() - startTime;
      return report;
    }

    // Max attempts reached
    if (attempt >= maxAttempts) {
      logger.error(`Validation FAILED after ${maxAttempts} correction attempt(s)`, {
        requestId,
        remaining: currentMismatches.length,
      });
      report.status = 'fail';
      report.duration_ms = Date.now() - startTime;
      return report;
    }

    // Correct mismatched fields
    report.correction_attempts++;
    logger.info(`Correction attempt ${report.correction_attempts}`, { requestId });

    const codeIndexMapCorrect = {};
    for (let i = 0; i < sortedItems.length; i++) {
      const item = sortedItems[i];
      const code = (item.conditionCode || 'NE').toUpperCase();
      if (!codeIndexMapCorrect[code]) codeIndexMapCorrect[code] = 0;

      if (item.no_quote) {
        codeIndexMapCorrect[code]++;
        continue;
      }

      const formIndex = codeIndexMapCorrect[code];
      const itemMismatches = currentMismatches.filter((m) => m.item_index === i);
      if (itemMismatches.length > 0) {
        await correctMismatchedFields(page, item, formIndex, itemMismatches, requestId);
      }

      codeIndexMapCorrect[code]++;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  report.duration_ms = Date.now() - startTime;
  return report;
}

module.exports = {
  validateAndCorrect,
  fetchValidatedQuoteData,
  readbackItemRow,
  compareFields,
  normalizePrice,
};
