/**
 * Puppeteer Service - Form Filler
 * Handles RFQ form field population
 */

const logger = require('../utils/logger');
const { formatTagDate } = require('../utils/validation');
const { DEFAULT_TIMEOUT } = require('./browser');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// =============================================================================
// FORM FIELD HELPERS (suffix-based matching for ASP.NET forms)
// =============================================================================

async function fillRepeaterFieldBySuffix(page, suffix, index, value, options = {}) {
  if (value === undefined || value === null) return;

  const stringValue = String(value);
  if (stringValue.length === 0) return;

  try {
    await page.waitForFunction(({ suffix, index }) => {
      const inputs = Array.from(document.querySelectorAll('input'))
        .filter((el) => el.id && el.id.endsWith(suffix));
      return Boolean(inputs[index]);
    }, { timeout: DEFAULT_TIMEOUT }, { suffix, index });

    await page.evaluate(({ suffix, index, value, removeReadonly }) => {
      const inputs = Array.from(document.querySelectorAll('input'))
        .filter((el) => el.id && el.id.endsWith(suffix));
      const target = inputs[index];

      if (!target) {
        throw new Error(`Unable to find element with suffix ${suffix} at index ${index}`);
      }

      if (removeReadonly) {
        target.removeAttribute('readonly');
      }

      target.value = '';
      target.value = value;
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
    }, {
      suffix,
      index,
      value: stringValue,
      removeReadonly: Boolean(options.removeReadonly)
    });

    logger.debug(`Filled suffix ${suffix}[${index}]`, { value: stringValue });
  } catch (error) {
    logger.warn(`Failed to fill suffix ${suffix}[${index}]`, { error: error.message });
  }
}

async function selectDropdownBySuffix(page, suffix, index, value) {
  if (!value) return;

  try {
    await page.waitForFunction(({ suffix, index }) => {
      const selects = Array.from(document.querySelectorAll('select'))
        .filter((el) => el.id && el.id.endsWith(suffix));
      return Boolean(selects[index]);
    }, { timeout: 5000 }, { suffix, index });

    const actualId = await page.evaluate(({ suffix, index }) => {
      const selects = Array.from(document.querySelectorAll('select'))
        .filter((el) => el.id && el.id.endsWith(suffix));
      return selects[index]?.id || null;
    }, { suffix, index });

    if (actualId) {
      await page.select(`#${actualId}`, value);
      logger.debug(`Selected ${suffix}[${index}]`, { value });
    }
  } catch (error) {
    logger.warn(`Failed to fill dropdown ${suffix}[${index}]`, { error: error.message });
  }
}

async function clickElementBySuffix(page, suffix, index) {
  try {
    await page.waitForFunction(({ suffix, index }) => {
      const elements = Array.from(document.querySelectorAll('input'))
        .filter((el) => el.id && el.id.endsWith(suffix));
      return Boolean(elements[index]);
    }, { timeout: 5000 }, { suffix, index });

    await page.evaluate(({ suffix, index }) => {
      const elements = Array.from(document.querySelectorAll('input'))
        .filter((el) => el.id && el.id.endsWith(suffix));
      const target = elements[index];
      if (target) {
        target.click();
      }
    }, { suffix, index });

    logger.debug(`Clicked ${suffix}[${index}]`);
  } catch (error) {
    logger.warn(`Failed to click ${suffix}[${index}]`, { error: error.message });
  }
}

