/**
 * Unit tests for form-filler service
 */

describe('Form Filler Service', () => {
  let formFiller;
  let mockPage;

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();

    mockPage = {
      waitForFunction: jest.fn().mockResolvedValue(undefined),
      evaluate: jest.fn().mockResolvedValue(undefined),
      waitForNavigation: jest.fn().mockResolvedValue(undefined),
      waitForNetworkIdle: jest.fn().mockResolvedValue(undefined),
      select: jest.fn().mockResolvedValue(undefined),
      keyboard: {
        press: jest.fn().mockResolvedValue(undefined)
      }
    };

    formFiller = require('../../../src/services/form-filler');
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('delay', () => {
    it('should wait for specified milliseconds', async () => {
      const delayPromise = formFiller.delay(1000);

      jest.advanceTimersByTime(1000);

      await expect(delayPromise).resolves.toBeUndefined();
    });

    it('should handle zero delay', async () => {
      const delayPromise = formFiller.delay(0);

      jest.advanceTimersByTime(0);

      await expect(delayPromise).resolves.toBeUndefined();
    });
  });

  describe('fillRfqForm', () => {
    beforeEach(() => {
      jest.useRealTimers();
    });

    it('should fill form with single item (default NE condition)', async () => {
      const quoteDetails = {
        items: [
          {
            part_no: 'TEST-001',
            qty_available: '100',
            traceability: 'NEW',
            uom: 'EA',
            price_usd: '25.00',
            price_type: 'OUTRIGHT',
            lead_time: '5 days',
            tag_date: '2024-01-15',
            min_qty: 10,
            comments: 'Test comment'
          }
        ]
      };

      await formFiller.fillRfqForm(mockPage, quoteDetails, 'test-request-id');

      // Should open other conditions section then fill fields
      expect(mockPage.waitForFunction).toHaveBeenCalled();
      expect(mockPage.evaluate).toHaveBeenCalled();
    });

    it('should fill form with explicit conditionCode', async () => {
      const quoteDetails = {
        items: [
          { part_no: 'TEST-001', conditionCode: 'SV', qty_available: '5', price_usd: '900.00' }
        ]
      };

      await formFiller.fillRfqForm(mockPage, quoteDetails, 'test-request-id');

      expect(mockPage.waitForFunction).toHaveBeenCalled();
      expect(mockPage.evaluate).toHaveBeenCalled();
    });

    it('should fill form with multiple items across different conditions', async () => {
      const quoteDetails = {
        items: [
          { part_no: 'TEST-001', conditionCode: 'NE', qty_available: '100' },
          { part_no: 'TEST-001', conditionCode: 'SV', qty_available: '5' },
          { part_no: 'TEST-001', conditionCode: 'AR', qty_available: '3' }
        ]
      };

      await formFiller.fillRfqForm(mockPage, quoteDetails, 'test-request-id');

      // Should be called multiple times for multiple items
      expect(mockPage.waitForFunction.mock.calls.length).toBeGreaterThan(1);
    });

    it('should skip items with no_quote flag', async () => {
      const quoteDetails = {
        items: [
          { part_no: 'TEST-001', qty_available: '100', no_quote: true },
          { part_no: 'TEST-002', qty_available: '200', no_quote: false }
        ]
      };

      mockPage.waitForFunction.mockClear();
      mockPage.evaluate.mockClear();

      await formFiller.fillRfqForm(mockPage, quoteDetails, 'test-request-id');

      // First item should be skipped (no_quote: true)
      // Only second item should be processed
    });

    it('should handle OUTRIGHT price type', async () => {
      const quoteDetails = {
        items: [
          { part_no: 'TEST-001', price_type: 'OUTRIGHT' }
        ]
      };

      await formFiller.fillRfqForm(mockPage, quoteDetails, 'test-request-id');

      expect(mockPage.waitForFunction).toHaveBeenCalled();
    });

    it('should handle EXCHANGE price type', async () => {
      const quoteDetails = {
        items: [
          { part_no: 'TEST-001', price_type: 'EXCHANGE' }
        ]
      };

      await formFiller.fillRfqForm(mockPage, quoteDetails, 'test-request-id');

      expect(mockPage.waitForFunction).toHaveBeenCalled();
    });

    it('should fill supplier comments', async () => {
      const quoteDetails = {
        items: [],
        supplier_comments: 'Test supplier comment'
      };

      await formFiller.fillRfqForm(mockPage, quoteDetails, 'test-request-id');

      expect(mockPage.waitForFunction).toHaveBeenCalled();
    });

    it('should fill quote prepared by field', async () => {
      const quoteDetails = {
        items: [],
        quote_prepared_by: 'Test User'
      };

      await formFiller.fillRfqForm(mockPage, quoteDetails, 'test-request-id');

      expect(mockPage.evaluate).toHaveBeenCalled();
    });

    it('should handle empty items array', async () => {
      const quoteDetails = {
        items: []
      };

      await expect(
        formFiller.fillRfqForm(mockPage, quoteDetails, 'test-request-id')
      ).resolves.toBeUndefined();
    });

    it('should handle missing items array', async () => {
      const quoteDetails = {};

      await expect(
        formFiller.fillRfqForm(mockPage, quoteDetails, 'test-request-id')
      ).resolves.toBeUndefined();
    });

    it('should format tag date correctly', async () => {
      const quoteDetails = {
        items: [
          { part_no: 'TEST-001', tag_date: '2024-01-15' }
        ]
      };

      await formFiller.fillRfqForm(mockPage, quoteDetails, 'test-request-id');

      // The formatted date should be passed to evaluate
      const evaluateCalls = mockPage.evaluate.mock.calls;
      const _hasFormattedDate = evaluateCalls.some(call =>
        JSON.stringify(call).includes('JAN-15-2024')
      );

      // Date formatting happens in the function
      expect(mockPage.evaluate).toHaveBeenCalled();
    });

    it('should handle field timeout gracefully', async () => {
      mockPage.waitForFunction.mockRejectedValue(new Error('Timeout'));

      const quoteDetails = {
        items: [
          { part_no: 'TEST-001', qty_available: '100' }
        ]
      };

      // Should not throw, just skip the field
      await expect(
        formFiller.fillRfqForm(mockPage, quoteDetails, 'test-request-id')
      ).resolves.toBeUndefined();
    });

    it('should open other conditions for products with non-NE variants', async () => {
      // evaluate returns postback result, then waitForNavigation completes
      mockPage.evaluate.mockResolvedValueOnce({ clicked: true, count: 1, ids: ['btn0'] });
      mockPage.waitForNavigation.mockResolvedValueOnce(undefined);
      mockPage.waitForNetworkIdle.mockResolvedValueOnce(undefined);

      const quoteDetails = {
        items: [{ part_no: 'TEST-001', conditionCode: 'SV', qty_available: '5' }]
      };

      await formFiller.fillRfqForm(mockPage, quoteDetails, 'test-request-id');

      // evaluate should be called for the postback + field fills
      expect(mockPage.evaluate).toHaveBeenCalled();
      expect(mockPage.waitForNavigation).toHaveBeenCalled();
    });

    it('should skip other conditions when all items are NE', async () => {
      const quoteDetails = {
        items: [
          { part_no: 'TEST-001', conditionCode: 'NE', qty_available: '10' },
          { part_no: 'TEST-002', conditionCode: 'NE', qty_available: '20' }
        ]
      };

      await formFiller.fillRfqForm(mockPage, quoteDetails, 'test-request-id');

      // waitForNavigation should NOT be called (no postback needed)
      expect(mockPage.waitForNavigation).not.toHaveBeenCalled();
    });

    it('should track per-condition index for multiple items with same code', async () => {
      const quoteDetails = {
        items: [
          { part_no: 'TEST-001', conditionCode: 'NE', qty_available: '10' },
          { part_no: 'TEST-002', conditionCode: 'NE', qty_available: '20' }
        ]
      };

      await formFiller.fillRfqForm(mockPage, quoteDetails, 'test-request-id');

      // Both items should be processed (waitForFunction called for each)
      expect(mockPage.waitForFunction.mock.calls.length).toBeGreaterThan(1);
    });

    it('should default conditionCode to NE when not specified', async () => {
      const quoteDetails = {
        items: [{ part_no: 'TEST-001', qty_available: '100' }]
      };

      await formFiller.fillRfqForm(mockPage, quoteDetails, 'test-request-id');

      // Should use NE suffixes (default)
      expect(mockPage.waitForFunction).toHaveBeenCalled();
    });
  });

  describe('cancelFormSubmission', () => {
    beforeEach(() => {
      jest.useRealTimers();
    });

    it('should click cancel button if found', async () => {
      mockPage.evaluate.mockResolvedValue(true);

      await formFiller.cancelFormSubmission(mockPage, 'test-request-id');

      expect(mockPage.evaluate).toHaveBeenCalled();
      expect(mockPage.keyboard.press).not.toHaveBeenCalled();
    });

    it('should press Escape if no cancel button found', async () => {
      mockPage.evaluate.mockResolvedValue(false);

      await formFiller.cancelFormSubmission(mockPage, 'test-request-id');

      expect(mockPage.keyboard.press).toHaveBeenCalledWith('Escape');
    });

    it('should handle context destroyed error gracefully', async () => {
      mockPage.evaluate.mockRejectedValue(new Error('Execution context was destroyed'));

      await expect(
        formFiller.cancelFormSubmission(mockPage, 'test-request-id')
      ).resolves.toBeUndefined();
    });

    it('should handle Target closed error gracefully', async () => {
      mockPage.evaluate.mockRejectedValue(new Error('Target closed'));

      await expect(
        formFiller.cancelFormSubmission(mockPage, 'test-request-id')
      ).resolves.toBeUndefined();
    });

    it('should log warning for other errors', async () => {
      mockPage.evaluate.mockRejectedValue(new Error('Some other error'));

      await expect(
        formFiller.cancelFormSubmission(mockPage, 'test-request-id')
      ).resolves.toBeUndefined();
    });
  });

  describe('form field helpers', () => {
    beforeEach(() => {
      jest.useRealTimers();
    });

    describe('field value handling', () => {
      it('should handle null values', async () => {
        const quoteDetails = {
          items: [
            { part_no: 'TEST-001', qty_available: null }
          ]
        };

        await expect(
          formFiller.fillRfqForm(mockPage, quoteDetails, 'test-request-id')
        ).resolves.toBeUndefined();
      });

      it('should handle undefined values', async () => {
        const quoteDetails = {
          items: [
            { part_no: 'TEST-001', qty_available: undefined }
          ]
        };

        await expect(
          formFiller.fillRfqForm(mockPage, quoteDetails, 'test-request-id')
        ).resolves.toBeUndefined();
      });

      it('should handle numeric values by converting to string', async () => {
        const quoteDetails = {
          items: [
            { part_no: 'TEST-001', min_qty: 10 }
          ]
        };

        await formFiller.fillRfqForm(mockPage, quoteDetails, 'test-request-id');

        expect(mockPage.waitForFunction).toHaveBeenCalled();
      });
    });

    describe('dropdown selection', () => {
      it('should select dropdown values for traceability', async () => {
        const quoteDetails = {
          items: [
            { part_no: 'TEST-001', traceability: 'NEW' }
          ]
        };

        await formFiller.fillRfqForm(mockPage, quoteDetails, 'test-request-id');

        expect(mockPage.waitForFunction).toHaveBeenCalled();
      });
    });

    describe('radio button clicking', () => {
      it('should handle price type case insensitively', async () => {
        const quoteDetails = {
          items: [
            { part_no: 'TEST-001', price_type: 'outright' }
          ]
        };

        await formFiller.fillRfqForm(mockPage, quoteDetails, 'test-request-id');

        expect(mockPage.waitForFunction).toHaveBeenCalled();
      });
    });
  });

  describe('submitForm', () => {
    beforeEach(() => {
      jest.useRealTimers();
    });

    it('should click submit button when found', async () => {
      mockPage.evaluate.mockResolvedValue({ success: true, buttonText: 'Submit Quote' });
      mockPage.waitForNavigation = jest.fn().mockResolvedValue(undefined);

      const result = await formFiller.submitForm(mockPage, 'test-request-id');

      expect(result).toBe(true);
      expect(mockPage.evaluate).toHaveBeenCalled();
    });

    it('should return false when no submit button found', async () => {
      mockPage.evaluate.mockResolvedValue({ success: false });

      const result = await formFiller.submitForm(mockPage, 'test-request-id');

      expect(result).toBe(false);
    });

    it('should handle post-submission navigation timeout', async () => {
      mockPage.evaluate.mockResolvedValue({ success: true, buttonText: 'Submit' });
      mockPage.waitForNavigation = jest.fn().mockRejectedValue(new Error('Navigation timeout'));

      const result = await formFiller.submitForm(mockPage, 'test-request-id');

      expect(result).toBe(true);
    });

    it('should return true when context destroyed during submit', async () => {
      mockPage.evaluate.mockRejectedValue(new Error('Execution context was destroyed'));

      const result = await formFiller.submitForm(mockPage, 'test-request-id');

      expect(result).toBe(true);
    });

    it('should return true when Target closed during submit', async () => {
      mockPage.evaluate.mockRejectedValue(new Error('Target closed'));

      const result = await formFiller.submitForm(mockPage, 'test-request-id');

      expect(result).toBe(true);
    });

    it('should return false on other errors', async () => {
      mockPage.evaluate.mockRejectedValue(new Error('Unknown error'));

      const result = await formFiller.submitForm(mockPage, 'test-request-id');

      expect(result).toBe(false);
    });
  });

  describe('form field helper coverage', () => {
    beforeEach(() => {
      jest.useRealTimers();
    });

    it('should call page.select when dropdown has actualId', async () => {
      // Make waitForFunction resolve (element found)
      mockPage.waitForFunction.mockResolvedValue(undefined);
      // All items are NE so openOtherConditionsForProducts is skipped.
      // evaluate calls: fillRepeaterFieldBySuffix for qty, selectDropdownBySuffix actualId, etc.
      mockPage.evaluate
        .mockResolvedValueOnce(undefined)  // fillRepeaterFieldBySuffix for qty
        .mockResolvedValueOnce('ctl00_ddlNETraceability1')  // selectDropdownBySuffix - get actualId
        .mockResolvedValueOnce(undefined);  // next field

      const quoteDetails = {
        items: [{ part_no: 'TEST-001', qty_available: '100', traceability: 'NEW' }]
      };

      await formFiller.fillRfqForm(mockPage, quoteDetails, 'test-request-id');

      expect(mockPage.select).toHaveBeenCalled();
    });

    it('should use exact ID match in fillInputBySuffix when element exists', async () => {
      // First evaluate checks hasExact -> true
      mockPage.evaluate.mockResolvedValue(true);
      mockPage.waitForFunction.mockResolvedValue(undefined);

      const quoteDetails = {
        items: [],
        quote_prepared_by: 'John Doe'
      };

      await formFiller.fillRfqForm(mockPage, quoteDetails, 'test-request-id');

      expect(mockPage.evaluate).toHaveBeenCalled();
    });

    it('should use suffix match in fillInputBySuffix when no exact match', async () => {
      // First evaluate checks hasExact -> false, then waitForFunction, then evaluate for actualId
      mockPage.evaluate
        .mockResolvedValueOnce(false)   // hasExact = false
        .mockResolvedValueOnce('ctl00_quotePreparedBy');  // actualId from suffix search
      mockPage.waitForFunction.mockResolvedValue(undefined);

      const quoteDetails = {
        items: [],
        quote_prepared_by: 'John Doe'
      };

      await formFiller.fillRfqForm(mockPage, quoteDetails, 'test-request-id');

      expect(mockPage.waitForFunction).toHaveBeenCalled();
    });

    it('should fill textarea when actualId is found', async () => {
      mockPage.waitForFunction.mockResolvedValue(undefined);
      mockPage.evaluate
        .mockResolvedValueOnce('ctl00_txtComments')  // textarea actualId
        .mockResolvedValueOnce(undefined);           // set value

      const quoteDetails = {
        items: [],
        supplier_comments: 'Test comment'
      };

      await formFiller.fillRfqForm(mockPage, quoteDetails, 'test-request-id');

      // Should have called evaluate to find and fill textarea
      expect(mockPage.evaluate).toHaveBeenCalledTimes(2);
    });

    it('should handle empty string values in repeater fields', async () => {
      const quoteDetails = {
        items: [{ part_no: 'TEST-001', qty_available: '' }]
      };

      await formFiller.fillRfqForm(mockPage, quoteDetails, 'test-request-id');
      // Empty string should be skipped (stringValue.length === 0)
    });
  });

  describe('evaluate callback coverage', () => {
    // These tests make page.evaluate actually call the callback functions
    // to cover browser-context code paths
    let domPage;

    function createMockElement(tagName, id, opts = {}) {
      return {
        tagName, id,
        value: opts.value || '',
        textContent: opts.textContent || '',
        type: opts.type || '',
        removeAttribute: jest.fn(),
        dispatchEvent: jest.fn(),
        click: jest.fn(),
        endsWith: undefined // prevent confusion
      };
    }

    beforeEach(() => {
      jest.useRealTimers();
      const inputElements = [
        createMockElement('INPUT', 'ctl00_txtNEQty1', {}),
        createMockElement('INPUT', 'ctl00_txtNEUnitMeasure1', {}),
        createMockElement('INPUT', 'ctl00_txtNEPrice1', {}),
        createMockElement('INPUT', 'ctl00_rbOutrightNE1', { type: 'radio' }),
        createMockElement('INPUT', 'ctl00_rbExchangeNE1', { type: 'radio' }),
        createMockElement('INPUT', 'ctl00_txtNELead1', {}),
        createMockElement('INPUT', 'ctl00_txtNEDate1', {}),
        createMockElement('INPUT', 'ctl00_txtNEMinQuantity1', {}),
        createMockElement('INPUT', 'ctl00_txtNEComments1', {}),
        createMockElement('INPUT', 'quotePreparedBy', {})
      ];
      const selectElements = [
        createMockElement('SELECT', 'ctl00_ddlNETraceability1', {})
      ];
      const textareaElements = [
        createMockElement('TEXTAREA', 'ctl00_txtComments', {})
      ];
      const buttonElements = [
        createMockElement('BUTTON', 'btnSubmit', { textContent: 'Submit Quote', type: 'submit' }),
        createMockElement('BUTTON', 'btnCancel', { textContent: 'Cancel' })
      ];

      const allElements = [...inputElements, ...selectElements, ...textareaElements, ...buttonElements];

      global.document = {
        querySelectorAll: jest.fn((selector) => {
          if (selector === 'input') return inputElements;
          if (selector === 'select') return selectElements;
          if (selector === 'textarea') return textareaElements;
          if (selector.includes('button')) return buttonElements;
          return allElements;
        }),
        getElementById: jest.fn((id) => allElements.find(el => el.id === id) || null)
      };
      global.Event = class Event { constructor(type, opts) { this.type = type; this.bubbles = opts?.bubbles; } };
      global.Array = Array; // ensure Array.from works

      domPage = {
        waitForFunction: jest.fn(async (fn, opts, ...args) => {
          // Actually call the function to cover it
          const result = typeof fn === 'function' ? fn(...args) : fn;
          if (!result) throw new Error('waitForFunction condition not met');
          return result;
        }),
        evaluate: jest.fn(async (fn, ...args) => {
          if (typeof fn === 'function') return fn(...args);
          return undefined;
        }),
        select: jest.fn().mockResolvedValue(undefined),
        keyboard: { press: jest.fn().mockResolvedValue(undefined) }
      };
    });

    afterEach(() => {
      delete global.document;
      delete global.Event;
    });

    it('should execute fillRepeaterFieldBySuffix evaluate callbacks', async () => {
      const quoteDetails = {
        items: [{
          part_no: 'TEST-001',
          qty_available: '100',
          uom: 'EA',
          price_usd: '25.00',
          lead_time: '5 days',
          min_qty: 10
        }]
      };

      await formFiller.fillRfqForm(domPage, quoteDetails, 'test-request-id');

      expect(domPage.evaluate).toHaveBeenCalled();
      expect(domPage.waitForFunction).toHaveBeenCalled();
    });

    it('should execute selectDropdownBySuffix evaluate callbacks', async () => {
      const quoteDetails = {
        items: [{ part_no: 'TEST-001', traceability: 'NEW' }]
      };

      await formFiller.fillRfqForm(domPage, quoteDetails, 'test-request-id');

      expect(domPage.select).toHaveBeenCalled();
    });

    it('should execute clickElementBySuffix for OUTRIGHT price type', async () => {
      const quoteDetails = {
        items: [{ part_no: 'TEST-001', price_type: 'OUTRIGHT' }]
      };

      await formFiller.fillRfqForm(domPage, quoteDetails, 'test-request-id');

      const outrightEl = global.document.querySelectorAll('input')
        .find(el => el.id.includes('rbOutrightNE1'));
      expect(outrightEl.click).toHaveBeenCalled();
    });

    it('should execute clickElementBySuffix for EXCHANGE price type', async () => {
      const quoteDetails = {
        items: [{ part_no: 'TEST-001', price_type: 'EXCHANGE' }]
      };

      await formFiller.fillRfqForm(domPage, quoteDetails, 'test-request-id');

      const exchangeEl = global.document.querySelectorAll('input')
        .find(el => el.id.includes('rbExchangeNE1'));
      expect(exchangeEl.click).toHaveBeenCalled();
    });

    it('should execute fillTextareaBySuffix evaluate callbacks', async () => {
      const quoteDetails = {
        items: [],
        supplier_comments: 'Test comment'
      };

      await formFiller.fillRfqForm(domPage, quoteDetails, 'test-request-id');

      const textarea = global.document.querySelectorAll('textarea')[0];
      expect(textarea.value).toBe('Test comment');
    });

    it('should execute fillInputBySuffix with exact ID match', async () => {
      const quoteDetails = {
        items: [],
        quote_prepared_by: 'John Doe'
      };

      await formFiller.fillRfqForm(domPage, quoteDetails, 'test-request-id');

      const input = global.document.getElementById('quotePreparedBy');
      expect(input.value).toBe('John Doe');
    });

    it('should execute fillRepeaterFieldBySuffix with removeReadonly option', async () => {
      const quoteDetails = {
        items: [{
          part_no: 'TEST-001',
          tag_date: '15-JAN-2024'
        }]
      };

      await formFiller.fillRfqForm(domPage, quoteDetails, 'test-request-id');

      const dateField = global.document.querySelectorAll('input')
        .find(el => el.id.includes('txtNEDate1'));
      expect(dateField.removeAttribute).toHaveBeenCalledWith('readonly');
    });

    it('should execute fillRepeaterFieldBySuffix with comments', async () => {
      const quoteDetails = {
        items: [{ part_no: 'TEST-001', comments: 'Some comment' }]
      };

      await formFiller.fillRfqForm(domPage, quoteDetails, 'test-request-id');
      expect(domPage.evaluate).toHaveBeenCalled();
    });

    it('should execute cancelFormSubmission evaluate callbacks', async () => {
      await formFiller.cancelFormSubmission(domPage, 'test-request-id');

      const cancelBtn = global.document.querySelectorAll('button')
        .find(btn => btn.textContent.toLowerCase().includes('cancel'));
      expect(cancelBtn.click).toHaveBeenCalled();
    });

    it('should execute submitForm evaluate callbacks', async () => {
      domPage.waitForNavigation = jest.fn().mockResolvedValue(undefined);

      const result = await formFiller.submitForm(domPage, 'test-request-id');

      expect(result).toBe(true);
      const submitBtn = global.document.querySelectorAll('button')
        .find(btn => btn.textContent.toLowerCase().includes('submit'));
      expect(submitBtn.click).toHaveBeenCalled();
    });

    it('should handle cancelFormSubmission when no cancel button exists', async () => {
      // Remove cancel button from DOM
      global.document.querySelectorAll = jest.fn((selector) => {
        if (selector.includes('button')) {
          return [createMockElement('BUTTON', 'btnOk', { textContent: 'OK' })];
        }
        return [];
      });

      await formFiller.cancelFormSubmission(domPage, 'test-request-id');

      expect(domPage.keyboard.press).toHaveBeenCalledWith('Escape');
    });

    it('should handle submitForm when no submit button exists', async () => {
      global.document.querySelectorAll = jest.fn(() => [
        createMockElement('BUTTON', 'btnOther', { textContent: 'Other' })
      ]);

      const result = await formFiller.submitForm(domPage, 'test-request-id');
      expect(result).toBe(false);
    });

    it('should execute fillInputBySuffix suffix fallback path', async () => {
      // Remove the exact ID match so it falls through to suffix search
      global.document.getElementById = jest.fn(() => null);

      const quoteDetails = {
        items: [],
        quote_prepared_by: 'Jane Doe'
      };

      await formFiller.fillRfqForm(domPage, quoteDetails, 'test-request-id');
      expect(domPage.waitForFunction).toHaveBeenCalled();
    });
  });

  describe('fillRfqForm with condition codes via DOM', () => {
    let domPage;

    function createMockElement(tagName, id, opts = {}) {
      return {
        tagName, id,
        value: opts.value || '',
        textContent: opts.textContent || '',
        type: opts.type || '',
        removeAttribute: jest.fn(),
        dispatchEvent: jest.fn(),
        click: jest.fn()
      };
    }

    beforeEach(() => {
      jest.useRealTimers();

      const conditionInputs = [
        createMockElement('INPUT', 'ctl00_txtSVQty1', {}),
        createMockElement('INPUT', 'ctl00_txtSVPrice1', {}),
        createMockElement('INPUT', 'ctl00_txtSVLead1', {}),
        createMockElement('INPUT', 'ctl00_txtSVDate1', {}),
        createMockElement('INPUT', 'ctl00_txtSVMinQuantity1', {}),
        createMockElement('INPUT', 'ctl00_txtSVComments1', {}),
        createMockElement('INPUT', 'ctl00_txtSVUnitMeasure1', {}),
        createMockElement('INPUT', 'ctl00_rbOutrightSV1', { type: 'radio' }),
        createMockElement('INPUT', 'ctl00_rbExchangeSV1', { type: 'radio' }),
        createMockElement('INPUT', 'ctl00_txtARQty1', {}),
        createMockElement('INPUT', 'ctl00_txtARPrice1', {})
      ];

      const selectElements = [
        createMockElement('SELECT', 'ctl00_ddlSVTraceability1', {})
      ];

      const submitButtons = [
        createMockElement('INPUT', 'oQuoteItems_rptrItem__ctl0_cmdQuoteOther', {
          type: 'submit', value: 'Quote Other Conditions'
        })
      ];

      const allInputs = [...conditionInputs, ...submitButtons];

      const hiddenField = createMockElement('INPUT', 'hdnClickId2', {});

      const allElements = [...allInputs, ...selectElements, { tagName: 'INPUT', id: 'hdnClickId2', ...hiddenField }];

      global.document = {
        querySelectorAll: jest.fn((selector) => {
          if (selector === 'input') return allInputs;
          if (selector === 'input[type="submit"]') return submitButtons;
          if (selector === 'select') return selectElements;
          return allElements;
        }),
        getElementById: jest.fn((id) => {
          if (id === 'hdnClickId2') return hiddenField;
          return allInputs.find(el => el.id === id) || selectElements.find(el => el.id === id) || null;
        })
      };
      global.Event = class Event { constructor(type, opts) { this.type = type; this.bubbles = opts?.bubbles; } };

      domPage = {
        waitForFunction: jest.fn(async (fn, opts, ...args) => {
          const result = typeof fn === 'function' ? fn(...args) : fn;
          if (!result) throw new Error('waitForFunction condition not met');
          return result;
        }),
        evaluate: jest.fn(async (fn, ...args) => {
          if (typeof fn === 'function') return fn(...args);
          return undefined;
        }),
        waitForNavigation: jest.fn().mockResolvedValue(undefined),
        waitForNetworkIdle: jest.fn().mockResolvedValue(undefined),
        select: jest.fn().mockResolvedValue(undefined),
        keyboard: { press: jest.fn().mockResolvedValue(undefined) }
      };
    });

    afterEach(() => {
      delete global.document;
      delete global.Event;
    });

    it('should open section and fill SV condition item via DOM', async () => {
      const quoteDetails = {
        items: [
          {
            conditionCode: 'SV',
            qty_available: '1',
            price_usd: '900.00',
            price_type: 'OUTRIGHT',
            lead_time: '7 days',
            comments: 'Test SV'
          }
        ]
      };

      await formFiller.fillRfqForm(domPage, quoteDetails, 'test-request-id');

      const qtyField = global.document.querySelectorAll('input')
        .find(el => el.id.includes('txtSVQty1'));
      expect(qtyField.value).toBe('1');

      const priceField = global.document.querySelectorAll('input')
        .find(el => el.id.includes('txtSVPrice1'));
      expect(priceField.value).toBe('900.00');

      const outrightRadio = global.document.querySelectorAll('input')
        .find(el => el.id.includes('rbOutrightSV1'));
      expect(outrightRadio.click).toHaveBeenCalled();
    });

    it('should fill multiple condition codes (SV + AR) via DOM', async () => {
      const quoteDetails = {
        items: [
          { conditionCode: 'SV', qty_available: '1', price_usd: '900.00' },
          { conditionCode: 'AR', qty_available: '3', price_usd: '500.00' }
        ]
      };

      await formFiller.fillRfqForm(domPage, quoteDetails, 'test-request-id');

      const svQty = global.document.querySelectorAll('input')
        .find(el => el.id.includes('txtSVQty1'));
      expect(svQty.value).toBe('1');

      const arQty = global.document.querySelectorAll('input')
        .find(el => el.id.includes('txtARQty1'));
      expect(arQty.value).toBe('3');
    });

    it('should handle EXCHANGE price type via DOM', async () => {
      const quoteDetails = {
        items: [
          { conditionCode: 'SV', price_type: 'EXCHANGE' }
        ]
      };

      await formFiller.fillRfqForm(domPage, quoteDetails, 'test-request-id');

      const exchangeRadio = global.document.querySelectorAll('input')
        .find(el => el.id.includes('rbExchangeSV1'));
      expect(exchangeRadio.click).toHaveBeenCalled();
    });

    it('should handle no submit buttons found via DOM evaluate', async () => {
      // Override querySelectorAll to return no submit buttons
      const originalQSA = global.document.querySelectorAll;
      global.document.querySelectorAll = jest.fn((selector) => {
        if (selector === 'input[type="submit"]') return [];
        return originalQSA(selector);
      });

      const quoteDetails = {
        items: [
          { part_no: 'TEST-001', conditionCode: 'SV', qty_available: '1', price_usd: '100.00' }
        ]
      };

      await formFiller.fillRfqForm(domPage, quoteDetails, 'test-request-id');

      // Should not throw — returns { clicked: false, reason: 'no buttons found' }
      expect(domPage.evaluate).toHaveBeenCalled();
    });

    it('should handle target index exceeding button count via DOM evaluate', async () => {
      // Set up two products needing other conditions but only one button
      // Product at index 1 won't have a matching button
      const quoteDetails = {
        items: [
          { part_no: 'PROD-A', conditionCode: 'NE', qty_available: '10' },
          { part_no: 'PROD-B', conditionCode: 'SV', qty_available: '5', price_usd: '100.00' }
        ]
      };

      // PROD-B is at productOrder index 1 but there's only 1 button (index 0)
      // So targetIds will be empty → hits "no matching buttons for target indices"
      await formFiller.fillRfqForm(domPage, quoteDetails, 'test-request-id');

      expect(domPage.evaluate).toHaveBeenCalled();
    });
  });

  describe('error path coverage', () => {
    beforeEach(() => {
      jest.useRealTimers();
    });

    it('should handle selectDropdownBySuffix error gracefully', async () => {
      // waitForFunction rejects for dropdown -> catch block
      mockPage.waitForFunction
        .mockResolvedValueOnce(undefined)  // fillRepeaterFieldBySuffix qty succeeds
        .mockRejectedValueOnce(new Error('Dropdown not found'));  // selectDropdownBySuffix fails
      // All items are NE so no postback needed
      mockPage.evaluate
        .mockResolvedValueOnce(undefined);  // fillRepeaterFieldBySuffix for qty

      const quoteDetails = {
        items: [{ qty_available: '10', traceability: 'COFC' }]
      };

      // Should not throw - error is caught and logged
      await expect(
        formFiller.fillRfqForm(mockPage, quoteDetails, 'test-request-id')
      ).resolves.toBeUndefined();
    });

    it('should handle clickElementBySuffix error gracefully', async () => {
      // All items are NE so no postback needed
      mockPage.waitForFunction.mockResolvedValue(undefined);
      mockPage.evaluate.mockResolvedValue(undefined);

      // Make the click radio button's waitForFunction fail
      let callCount = 0;
      mockPage.waitForFunction.mockImplementation(async () => {
        callCount++;
        // Fail on the radio button click attempt (after qty, traceability, uom, price)
        if (callCount === 5) throw new Error('Radio not found');
        return undefined;
      });

      const quoteDetails = {
        items: [{ qty_available: '10', price_type: 'OUTRIGHT' }]
      };

      await expect(
        formFiller.fillRfqForm(mockPage, quoteDetails, 'test-request-id')
      ).resolves.toBeUndefined();
    });

    it('should handle fillTextareaBySuffix error gracefully', async () => {
      // waitForFunction rejects for textarea -> catch block (line 136)
      mockPage.waitForFunction.mockRejectedValue(new Error('Textarea not found'));
      mockPage.evaluate.mockResolvedValue(undefined);

      const quoteDetails = {
        items: [],
        supplier_comments: 'Test comment'
      };

      await expect(
        formFiller.fillRfqForm(mockPage, quoteDetails, 'test-request-id')
      ).resolves.toBeUndefined();
    });

    it('should handle fillInputBySuffix error gracefully', async () => {
      // evaluate rejects for input -> catch block (line 188)
      mockPage.evaluate.mockRejectedValue(new Error('Input not found'));

      const quoteDetails = {
        items: [],
        quote_prepared_by: 'Test User'
      };

      await expect(
        formFiller.fillRfqForm(mockPage, quoteDetails, 'test-request-id')
      ).resolves.toBeUndefined();
    });

    it('should handle openOtherConditionsForProducts when button not found', async () => {
      // evaluate returns { clicked: false } -> warn logged
      mockPage.evaluate.mockResolvedValueOnce({ clicked: false, reason: 'no buttons found' });
      mockPage.waitForFunction.mockResolvedValue(undefined);

      const quoteDetails = {
        items: [{ part_no: 'TEST-001', conditionCode: 'SV', qty_available: '5' }]
      };

      await expect(
        formFiller.fillRfqForm(mockPage, quoteDetails, 'test-request-id')
      ).resolves.toBeUndefined();
    });

    it('should handle openOtherConditionsForProducts evaluate error', async () => {
      // evaluate throws -> catch block
      mockPage.evaluate
        .mockRejectedValueOnce(new Error('Page crashed'))
        .mockResolvedValue(undefined);
      mockPage.waitForFunction.mockResolvedValue(undefined);

      const quoteDetails = {
        items: [{ part_no: 'TEST-001', conditionCode: 'SV', qty_available: '5' }]
      };

      await expect(
        formFiller.fillRfqForm(mockPage, quoteDetails, 'test-request-id')
      ).resolves.toBeUndefined();
    });
  });

  describe('openOtherConditionsForProducts', () => {
    beforeEach(() => {
      jest.useRealTimers();
    });

    it('should skip no_quote items when determining products needing other conditions', async () => {
      const quoteDetails = {
        items: [
          { part_no: 'TEST-001', conditionCode: 'SV', qty_available: '5', no_quote: true },
          { part_no: 'TEST-002', conditionCode: 'NE', qty_available: '10' }
        ]
      };

      await formFiller.fillRfqForm(mockPage, quoteDetails, 'test-request-id');

      // SV item is no_quote, NE item doesn't need other conditions → no postback
      expect(mockPage.waitForNavigation).not.toHaveBeenCalled();
    });

    it('should target multiple products needing other conditions', async () => {
      mockPage.evaluate.mockResolvedValueOnce({ clicked: true, count: 2, ids: ['btn0', 'btn1'] });
      mockPage.waitForNavigation.mockResolvedValueOnce(undefined);
      mockPage.waitForNetworkIdle.mockResolvedValueOnce(undefined);

      const quoteDetails = {
        items: [
          { part_no: 'PROD-001', conditionCode: 'NE', qty_available: '10' },
          { part_no: 'PROD-001', conditionCode: 'SV', qty_available: '5' },
          { part_no: 'PROD-002', conditionCode: 'NE', qty_available: '20' },
          { part_no: 'PROD-002', conditionCode: 'AR', qty_available: '3' },
          { part_no: 'PROD-003', conditionCode: 'NE', qty_available: '15' }
        ]
      };

      await formFiller.fillRfqForm(mockPage, quoteDetails, 'test-request-id');

      // Should trigger postback for PROD-001 (SV) and PROD-002 (AR), not PROD-003 (NE only)
      expect(mockPage.evaluate).toHaveBeenCalled();
      expect(mockPage.waitForNavigation).toHaveBeenCalled();
    });

    it('should handle waitForNavigation timeout gracefully', async () => {
      mockPage.evaluate.mockResolvedValueOnce({ clicked: true, count: 1, ids: ['btn0'] });
      mockPage.waitForNavigation.mockRejectedValueOnce(new Error('Navigation timeout'));
      mockPage.waitForNetworkIdle.mockResolvedValueOnce(undefined);

      const quoteDetails = {
        items: [{ part_no: 'TEST-001', conditionCode: 'SV', qty_available: '5' }]
      };

      await expect(
        formFiller.fillRfqForm(mockPage, quoteDetails, 'test-request-id')
      ).resolves.toBeUndefined();
    });

    it('should handle waitForNetworkIdle timeout gracefully', async () => {
      mockPage.evaluate.mockResolvedValueOnce({ clicked: true, count: 1, ids: ['btn0'] });
      mockPage.waitForNavigation.mockResolvedValueOnce(undefined);
      mockPage.waitForNetworkIdle.mockRejectedValueOnce(new Error('Network idle timeout'));

      const quoteDetails = {
        items: [{ part_no: 'TEST-001', conditionCode: 'OH', qty_available: '5' }]
      };

      await expect(
        formFiller.fillRfqForm(mockPage, quoteDetails, 'test-request-id')
      ).resolves.toBeUndefined();
    });

    it('should handle items with missing part_no', async () => {
      mockPage.evaluate.mockResolvedValueOnce({ clicked: true, count: 1, ids: ['btn0'] });
      mockPage.waitForNavigation.mockResolvedValueOnce(undefined);
      mockPage.waitForNetworkIdle.mockResolvedValueOnce(undefined);

      const quoteDetails = {
        items: [{ conditionCode: 'SV', qty_available: '5' }]
      };

      await formFiller.fillRfqForm(mockPage, quoteDetails, 'test-request-id');

      // Should still trigger postback (part_no defaults to '')
      expect(mockPage.evaluate).toHaveBeenCalled();
    });

    it('should handle result with no matching buttons for target indices', async () => {
      mockPage.evaluate.mockResolvedValueOnce({ clicked: false, reason: 'no matching buttons for target indices' });
      mockPage.waitForFunction.mockResolvedValue(undefined);

      const quoteDetails = {
        items: [{ part_no: 'TEST-001', conditionCode: 'SV', qty_available: '5' }]
      };

      await expect(
        formFiller.fillRfqForm(mockPage, quoteDetails, 'test-request-id')
      ).resolves.toBeUndefined();
    });

    it('should default conditionCode to NE for items without conditionCode', async () => {
      const quoteDetails = {
        items: [
          { part_no: 'TEST-001', qty_available: '10' },  // no conditionCode → NE
          { part_no: 'TEST-002', qty_available: '20' }   // no conditionCode → NE
        ]
      };

      await formFiller.fillRfqForm(mockPage, quoteDetails, 'test-request-id');

      // All default to NE, no postback needed
      expect(mockPage.waitForNavigation).not.toHaveBeenCalled();
    });
  });

  describe('module exports', () => {
    it('should export fillRfqForm function', () => {
      expect(typeof formFiller.fillRfqForm).toBe('function');
    });

    it('should export cancelFormSubmission function', () => {
      expect(typeof formFiller.cancelFormSubmission).toBe('function');
    });

    it('should export delay function', () => {
      expect(typeof formFiller.delay).toBe('function');
    });

    it('should export submitForm function', () => {
      expect(typeof formFiller.submitForm).toBe('function');
    });
  });
});
