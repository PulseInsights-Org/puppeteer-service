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
    logger.debug(`Skipped suffix ${suffix}[${index}]`, { error: error.message });
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
    logger.debug(`Skipped dropdown ${suffix}[${index}]`, { error: error.message });
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
    logger.debug(`Skipped click ${suffix}[${index}]`, { error: error.message });
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
    logger.debug(`Skipped textarea ${suffix}`, { error: error.message });
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
    logger.debug(`Skipped input ${suffix}`, { error: error.message });
  }
}

// =============================================================================
// MAIN FORM FILLING
// =============================================================================

async function fillRfqForm(page, quoteDetails, requestId) {
  const { items, supplier_comments, quote_prepared_by } = quoteDetails;

  if (items && items.length > 0) {
    logger.info(`Filling ${items.length} part(s)`, { requestId });

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const formattedTagDate = formatTagDate(item.tag_date);

      logger.debug(`Processing part ${i + 1}`, { requestId, partNo: item.part_no || 'unknown' });

      if (item.no_quote) {
        logger.debug(`Skipping part (no_quote: true)`, { requestId, index: i });
        continue;
      }

      await fillRepeaterFieldBySuffix(page, 'txtNEQty1', i, item.qty_available);
      await selectDropdownBySuffix(page, 'ddlNETraceability1', i, item.traceability);
      await fillRepeaterFieldBySuffix(page, 'txtNEUnitMeasure1', i, item.uom);
      await fillRepeaterFieldBySuffix(page, 'txtNEPrice1', i, item.price_usd);

      if (item.price_type) {
        const priceTypeLower = item.price_type.toLowerCase();
        if (priceTypeLower === 'outright') {
          await clickElementBySuffix(page, 'rbOutrightNE1', i);
        } else if (priceTypeLower === 'exchange') {
          await clickElementBySuffix(page, 'rbExchangeNE1', i);
        }
      }

      await fillRepeaterFieldBySuffix(page, 'txtNELead1', i, item.lead_time);
      await fillRepeaterFieldBySuffix(page, 'txtNEDate1', i, formattedTagDate, { removeReadonly: true });
      await fillRepeaterFieldBySuffix(page, 'txtNEMinQuantity1', i, item.min_qty);

      if (item.comments) {
        await fillRepeaterFieldBySuffix(page, 'txtNEComments1', i, item.comments);
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
  logger.info('Form fill complete', { requestId });
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

async function submitForm(page, requestId) {
  logger.info('Submitting form (PRODUCTION_MODE)', { requestId });

  try {
    // Find and click the submit button
    const submitted = await page.evaluate(() => {
      const buttons = Array.from(
        document.querySelectorAll('button, input[type="button"], input[type="submit"]')
      );

      // Look for submit button (common patterns: "Submit", "Submit Quote", "Send", etc.)
      const submitBtn = buttons.find((btn) => {
        const text = (btn.textContent || btn.value || '').toLowerCase();
        return (
          text.includes('submit') ||
          text.includes('send quote') ||
          text.includes('send') ||
          (btn.type === 'submit' && !text.includes('cancel'))
        );
      });

      if (submitBtn) {
        submitBtn.click();
        return { success: true, buttonText: submitBtn.textContent || submitBtn.value };
      }
      return { success: false };
    });

    if (submitted.success) {
      logger.info('FORM_SUBMITTED: Submit button clicked', {
        requestId,
        buttonText: submitted.buttonText
      });

      // Wait for navigation or confirmation after submission
      try {
        await Promise.race([
          page.waitForNavigation({ timeout: 30000, waitUntil: 'load' }),
          delay(5000) // Fallback timeout
        ]);
        logger.info('FORM_SUBMITTED: Post-submission navigation completed', { requestId });
      } catch (navError) {
        // Navigation timeout is acceptable - form may not navigate
        logger.info('FORM_SUBMITTED: No post-submission navigation detected', { requestId });
      }

      return true;
    }

    logger.error('No submit button found on the form', { requestId });
    return false;

  } catch (error) {
    if (error.message?.includes('Execution context was destroyed') ||
        error.message?.includes('context was destroyed') ||
        error.message?.includes('Target closed')) {
      logger.info('FORM_SUBMITTED: Submit triggered navigation (expected)', { requestId });
      return true;
    }
    logger.error('Form submission failed', { requestId, error: error.message });
    return false;
  }
}

module.exports = {
  fillRfqForm,
  cancelFormSubmission,
  submitForm,
  delay
};