async function fillTextareaBySuffix(page, suffix, value) {
  if (!value) return;

  try {
    await page.waitForFunction((suffix) => {
      const textareas = Array.from(document.querySelectorAll('textarea'))
        .filter((el) => el.id && el.id.endsWith(suffix));
      return textareas.length > 0;
    }, { timeout: 5000 }, suffix);

    const actualId = await page.evaluate((suffix) => {
      const textareas = Array.from(document.querySelectorAll('textarea'))
        .filter((el) => el.id && el.id.endsWith(suffix));
      return textareas[0]?.id || null;
    }, suffix);

    if (actualId) {
      await page.evaluate(({ id, value }) => {
        const element = document.getElementById(id);
        if (element) {
          element.value = '';
          element.value = value;
          element.dispatchEvent(new Event('input', { bubbles: true }));
          element.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, { id: actualId, value: String(value) });
      logger.debug(`Filled textarea ${suffix}`);
    }
  } catch (error) {
    logger.warn(`Failed to fill textarea ${suffix}`, { error: error.message });
  }
}

async function fillInputBySuffix(page, suffix, value) {
  if (value === undefined || value === null) return;

  const stringValue = String(value);
  if (stringValue.length === 0) return;

  try {
    const hasExact = await page.evaluate((id) => !!document.getElementById(id), suffix);

    if (hasExact) {
      await page.evaluate(({ id, value }) => {
        const element = document.getElementById(id);
        if (element) {
          element.value = '';
          element.value = value;
          element.dispatchEvent(new Event('input', { bubbles: true }));
          element.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, { id: suffix, value: stringValue });
      logger.debug(`Filled input ${suffix}`);
      return;
    }

    await page.waitForFunction((suffix) => {
      const inputs = Array.from(document.querySelectorAll('input'))
        .filter((el) => el.id && el.id.endsWith(suffix));
      return inputs.length > 0;
    }, { timeout: 5000 }, suffix);

    const actualId = await page.evaluate((suffix) => {
      const inputs = Array.from(document.querySelectorAll('input'))
        .filter((el) => el.id && el.id.endsWith(suffix));
      return inputs[0]?.id || null;
    }, suffix);

    if (actualId) {
      await page.evaluate(({ id, value }) => {
        const element = document.getElementById(id);
        if (element) {
          element.value = '';
          element.value = value;
          element.dispatchEvent(new Event('input', { bubbles: true }));
          element.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, { id: actualId, value: stringValue });
      logger.debug(`Filled input ${suffix}`);
    }
  } catch (error) {
    logger.warn(`Failed to fill input ${suffix}`, { error: error.message });
  }
}

// =============================================================================
// MAIN FORM FILLING
// =============================================================================

/**
 * Fill a single item row using its conditionCode to determine DOM suffixes.
 * Defaults to 'NE' if conditionCode is not specified.
 */
async function fillItemRow(page, item, index, requestId) {
  const code = (item.conditionCode || 'NE').toUpperCase();
  const formattedTagDate = formatTagDate(item.tag_date);

  logger.debug(`Filling item row ${index + 1} [${code}]`, { requestId, partNo: item.part_no || 'unknown' });

  await fillRepeaterFieldBySuffix(page, `txt${code}Qty1`, index, item.qty_available);
  await selectDropdownBySuffix(page, `ddl${code}Traceability1`, index, item.traceability);
  await fillRepeaterFieldBySuffix(page, `txt${code}UnitMeasure1`, index, item.uom);
  await fillRepeaterFieldBySuffix(page, `txt${code}Price1`, index, item.price_usd);

  if (item.price_type) {
    const priceTypeLower = item.price_type.toLowerCase();
    if (priceTypeLower === 'outright') {
      await clickElementBySuffix(page, `rbOutright${code}1`, index);
    } else if (priceTypeLower === 'exchange') {
      await clickElementBySuffix(page, `rbExchange${code}1`, index);
    }
  }

  await fillRepeaterFieldBySuffix(page, `txt${code}Lead1`, index, item.lead_time);
  await fillRepeaterFieldBySuffix(page, `txt${code}Date1`, index, formattedTagDate, { removeReadonly: true });
  await fillRepeaterFieldBySuffix(page, `txt${code}MinQuantity1`, index, item.min_qty);

  if (item.comments) {
    await fillRepeaterFieldBySuffix(page, `txt${code}Comments1`, index, item.comments);
  }

  logger.debug(`Completed item row ${index + 1} [${code}]`, { requestId });
}

/**
 * Read the part numbers from each row on the ILS form by scraping the
 * "Requested: <part_number>" header labels. Returns an ordered array of
 * part numbers matching the form's visual row order.
 */
async function readFormRowPartNumbers(page, requestId) {
  try {
    /* eslint-disable no-undef -- document exists in browser context (page.evaluate) */
    /* istanbul ignore next -- browser-context code */
    const partNumbers = await page.evaluate(() => {
      const headers = Array.from(document.querySelectorAll('td, th, span, div, b, strong'));
      const results = [];
      for (const el of headers) {
        const text = (el.textContent || '').trim();
        const match = text.match(/^Requested:\s*(.+)$/i);
        if (match) {
          results.push(match[1].trim());
        }
      }
      return results;
    });
    /* eslint-enable no-undef */

    logger.info('Form row part numbers detected', { requestId, partNumbers });
    return partNumbers || [];
  } catch (error) {
    logger.warn('Failed to read form row part numbers', { requestId, error: error.message });
    return [];
  }
}

async function fillRfqForm(page, quoteDetails, requestId) {
  const { items, supplier_comments, quote_prepared_by } = quoteDetails;

  if (items && items.length > 0) {
    logger.info(`Filling ${items.length} item(s)`, { requestId });

    // Only open "Quote Other Conditions" for products that have non-NE variants
    await openOtherConditionsForProducts(page, items, requestId);

    // Read part numbers from the form DOM to match payload items to correct rows
    const formPartNumbers = await readFormRowPartNumbers(page, requestId);

    if (formPartNumbers.length > 0) {
      // Part-number matching: match each payload item to its form row by part_no
      logger.info('Using part-number matching for form fill', { requestId, formRows: formPartNumbers.length });

      // Build mapping: part_no → form row index (per condition code)
      // The form rows are in visual order, and each NE row gets a sequential index
      const codeIndexCounter = {};
      const partToFormIndex = {};

      for (const formPartNo of formPartNumbers) {
        const code = 'NE'; // default condition code for row counting
        if (!codeIndexCounter[code]) codeIndexCounter[code] = 0;
        // Keep the FIRST occurrence only — the editable input row
        // ILS forms show each part twice (TH header + SPAN child), but
        // editable fields only exist once per unique part number.
        // Only increment counter for unique parts so indices stay sequential.
        if (!partToFormIndex[formPartNo]) {
          partToFormIndex[formPartNo] = { code, index: codeIndexCounter[code] };
          codeIndexCounter[code]++;
        }
      }

      logger.info('Part-to-row mapping built', { requestId, mapping: partToFormIndex });

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const partNo = item.part_no || '';

        if (item.no_quote) {
          logger.info('Skipping item (no_quote: true)', { requestId, partNo });
          continue;
        }

        const formRow = partToFormIndex[partNo];

        if (!formRow) {
          logger.warn('No matching form row found for part', { requestId, partNo, availableRows: Object.keys(partToFormIndex) });
          continue;
        }

        logger.info('Matched part to form row', { requestId, partNo, formIndex: formRow.index });
        await fillItemRow(page, item, formRow.index, requestId);
      }
    } else {
      // Fallback: sequential index filling (if form row detection fails)
      logger.warn('Could not detect form row part numbers, falling back to sequential fill', { requestId });

      const sortedItems = [...items].sort((a, b) => {
        const aNum = a.item_number || '';
        const bNum = b.item_number || '';
        return aNum.localeCompare(bNum);
      });

      const codeIndexMap = {};
      for (let i = 0; i < sortedItems.length; i++) {
        const item = sortedItems[i];
        const code = (item.conditionCode || 'NE').toUpperCase();

        if (!codeIndexMap[code]) codeIndexMap[code] = 0;

        if (item.no_quote) {
          logger.info('Skipping item (no_quote: true), advancing form row index', { requestId, index: i, code, formRowIndex: codeIndexMap[code] });
          codeIndexMap[code]++;
          continue;
        }

        await fillItemRow(page, item, codeIndexMap[code], requestId);
        codeIndexMap[code]++;
      }
    }
  }

  if (supplier_comments) {
    logger.debug('Filling supplier comments', { requestId });
    await fillTextareaBySuffix(page, 'txtComments', supplier_comments);
  }

  if (quote_prepared_by) {
    logger.debug('Filling quote prepared by', { requestId });
    await fillInputBySuffix(page, 'quotePreparedBy', quote_prepared_by);
  }

  await delay(2000);

  // Verify that data was actually populated in the form
  const filledCount = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('input[type="text"], textarea, select'));
    let filled = 0;
    for (const el of inputs) {
      if (el.value && el.value.trim().length > 0 && el.type !== 'hidden') {
        filled++;
      }
    }
    return filled;
  });

  if (filledCount === 0) {
    logger.error('FORM FILL VERIFICATION FAILED: No data was populated in the form', { requestId });
    throw new Error('Form fill verification failed — no fields were populated. The form selectors may not match the page.');
  }

  logger.info(`Form fill complete (${filledCount} field(s) verified populated)`, { requestId });
}

async function cancelFormSubmission(page, requestId) {
  logger.info('Cancelling form submission (TEST_MODE)', { requestId });

  try {
    const cancelled = await page.evaluate(() => {
      const buttons = Array.from(
        document.querySelectorAll('button, a, input[type="button"], input[type="submit"]')
      );

      const cancelBtn = buttons.find((btn) =>
        btn.textContent?.toLowerCase().includes('cancel') ||
        btn.value?.toLowerCase().includes('cancel')
      );

      if (cancelBtn) {
        cancelBtn.click();
        return true;
      }
      return false;
    });

    if (cancelled) {
      logger.info('FORM_CANCELLED: Cancel button clicked', { requestId });
      return;
    }

    logger.info('No cancel button found, pressing Escape', { requestId });
    await page.keyboard.press('Escape');
    logger.info('FORM_CANCELLED: Escape key pressed', { requestId });

  } catch (error) {
    if (error.message?.includes('Execution context was destroyed') ||
        error.message?.includes('context was destroyed') ||
        error.message?.includes('Target closed')) {
      logger.info('FORM_CANCELLED: Cancel triggered navigation (expected)', { requestId });
      return;
    }
    logger.warn('Cancel action failed', { requestId, error: error.message });
  }
}

// =============================================================================
// "CODE OTHER CONDITIONS" SECTION
// =============================================================================

/**
 * Determine which products need "Quote Other Conditions" expanded based on the
 * payload items, then trigger a single ASP.NET postback to expand them all.
 *
 * The ILS form has one "Quote Other Conditions" submit button per product
 * (repeater item). Clicking it triggers a server postback that re-renders the
 * page with additional condition rows for that product. A hidden field
 * (hdnClickId2) accepts comma-separated button IDs so the server can expand
 * multiple products in a single round-trip.
 *
 * Strategy:
 * 1. Group payload items by part_no to find which products have non-NE variants.
 * 2. If none need it, skip entirely (zero postbacks).
 * 3. Otherwise, find all "Quote Other Conditions" buttons on the page, set the
 *    hidden field with the IDs of buttons for the relevant product indices,
 *    click one button, and wait for the page to reload.
 */
async function openOtherConditionsForProducts(page, items, requestId) {
  // Determine which product indices need "other conditions" opened.
  // Items are ordered by product: group by part_no to find per-product indices.
  const productOrder = [];
  const productsNeedingOther = new Set();

  for (const item of items) {
    if (item.no_quote) continue;
    const partNo = item.part_no || '';
    const code = (item.conditionCode || 'NE').toUpperCase();

    if (!productOrder.includes(partNo)) {
      productOrder.push(partNo);
    }

    if (code !== 'NE') {
      productsNeedingOther.add(partNo);
    }
  }

  if (productsNeedingOther.size === 0) {
    logger.debug('All items are NE condition — skipping "Quote Other Conditions"', { requestId });
    return true;
  }

  // Map part numbers to product indices (0-based order on the form)
  const targetIndices = [];
  for (const partNo of productsNeedingOther) {
    const idx = productOrder.indexOf(partNo);
    if (idx >= 0) targetIndices.push(idx);
  }

  logger.info(`Opening "Quote Other Conditions" for ${targetIndices.length} product(s)`, {
    requestId,
    targetIndices,
    parts: Array.from(productsNeedingOther),
  });

  try {
    // Find all "Quote Other Conditions" buttons, set the hidden field with
    // the IDs for targeted products, then click one to trigger the postback.
    const result = await page.evaluate((targetIndices) => {
      const buttons = Array.from(
        document.querySelectorAll('input[type="submit"]')
      ).filter((el) => {
        const val = (el.value || '').toLowerCase();
        return val.includes('quote other condition') || val.includes('other condition');
      });

      if (buttons.length === 0) {
        return { clicked: false, reason: 'no buttons found' };
      }

      // Collect IDs for the targeted product indices
      const targetIds = [];
      for (const idx of targetIndices) {
        if (idx < buttons.length) {
          targetIds.push(buttons[idx].id);
        }
      }

      if (targetIds.length === 0) {
        return { clicked: false, reason: 'no matching buttons for target indices' };
      }

      // Set hdnClickId2 with comma-separated button IDs so the server
      // expands all targeted products in one postback.
      const hdnField = document.getElementById('hdnClickId2');
      if (hdnField) {
        hdnField.value = targetIds.join(',');
      }

      // Click the first targeted button to trigger the postback
      buttons[targetIndices[0]].click();

      return { clicked: true, count: targetIds.length, ids: targetIds };
    }, targetIndices);

    if (!result.clicked) {
      logger.warn('Could not open "Quote Other Conditions"', { requestId, reason: result.reason });
      return false;
    }

    logger.info(`Triggered "Quote Other Conditions" postback for ${result.count} product(s)`, {
      requestId,
      buttonIds: result.ids,
    });

    // Wait for the postback to complete (page reload)
    try {
      await page.waitForNavigation({ timeout: 30000, waitUntil: 'load' });
    } catch {
      logger.debug('No navigation detected after postback, waiting for network idle', { requestId });
    }

    await page.waitForNetworkIdle({ timeout: 15000 }).catch(() => {
      logger.warn('Network idle timeout after "Quote Other Conditions" postback', { requestId });
    });

    // Allow the DOM to settle
    await delay(1000);

    return true;
  } catch (error) {
    logger.warn('Failed to open "Quote Other Conditions"', {
      requestId, error: error.message,
    });
    return false;
  }
}

/**
 * Submit the form using the native ASP.NET form submit mechanism.
 * This is intentionally simple and synchronous (fire-and-forget click)
 * to avoid race conditions with async navigation handling.
 *
 * The function finds the specific "Submit Quote" button (not generic
 * type="submit" buttons which include postback triggers like
 * "Quote Other Conditions"), clicks it, and returns immediately.
 */
function submitForm(page, requestId) {
  logger.info('Submitting form (PRODUCTION_MODE)', { requestId });

  // Use Promise chain instead of async/await — fire the click and
  // treat navigation destruction as success.
  return page.evaluate(() => {
    // First, try to find the exact submit button by value/text.
    // Be specific to avoid clicking ASP.NET postback buttons
    // (e.g. "Quote Other Conditions") which would reload & wipe data.
    const buttons = Array.from(
      document.querySelectorAll('input[type="submit"], input[type="button"], button')
    );

    const submitBtn = buttons.find((btn) => {
      const text = (btn.textContent || btn.value || '').trim().toLowerCase();
      return text === 'send';
    });

    if (!submitBtn) {
      return { success: false, reason: 'No submit button found' };
    }

    submitBtn.click();
    return { success: true, buttonText: submitBtn.textContent || submitBtn.value };
  }).then((result) => {
    if (result.success) {
      logger.info('FORM_SUBMITTED: Submit button clicked', {
        requestId,
        buttonText: result.buttonText
      });
      return true;
    }
    logger.error('No submit button found on the form', { requestId, reason: result.reason });
    return false;
  }).catch((error) => {
    // Execution context destroyed means navigation happened — that's success
    if (error.message?.includes('Execution context was destroyed') ||
        error.message?.includes('context was destroyed') ||
        error.message?.includes('Target closed')) {
      logger.info('FORM_SUBMITTED: Submit triggered navigation (expected)', { requestId });
      return true;
    }
    logger.error('Form submission failed', { requestId, error: error.message });
    return false;
  });
}

module.exports = {
  fillRfqForm,
  cancelFormSubmission,
  submitForm,
  delay,
  fillRepeaterFieldBySuffix,
  selectDropdownBySuffix,
  clickElementBySuffix,
  readFormRowPartNumbers,
};
