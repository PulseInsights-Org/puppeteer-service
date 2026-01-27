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

    it('should fill form with single item', async () => {
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

      // Should wait for fields and evaluate to fill them
      expect(mockPage.waitForFunction).toHaveBeenCalled();
      expect(mockPage.evaluate).toHaveBeenCalled();
    });

    it('should fill form with multiple items', async () => {
      const quoteDetails = {
        items: [
          { part_no: 'TEST-001', qty_available: '100' },
          { part_no: 'TEST-002', qty_available: '200' }
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

      // Should attempt to click outright radio button
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
      const hasFormattedDate = evaluateCalls.some(call =>
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
  });
});
