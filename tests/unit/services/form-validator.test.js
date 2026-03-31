/**
 * Unit tests for form-validator service
 */

jest.mock('../../../src/services/form-filler', () => ({
  fillRepeaterFieldBySuffix: jest.fn().mockResolvedValue(undefined),
  selectDropdownBySuffix: jest.fn().mockResolvedValue(undefined),
  clickElementBySuffix: jest.fn().mockResolvedValue(undefined),
  fillRfqForm: jest.fn(),
  cancelFormSubmission: jest.fn(),
  submitForm: jest.fn(),
  delay: jest.fn(),
}));

jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../../../src/utils/validation', () => ({
  formatTagDate: jest.fn((value) => {
    if (value === undefined || value === null) return undefined;
    const trimmed = String(value).trim();
    if (!trimmed) return undefined;
    return trimmed;
  }),
}));

const {
  validateAndCorrect,
  fetchValidatedQuoteData,
  readbackItemRow,
  compareFields,
  normalizePrice,
} = require('../../../src/services/form-validator');

const {
  fillRepeaterFieldBySuffix,
  selectDropdownBySuffix,
  clickElementBySuffix,
} = require('../../../src/services/form-filler');

const logger = require('../../../src/utils/logger');

describe('Form Validator Service', () => {
  let mockPage;
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();

    mockPage = {
      evaluate: jest.fn().mockResolvedValue({
        qty: '10',
        traceability: 'TRACE',
        uom: 'EA',
        price: '100.00',
        price_type: 'OUTRIGHT',
        lead_time: '5',
        tag_date: '01-15-2025',
        min_qty: '1',
        comments: '',
      }),
    };

    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  // ===========================================================================
  // normalizePrice
  // ===========================================================================
  describe('normalizePrice', () => {
    it('should return empty string for null', () => {
      expect(normalizePrice(null)).toBe('');
    });

    it('should return empty string for undefined', () => {
      expect(normalizePrice(undefined)).toBe('');
    });

    it('should strip dollar sign and return number string', () => {
      expect(normalizePrice('$100.00')).toBe('100');
    });

    it('should strip commas from price', () => {
      expect(normalizePrice('1,234.56')).toBe('1234.56');
    });

    it('should strip dollar sign and commas together', () => {
      expect(normalizePrice('$1,234.56')).toBe('1234.56');
    });

    it('should handle plain numeric string', () => {
      expect(normalizePrice('99.99')).toBe('99.99');
    });

    it('should handle number input', () => {
      expect(normalizePrice(100)).toBe('100');
    });

    it('should handle number with trailing zeros removed', () => {
      expect(normalizePrice('50.00')).toBe('50');
    });

    it('should handle integer number input', () => {
      expect(normalizePrice(250)).toBe('250');
    });

    it('should return cleaned string for non-numeric values', () => {
      expect(normalizePrice('N/A')).toBe('N/A');
    });

    it('should handle empty string', () => {
      expect(normalizePrice('')).toBe('');
    });

    it('should handle whitespace-only string', () => {
      expect(normalizePrice('   ')).toBe('');
    });

    it('should strip spaces around price', () => {
      expect(normalizePrice(' $100 ')).toBe('100');
    });

    it('should handle zero', () => {
      expect(normalizePrice('0')).toBe('0');
    });

    it('should handle zero as number', () => {
      expect(normalizePrice(0)).toBe('0');
    });

    it('should handle negative numbers', () => {
      expect(normalizePrice('-50.25')).toBe('-50.25');
    });

    it('should handle float number input', () => {
      expect(normalizePrice(12.5)).toBe('12.5');
    });
  });

  // ===========================================================================
  // compareFields
  // ===========================================================================
  describe('compareFields', () => {
    const baseExpected = {
      qty_available: '10',
      uom: 'EA',
      lead_time: '5',
      tag_date: '01-15-2025',
      min_qty: '1',
      traceability: 'TRACE',
      price_usd: '100.00',
    };

    const baseActual = {
      qty: '10',
      uom: 'EA',
      lead_time: '5',
      tag_date: '01-15-2025',
      min_qty: '1',
      traceability: 'TRACE',
      price: '100.00',
      price_type: 'OUTRIGHT',
      comments: '',
    };

    it('should return empty array when all fields match', () => {
      const result = compareFields(baseExpected, baseActual);
      expect(result).toEqual([]);
    });

    it('should detect qty mismatch', () => {
      const actual = { ...baseActual, qty: '5' };
      const result = compareFields(baseExpected, actual);
      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'qty_available', expected: '10', actual: '5' }),
        ])
      );
    });

    it('should detect uom mismatch', () => {
      const actual = { ...baseActual, uom: 'LB' };
      const result = compareFields(baseExpected, actual);
      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'uom', expected: 'EA', actual: 'LB' }),
        ])
      );
    });

    it('should detect price mismatch with normalization', () => {
      const expected = { ...baseExpected, price_usd: '$1,234.56' };
      const actual = { ...baseActual, price: '999.99' };
      const result = compareFields(expected, actual);
      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'price_usd', expected: '1234.56', actual: '999.99' }),
        ])
      );
    });

    it('should match prices after normalization (dollar sign and commas stripped)', () => {
      const expected = { ...baseExpected, price_usd: '$1,234.56' };
      const actual = { ...baseActual, price: '1234.56' };
      const result = compareFields(expected, actual);
      const priceMismatch = result.find((m) => m.field === 'price_usd');
      expect(priceMismatch).toBeUndefined();
    });

    it('should handle null actual values by reporting (empty)', () => {
      const actual = { ...baseActual, qty: null };
      const result = compareFields(baseExpected, actual);
      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'qty_available', expected: '10', actual: '(empty)' }),
        ])
      );
    });

    it('should handle null/undefined expected values by skipping comparison', () => {
      const expected = { ...baseExpected, qty_available: null };
      const result = compareFields(expected, baseActual);
      const qtyMismatch = result.find((m) => m.field === 'qty_available');
      expect(qtyMismatch).toBeUndefined();
    });

    it('should handle undefined expected values via falsy || empty string path', () => {
      const expected = { ...baseExpected, qty_available: undefined };
      const result = compareFields(expected, baseActual);
      const qtyMismatch = result.find((m) => m.field === 'qty_available');
      expect(qtyMismatch).toBeUndefined();
    });

    it('should only compare comments when expected has a value', () => {
      const expected = { ...baseExpected, comments: undefined };
      const actual = { ...baseActual, comments: 'some comment' };
      const result = compareFields(expected, actual);
      const commentsMismatch = result.find((m) => m.field === 'comments');
      expect(commentsMismatch).toBeUndefined();
    });

    it('should not add comments check when expected comments is falsy empty string', () => {
      const expected = { ...baseExpected, comments: '' };
      const actual = { ...baseActual, comments: 'some comment' };
      const result = compareFields(expected, actual);
      const commentsMismatch = result.find((m) => m.field === 'comments');
      expect(commentsMismatch).toBeUndefined();
    });

    it('should detect comments mismatch when expected has value', () => {
      const expected = { ...baseExpected, comments: 'expected comment' };
      const actual = { ...baseActual, comments: 'different comment' };
      const result = compareFields(expected, actual);
      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'comments',
            expected: 'expected comment',
            actual: 'different comment',
          }),
        ])
      );
    });

    it('should detect comments mismatch when actual is empty', () => {
      const expected = { ...baseExpected, comments: 'expected comment' };
      const actual = { ...baseActual, comments: '' };
      const result = compareFields(expected, actual);
      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'comments',
            expected: 'expected comment',
            actual: '(empty)',
          }),
        ])
      );
    });

    it('should only compare price_type when expected has a value', () => {
      const expected = { ...baseExpected, price_type: undefined };
      const actual = { ...baseActual, price_type: 'EXCHANGE' };
      const result = compareFields(expected, actual);
      const ptMismatch = result.find((m) => m.field === 'price_type');
      expect(ptMismatch).toBeUndefined();
    });

    it('should not add price_type check when expected price_type is falsy null', () => {
      const expected = { ...baseExpected, price_type: null };
      const actual = { ...baseActual, price_type: 'EXCHANGE' };
      const result = compareFields(expected, actual);
      const ptMismatch = result.find((m) => m.field === 'price_type');
      expect(ptMismatch).toBeUndefined();
    });

    it('should detect price_type mismatch', () => {
      const expected = { ...baseExpected, price_type: 'outright' };
      const actual = { ...baseActual, price_type: 'EXCHANGE' };
      const result = compareFields(expected, actual);
      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'price_type',
            expected: 'OUTRIGHT',
            actual: 'EXCHANGE',
          }),
        ])
      );
    });

    it('should match price_type case-insensitively (expected is uppercased)', () => {
      const expected = { ...baseExpected, price_type: 'exchange' };
      const actual = { ...baseActual, price_type: 'EXCHANGE' };
      const result = compareFields(expected, actual);
      const ptMismatch = result.find((m) => m.field === 'price_type');
      expect(ptMismatch).toBeUndefined();
    });

    it('should detect multiple mismatches at once', () => {
      const actual = { ...baseActual, qty: '99', uom: 'LB', lead_time: '30' };
      const result = compareFields(baseExpected, actual);
      expect(result.length).toBe(3);
      const fields = result.map((m) => m.field);
      expect(fields).toContain('qty_available');
      expect(fields).toContain('uom');
      expect(fields).toContain('lead_time');
    });

    it('should detect traceability mismatch', () => {
      const actual = { ...baseActual, traceability: 'OTHER' };
      const result = compareFields(baseExpected, actual);
      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'traceability', expected: 'TRACE', actual: 'OTHER' }),
        ])
      );
    });

    it('should detect tag_date mismatch', () => {
      const actual = { ...baseActual, tag_date: '12-31-2024' };
      const result = compareFields(baseExpected, actual);
      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'tag_date' }),
        ])
      );
    });

    it('should detect min_qty mismatch', () => {
      const actual = { ...baseActual, min_qty: '50' };
      const result = compareFields(baseExpected, actual);
      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'min_qty', expected: '1', actual: '50' }),
        ])
      );
    });

    it('should skip lead_time comparison when expected is empty/falsy', () => {
      const expected = { ...baseExpected, lead_time: '' };
      const actual = { ...baseActual, lead_time: '5' };
      const result = compareFields(expected, actual);
      const leadMismatch = result.find((m) => m.field === 'lead_time');
      expect(leadMismatch).toBeUndefined();
    });

    it('should skip min_qty comparison when expected is falsy zero (0 || "" = "")', () => {
      const expected = { ...baseExpected, min_qty: 0 };
      const actual = { ...baseActual, min_qty: '5' };
      const result = compareFields(expected, actual);
      // String(0 || '') = String('') = '', which is falsy -> skip comparison
      const minMismatch = result.find((m) => m.field === 'min_qty');
      expect(minMismatch).toBeUndefined();
    });

    it('should handle both price_usd null and actual price null', () => {
      const expected = { ...baseExpected, price_usd: null };
      const actual = { ...baseActual, price: null };
      const result = compareFields(expected, actual);
      const priceMismatch = result.find((m) => m.field === 'price_usd');
      expect(priceMismatch).toBeUndefined();
    });

    it('should handle price_type mismatch when actual is null', () => {
      const expected = { ...baseExpected, price_type: 'OUTRIGHT' };
      const actual = { ...baseActual, price_type: null };
      const result = compareFields(expected, actual);
      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'price_type', expected: 'OUTRIGHT', actual: '(empty)' }),
        ])
      );
    });

    it('should handle comments when actual is null and expected has value', () => {
      const expected = { ...baseExpected, comments: 'test' };
      const actual = { ...baseActual, comments: null };
      const result = compareFields(expected, actual);
      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'comments', expected: 'test', actual: '(empty)' }),
        ])
      );
    });

    it('should handle tag_date with null/undefined via formatTagDate returning undefined', () => {
      const expected = { ...baseExpected, tag_date: null };
      const actual = { ...baseActual, tag_date: '01-15-2025' };
      const result = compareFields(expected, actual);
      // formatTagDate(null) returns undefined, so expected becomes '', which is falsy -> skip
      const dateMismatch = result.find((m) => m.field === 'tag_date');
      expect(dateMismatch).toBeUndefined();
    });

    it('should handle traceability when expected is empty string', () => {
      const expected = { ...baseExpected, traceability: '' };
      const actual = { ...baseActual, traceability: 'TRACE' };
      const result = compareFields(expected, actual);
      // '' || '' = '', trim = '', falsy -> skip
      const traceMismatch = result.find((m) => m.field === 'traceability');
      expect(traceMismatch).toBeUndefined();
    });
  });

  // ===========================================================================
  // readbackItemRow
  // ===========================================================================
  describe('readbackItemRow', () => {
    it('should call page.evaluate with uppercase code and index', async () => {
      await readbackItemRow(mockPage, 'ne', 0);
      expect(mockPage.evaluate).toHaveBeenCalledTimes(1);
      const callArgs = mockPage.evaluate.mock.calls[0];
      expect(callArgs[1]).toEqual({ code: 'NE', index: 0 });
    });

    it('should pass correct index for different rows', async () => {
      await readbackItemRow(mockPage, 'SV', 3);
      const callArgs = mockPage.evaluate.mock.calls[0];
      expect(callArgs[1]).toEqual({ code: 'SV', index: 3 });
    });

    it('should return the result from page.evaluate', async () => {
      const expected = {
        qty: '5',
        traceability: 'TRACE',
        uom: 'EA',
        price: '200.00',
        price_type: 'EXCHANGE',
        lead_time: '10',
        tag_date: '03-20-2025',
        min_qty: '2',
        comments: 'test',
      };
      mockPage.evaluate.mockResolvedValue(expected);
      const result = await readbackItemRow(mockPage, 'NE', 1);
      expect(result).toEqual(expected);
    });

    it('should uppercase mixed-case condition codes', async () => {
      await readbackItemRow(mockPage, 'oH', 0);
      const callArgs = mockPage.evaluate.mock.calls[0];
      expect(callArgs[1]).toEqual({ code: 'OH', index: 0 });
    });

    it('should pass a function as first argument to page.evaluate', async () => {
      await readbackItemRow(mockPage, 'NE', 0);
      const callArgs = mockPage.evaluate.mock.calls[0];
      expect(typeof callArgs[0]).toBe('function');
    });
  });

  // ===========================================================================
  // fetchValidatedQuoteData
  // ===========================================================================
  describe('fetchValidatedQuoteData', () => {
    const items = [
      { part_no: 'ABC123', qty_available: '10', tag_date: '2025-01-15' },
      { part_no: 'DEF456', qty_available: '5', tag_date: '2025-01-15' },
    ];

    it('should call fetch with correct URL and payload', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ items: [], errors: [] }),
      });

      await fetchValidatedQuoteData(items, 'req-1');

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, options] = global.fetch.mock.calls[0];
      expect(url).toContain('validate-quote');
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toBe('application/json');

      const body = JSON.parse(options.body);
      expect(body.part_numbers).toEqual(['ABC123', 'DEF456']);
      expect(body.requested_quantities).toEqual({ ABC123: 10, DEF456: 5 });
      expect(body.tag_date).toBe('2025-01-15');
    });

    it('should return data on successful response', async () => {
      const responseData = { items: [{ part_no: 'ABC123', price_usd: '200' }], errors: [] };
      global.fetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(responseData),
      });

      const result = await fetchValidatedQuoteData(items, 'req-1');
      expect(result).toEqual(responseData);
    });

    it('should return null on non-ok response', async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: jest.fn().mockResolvedValue('Server Error'),
      });

      const result = await fetchValidatedQuoteData(items, 'req-1');
      expect(result).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        'validate-quote endpoint returned error',
        expect.objectContaining({ status: 500 })
      );
    });

    it('should return null on network failure', async () => {
      global.fetch.mockRejectedValue(new Error('Network timeout'));

      const result = await fetchValidatedQuoteData(items, 'req-1');
      expect(result).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        'validate-quote endpoint unreachable, falling back to payload',
        expect.objectContaining({ error: 'Network timeout' })
      );
    });

    it('should filter out no_quote items from partNumbers', async () => {
      const mixedItems = [
        { part_no: 'ABC123', qty_available: '10', tag_date: '2025-01-15' },
        { part_no: 'DEF456', qty_available: '5', no_quote: true },
      ];
      global.fetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ items: [] }),
      });

      await fetchValidatedQuoteData(mixedItems, 'req-1');
      const body = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(body.part_numbers).toEqual(['ABC123']);
    });

    it('should use first quotable items tag_date', async () => {
      const itemsNoDate = [
        { part_no: 'A', qty_available: '1', no_quote: true, tag_date: '2025-12-01' },
        { part_no: 'B', qty_available: '2', tag_date: '2025-06-15' },
      ];
      global.fetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ items: [] }),
      });

      await fetchValidatedQuoteData(itemsNoDate, 'req-1');
      const body = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(body.tag_date).toBe('2025-06-15');
    });

    it('should handle items without part_no', async () => {
      const itemsMissing = [
        { qty_available: '10', tag_date: '2025-01-15' },
        { part_no: 'ABC', qty_available: '5', tag_date: '2025-01-15' },
      ];
      global.fetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ items: [] }),
      });

      await fetchValidatedQuoteData(itemsMissing, 'req-1');
      const body = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(body.part_numbers).toEqual(['ABC']);
    });

    it('should default qty to 1 when qty_available is not a valid number', async () => {
      const itemsBadQty = [
        { part_no: 'X', qty_available: 'abc', tag_date: '2025-01-15' },
      ];
      global.fetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ items: [] }),
      });

      await fetchValidatedQuoteData(itemsBadQty, 'req-1');
      const body = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(body.requested_quantities).toEqual({ X: 1 });
    });

    it('should handle response.text() failure on error response', async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 502,
        text: jest.fn().mockRejectedValue(new Error('read failed')),
      });

      const result = await fetchValidatedQuoteData(items, 'req-1');
      expect(result).toBeNull();
    });

    it('should set tag_date to null when all items are no_quote (empty quotableItems)', async () => {
      const allNoQuote = [
        { part_no: 'A', qty_available: '1', no_quote: true, tag_date: '2025-12-01' },
      ];
      global.fetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ items: [] }),
      });

      await fetchValidatedQuoteData(allNoQuote, 'req-1');
      const body = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(body.tag_date).toBeNull();
      expect(body.part_numbers).toEqual([]);
    });

    it('should not add items without part_no to requestedQuantities', async () => {
      const itemsNoPart = [
        { qty_available: '10', tag_date: '2025-01-15' },
      ];
      global.fetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ items: [] }),
      });

      await fetchValidatedQuoteData(itemsNoPart, 'req-1');
      const body = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(body.requested_quantities).toEqual({});
    });

    it('should log info with correct partCount', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ items: [{ part_no: 'A' }], errors: ['e1'] }),
      });

      await fetchValidatedQuoteData(items, 'req-99');
      expect(logger.info).toHaveBeenCalledWith(
        'Calling validate-quote endpoint',
        expect.objectContaining({ requestId: 'req-99', partCount: 2 })
      );
      expect(logger.info).toHaveBeenCalledWith(
        'validate-quote response received',
        expect.objectContaining({ requestId: 'req-99', itemCount: 1, errors: 1 })
      );
    });

    it('should handle response with no items or errors keys', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({}),
      });

      const result = await fetchValidatedQuoteData(items, 'req-1');
      expect(result).toEqual({});
      expect(logger.info).toHaveBeenCalledWith(
        'validate-quote response received',
        expect.objectContaining({ itemCount: 0, errors: 0 })
      );
    });
  });

  // ===========================================================================
  // validateAndCorrect
  // ===========================================================================
  describe('validateAndCorrect', () => {
    const makeItem = (overrides = {}) => ({
      part_no: 'ABC123',
      item_number: '1',
      qty_available: '10',
      uom: 'EA',
      lead_time: '5',
      tag_date: '01-15-2025',
      min_qty: '1',
      traceability: 'TRACE',
      price_usd: '100',
      conditionCode: 'NE',
      ...overrides,
    });

    const makeMatchingActual = () => ({
      qty: '10',
      uom: 'EA',
      lead_time: '5',
      tag_date: '01-15-2025',
      min_qty: '1',
      traceability: 'TRACE',
      price: '100',
      price_type: null,
      comments: '',
    });

    beforeEach(() => {
      // Default: validate-quote endpoint fails -> fallback to payload
      global.fetch.mockRejectedValue(new Error('not available'));
    });

    it('should return pass with empty items', async () => {
      const report = await validateAndCorrect(mockPage, { items: [] }, 'req-1');
      expect(report.status).toBe('pass');
      expect(report.items_validated).toBe(0);
    });

    it('should return pass with undefined items', async () => {
      const report = await validateAndCorrect(mockPage, { items: undefined }, 'req-1');
      expect(report.status).toBe('pass');
    });

    it('should return pass with null items', async () => {
      const report = await validateAndCorrect(mockPage, { items: null }, 'req-1');
      expect(report.status).toBe('pass');
      expect(report.duration_ms).toBeGreaterThanOrEqual(0);
    });

    it('should pass on first check when all fields match', async () => {
      const item = makeItem();
      mockPage.evaluate.mockResolvedValue(makeMatchingActual());

      const report = await validateAndCorrect(mockPage, { items: [item] }, 'req-1');

      expect(report.status).toBe('pass');
      expect(report.source).toBe('payload');
      expect(report.mismatches_found).toEqual([]);
      expect(report.correction_attempts).toBe(0);
      expect(logger.info).toHaveBeenCalledWith(
        'Validation passed on first check',
        expect.any(Object)
      );
    });

    it('should detect mismatches and attempt correction', async () => {
      const item = makeItem();

      // First readback: mismatch
      mockPage.evaluate
        .mockResolvedValueOnce({ ...makeMatchingActual(), qty: '99' })
        // Second readback after correction: match
        .mockResolvedValueOnce(makeMatchingActual());

      const report = await validateAndCorrect(mockPage, { items: [item] }, 'req-1');

      expect(report.status).toBe('pass');
      expect(report.correction_attempts).toBe(1);
      expect(report.mismatches_found.length).toBe(1);
      expect(report.mismatches_found[0].corrected).toBe(true);
      expect(fillRepeaterFieldBySuffix).toHaveBeenCalledWith(
        mockPage,
        'txtNEQty1',
        0,
        '10'
      );
    });

    it('should fail after max retry attempts', async () => {
      const item = makeItem();

      // Always return mismatch
      mockPage.evaluate.mockResolvedValue({ ...makeMatchingActual(), qty: '99' });

      const report = await validateAndCorrect(mockPage, { items: [item] }, 'req-1', 2);

      expect(report.status).toBe('fail');
      expect(report.correction_attempts).toBe(2);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Validation FAILED'),
        expect.any(Object)
      );
    });

    it('should fallback to payload when validate-quote endpoint fails', async () => {
      global.fetch.mockRejectedValue(new Error('endpoint down'));
      const item = makeItem();
      mockPage.evaluate.mockResolvedValue(makeMatchingActual());

      const report = await validateAndCorrect(mockPage, { items: [item] }, 'req-1');
      expect(report.source).toBe('payload');
      expect(report.status).toBe('pass');
    });

    it('should use ingest_service source when validate-quote succeeds', async () => {
      const item = makeItem();
      const validatedData = {
        items: [
          { part_no: 'ABC123', price_usd: '200', qty_available: '10', uom: 'EA' },
        ],
      };
      global.fetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(validatedData),
      });
      mockPage.evaluate.mockResolvedValue({
        ...makeMatchingActual(),
        price: '200',
      });

      const report = await validateAndCorrect(mockPage, { items: [item] }, 'req-1');
      expect(report.source).toBe('ingest_service');
      expect(report.status).toBe('pass');
    });

    it('should skip no_quote items during validation', async () => {
      const items = [
        makeItem({ no_quote: true, item_number: '1' }),
        makeItem({ part_no: 'DEF456', item_number: '2' }),
      ];
      mockPage.evaluate.mockResolvedValue(makeMatchingActual());

      const report = await validateAndCorrect(mockPage, { items }, 'req-1');
      expect(report.status).toBe('pass');
      // Only the quotable item should trigger a readback
      expect(mockPage.evaluate).toHaveBeenCalledTimes(1);
    });

    it('should sort items by item_number before processing', async () => {
      const items = [
        makeItem({ item_number: '3', part_no: 'CCC' }),
        makeItem({ item_number: '1', part_no: 'AAA' }),
        makeItem({ item_number: '2', part_no: 'BBB' }),
      ];
      mockPage.evaluate.mockResolvedValue(makeMatchingActual());

      await validateAndCorrect(mockPage, { items }, 'req-1');
      expect(mockPage.evaluate).toHaveBeenCalledTimes(3);
    });

    it('should track form index per condition code', async () => {
      const items = [
        makeItem({ item_number: '1', conditionCode: 'NE' }),
        makeItem({ item_number: '2', conditionCode: 'NE' }),
        makeItem({ item_number: '3', conditionCode: 'SV' }),
      ];
      mockPage.evaluate.mockResolvedValue(makeMatchingActual());

      await validateAndCorrect(mockPage, { items }, 'req-1');

      // First NE item at index 0, second NE at index 1, SV at index 0
      const calls = mockPage.evaluate.mock.calls;
      expect(calls[0][1]).toEqual({ code: 'NE', index: 0 });
      expect(calls[1][1]).toEqual({ code: 'NE', index: 1 });
      expect(calls[2][1]).toEqual({ code: 'SV', index: 0 });
    });

    it('should default conditionCode to NE when not provided', async () => {
      const item = makeItem({ conditionCode: undefined });
      mockPage.evaluate.mockResolvedValue(makeMatchingActual());

      await validateAndCorrect(mockPage, { items: [item] }, 'req-1');
      expect(mockPage.evaluate.mock.calls[0][1]).toEqual({ code: 'NE', index: 0 });
    });

    it('should correct price_usd mismatch by calling fillRepeaterFieldBySuffix', async () => {
      const item = makeItem({ price_usd: '500' });
      mockPage.evaluate
        .mockResolvedValueOnce({ ...makeMatchingActual(), price: '100' })
        .mockResolvedValueOnce({ ...makeMatchingActual(), price: '500' });

      const report = await validateAndCorrect(mockPage, { items: [item] }, 'req-1');

      expect(report.status).toBe('pass');
      expect(fillRepeaterFieldBySuffix).toHaveBeenCalledWith(
        mockPage,
        'txtNEPrice1',
        0,
        '500'
      );
    });

    it('should correct traceability mismatch by calling selectDropdownBySuffix', async () => {
      const item = makeItem({ traceability: 'TRACE_NEW' });
      mockPage.evaluate
        .mockResolvedValueOnce({ ...makeMatchingActual(), traceability: 'TRACE_OLD' })
        .mockResolvedValueOnce({ ...makeMatchingActual(), traceability: 'TRACE_NEW' });

      const report = await validateAndCorrect(mockPage, { items: [item] }, 'req-1');

      expect(report.status).toBe('pass');
      expect(selectDropdownBySuffix).toHaveBeenCalledWith(
        mockPage,
        'ddlNETraceability1',
        0,
        'TRACE_NEW'
      );
    });

    it('should correct price_type mismatch by calling clickElementBySuffix', async () => {
      const item = makeItem({ price_type: 'exchange' });
      mockPage.evaluate
        .mockResolvedValueOnce({ ...makeMatchingActual(), price_type: 'OUTRIGHT' })
        .mockResolvedValueOnce({ ...makeMatchingActual(), price_type: 'EXCHANGE' });

      const report = await validateAndCorrect(mockPage, { items: [item] }, 'req-1');

      expect(report.status).toBe('pass');
      expect(clickElementBySuffix).toHaveBeenCalledWith(
        mockPage,
        'rbExchangeNE1',
        0
      );
    });

    it('should correct price_type outright by calling clickElementBySuffix with rbOutright suffix', async () => {
      const item = makeItem({ price_type: 'outright' });
      mockPage.evaluate
        .mockResolvedValueOnce({ ...makeMatchingActual(), price_type: 'EXCHANGE' })
        .mockResolvedValueOnce({ ...makeMatchingActual(), price_type: 'OUTRIGHT' });

      const report = await validateAndCorrect(mockPage, { items: [item] }, 'req-1');

      expect(report.status).toBe('pass');
      expect(clickElementBySuffix).toHaveBeenCalledWith(
        mockPage,
        'rbOutrightNE1',
        0
      );
    });

    it('should correct lead_time mismatch', async () => {
      const item = makeItem({ lead_time: '30' });
      mockPage.evaluate
        .mockResolvedValueOnce({ ...makeMatchingActual(), lead_time: '5' })
        .mockResolvedValueOnce({ ...makeMatchingActual(), lead_time: '30' });

      const report = await validateAndCorrect(mockPage, { items: [item] }, 'req-1');

      expect(fillRepeaterFieldBySuffix).toHaveBeenCalledWith(
        mockPage,
        'txtNELead1',
        0,
        '30'
      );
    });

    it('should correct tag_date mismatch with removeReadonly option', async () => {
      const item = makeItem({ tag_date: '03-20-2025' });
      mockPage.evaluate
        .mockResolvedValueOnce({ ...makeMatchingActual(), tag_date: '01-15-2025' })
        .mockResolvedValueOnce({ ...makeMatchingActual(), tag_date: '03-20-2025' });

      const report = await validateAndCorrect(mockPage, { items: [item] }, 'req-1');

      expect(fillRepeaterFieldBySuffix).toHaveBeenCalledWith(
        mockPage,
        'txtNEDate1',
        0,
        '03-20-2025',
        { removeReadonly: true }
      );
    });

    it('should correct min_qty mismatch', async () => {
      const item = makeItem({ min_qty: '50' });
      mockPage.evaluate
        .mockResolvedValueOnce({ ...makeMatchingActual(), min_qty: '1' })
        .mockResolvedValueOnce({ ...makeMatchingActual(), min_qty: '50' });

      const report = await validateAndCorrect(mockPage, { items: [item] }, 'req-1');

      expect(fillRepeaterFieldBySuffix).toHaveBeenCalledWith(
        mockPage,
        'txtNEMinQuantity1',
        0,
        '50'
      );
    });

    it('should correct uom mismatch', async () => {
      const item = makeItem({ uom: 'LB' });
      mockPage.evaluate
        .mockResolvedValueOnce({ ...makeMatchingActual(), uom: 'EA' })
        .mockResolvedValueOnce({ ...makeMatchingActual(), uom: 'LB' });

      const report = await validateAndCorrect(mockPage, { items: [item] }, 'req-1');

      expect(fillRepeaterFieldBySuffix).toHaveBeenCalledWith(
        mockPage,
        'txtNEUnitMeasure1',
        0,
        'LB'
      );
    });

    it('should correct comments mismatch', async () => {
      const item = makeItem({ comments: 'Updated comment' });
      mockPage.evaluate
        .mockResolvedValueOnce({ ...makeMatchingActual(), comments: 'Old comment' })
        .mockResolvedValueOnce({ ...makeMatchingActual(), comments: 'Updated comment' });

      const report = await validateAndCorrect(mockPage, { items: [item] }, 'req-1');

      expect(fillRepeaterFieldBySuffix).toHaveBeenCalledWith(
        mockPage,
        'txtNEComments1',
        0,
        'Updated comment'
      );
    });

    it('should include duration_ms in the report', async () => {
      const item = makeItem();
      mockPage.evaluate.mockResolvedValue(makeMatchingActual());

      const report = await validateAndCorrect(mockPage, { items: [item] }, 'req-1');
      expect(typeof report.duration_ms).toBe('number');
      expect(report.duration_ms).toBeGreaterThanOrEqual(0);
    });

    it('should report fields_checked count', async () => {
      const items = [makeItem({ item_number: '1' }), makeItem({ item_number: '2', part_no: 'DEF' })];
      mockPage.evaluate.mockResolvedValue(makeMatchingActual());

      const report = await validateAndCorrect(mockPage, { items }, 'req-1');
      // 9 fields per quotable item * 2 items = 18
      expect(report.fields_checked).toBe(18);
    });

    it('should use validated data merged with payload items when ingest service returns data', async () => {
      const item = makeItem({ price_usd: '100' });
      const validatedData = {
        items: [
          { part_no: 'ABC123', price_usd: '999' },
        ],
      };
      global.fetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(validatedData),
      });
      // DOM has price 999 matching the validated data
      mockPage.evaluate.mockResolvedValue({
        ...makeMatchingActual(),
        price: '999',
      });

      const report = await validateAndCorrect(mockPage, { items: [item] }, 'req-1');
      expect(report.source).toBe('ingest_service');
      expect(report.status).toBe('pass');
    });

    it('should fallback to payload when validate-quote returns empty items', async () => {
      const item = makeItem();
      global.fetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ items: [] }),
      });
      mockPage.evaluate.mockResolvedValue(makeMatchingActual());

      const report = await validateAndCorrect(mockPage, { items: [item] }, 'req-1');
      expect(report.source).toBe('payload');
    });

    it('should fallback to payload when validate-quote returns null', async () => {
      const item = makeItem();
      global.fetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(null),
      });
      mockPage.evaluate.mockResolvedValue(makeMatchingActual());

      const report = await validateAndCorrect(mockPage, { items: [item] }, 'req-1');
      expect(report.source).toBe('payload');
    });

    it('should handle no_quote items incrementing codeIndexMap without readback', async () => {
      const items = [
        makeItem({ item_number: '1', conditionCode: 'NE', no_quote: true }),
        makeItem({ item_number: '2', conditionCode: 'NE' }),
      ];
      mockPage.evaluate.mockResolvedValue(makeMatchingActual());

      await validateAndCorrect(mockPage, { items }, 'req-1');

      // The second NE item should use index 1 (because no_quote item took index 0)
      expect(mockPage.evaluate).toHaveBeenCalledTimes(1);
      expect(mockPage.evaluate.mock.calls[0][1]).toEqual({ code: 'NE', index: 1 });
    });

    it('should handle validated data with no_quote items excluded from lookup', async () => {
      const items = [
        makeItem({ item_number: '1', part_no: 'AAA' }),
        makeItem({ item_number: '2', part_no: 'BBB', no_quote: true }),
      ];
      const validatedData = {
        items: [
          { part_no: 'AAA', price_usd: '100' },
          { part_no: 'BBB', price_usd: '200', no_quote: true },
        ],
      };
      global.fetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(validatedData),
      });
      mockPage.evaluate.mockResolvedValue(makeMatchingActual());

      const report = await validateAndCorrect(mockPage, { items }, 'req-1');
      expect(report.source).toBe('ingest_service');
      // Only 1 readback (BBB is no_quote)
      expect(mockPage.evaluate).toHaveBeenCalledTimes(1);
    });

    it('should use maxAttempts parameter to limit corrections', async () => {
      const item = makeItem();
      // Always return mismatch
      mockPage.evaluate.mockResolvedValue({ ...makeMatchingActual(), qty: '99' });

      const report = await validateAndCorrect(mockPage, { items: [item] }, 'req-1', 1);

      expect(report.status).toBe('fail');
      expect(report.correction_attempts).toBe(1);
    });

    it('should handle multiple items with different condition codes during correction', async () => {
      const items = [
        makeItem({ item_number: '1', conditionCode: 'NE', uom: 'LB' }),
        makeItem({ item_number: '2', conditionCode: 'SV', uom: 'KG', part_no: 'DEF' }),
      ];

      // First pass: both mismatch
      mockPage.evaluate
        .mockResolvedValueOnce({ ...makeMatchingActual(), uom: 'EA' })
        .mockResolvedValueOnce({ ...makeMatchingActual(), uom: 'EA' })
        // After correction: both match
        .mockResolvedValueOnce({ ...makeMatchingActual(), uom: 'LB' })
        .mockResolvedValueOnce({ ...makeMatchingActual(), uom: 'KG' });

      const report = await validateAndCorrect(mockPage, { items }, 'req-1');

      expect(report.status).toBe('pass');
      expect(report.correction_attempts).toBe(1);
      expect(fillRepeaterFieldBySuffix).toHaveBeenCalledWith(
        mockPage, 'txtNEUnitMeasure1', 0, 'LB'
      );
      expect(fillRepeaterFieldBySuffix).toHaveBeenCalledWith(
        mockPage, 'txtSVUnitMeasure1', 0, 'KG'
      );
    });

    it('should skip no_quote items during correction phase too', async () => {
      const items = [
        makeItem({ item_number: '1', conditionCode: 'NE', no_quote: true }),
        makeItem({ item_number: '2', conditionCode: 'NE', uom: 'LB', part_no: 'DEF' }),
      ];

      // First pass: mismatch on the quotable item
      mockPage.evaluate
        .mockResolvedValueOnce({ ...makeMatchingActual(), uom: 'EA' })
        // After correction: match
        .mockResolvedValueOnce({ ...makeMatchingActual(), uom: 'LB' });

      const report = await validateAndCorrect(mockPage, { items }, 'req-1');

      expect(report.status).toBe('pass');
      expect(report.correction_attempts).toBe(1);
      // The correction should use index 1 (no_quote took index 0)
      expect(fillRepeaterFieldBySuffix).toHaveBeenCalledWith(
        mockPage, 'txtNEUnitMeasure1', 1, 'LB'
      );
    });

    it('should handle items without item_number for sorting', async () => {
      const items = [
        makeItem({ item_number: undefined, part_no: 'AAA' }),
        makeItem({ item_number: undefined, part_no: 'BBB' }),
      ];
      mockPage.evaluate.mockResolvedValue(makeMatchingActual());

      const report = await validateAndCorrect(mockPage, { items }, 'req-1');
      expect(report.status).toBe('pass');
      expect(mockPage.evaluate).toHaveBeenCalledTimes(2);
    });

    it('should record part_no as unknown when item has no part_no and mismatch occurs', async () => {
      const item = makeItem({ part_no: undefined });
      mockPage.evaluate
        .mockResolvedValueOnce({ ...makeMatchingActual(), qty: '99' })
        .mockResolvedValueOnce(makeMatchingActual());

      const report = await validateAndCorrect(mockPage, { items: [item] }, 'req-1');

      expect(report.mismatches_found[0].part_no).toBe('unknown');
    });

    it('should keep mismatches_found from first pass even after correction', async () => {
      const item = makeItem({ uom: 'LB' });
      mockPage.evaluate
        .mockResolvedValueOnce({ ...makeMatchingActual(), uom: 'EA' })
        .mockResolvedValueOnce({ ...makeMatchingActual(), uom: 'LB' });

      const report = await validateAndCorrect(mockPage, { items: [item] }, 'req-1');

      expect(report.mismatches_found.length).toBe(1);
      expect(report.mismatches_found[0].field).toBe('uom');
      expect(report.mismatches_found[0].corrected).toBe(true);
    });

    it('should not overwrite mismatches_found on subsequent attempts', async () => {
      const item = makeItem({ uom: 'LB', lead_time: '30' });
      // First pass: two mismatches
      mockPage.evaluate
        .mockResolvedValueOnce({ ...makeMatchingActual(), uom: 'EA', lead_time: '5' })
        // Second pass: still mismatching (will fail)
        .mockResolvedValueOnce({ ...makeMatchingActual(), uom: 'EA', lead_time: '5' })
        // Third pass (attempt 2): still mismatching
        .mockResolvedValueOnce({ ...makeMatchingActual(), uom: 'EA', lead_time: '5' });

      const report = await validateAndCorrect(mockPage, { items: [item] }, 'req-1', 2);

      expect(report.status).toBe('fail');
      // mismatches_found should be from the first pass
      expect(report.mismatches_found.length).toBe(2);
    });

    it('should handle validated data where some items have no part_no', async () => {
      const item = makeItem({ part_no: 'AAA' });
      const validatedData = {
        items: [
          { part_no: 'AAA', price_usd: '100' },
          { price_usd: '200' }, // no part_no - should be skipped in lookup
        ],
      };
      global.fetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(validatedData),
      });
      mockPage.evaluate.mockResolvedValue(makeMatchingActual());

      const report = await validateAndCorrect(mockPage, { items: [item] }, 'req-1');
      expect(report.source).toBe('ingest_service');
      expect(report.status).toBe('pass');
    });

    it('should keep original item when validated lookup has no match for that part_no', async () => {
      const item = makeItem({ part_no: 'AAA', price_usd: '100' });
      const validatedData = {
        items: [
          { part_no: 'ZZZ', price_usd: '999' }, // different part_no
        ],
      };
      global.fetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(validatedData),
      });
      mockPage.evaluate.mockResolvedValue(makeMatchingActual());

      const report = await validateAndCorrect(mockPage, { items: [item] }, 'req-1');
      expect(report.source).toBe('ingest_service');
      expect(report.status).toBe('pass');
    });

    it('should log warning with mismatch details on first pass', async () => {
      const item = makeItem();
      mockPage.evaluate
        .mockResolvedValueOnce({ ...makeMatchingActual(), qty: '99' })
        .mockResolvedValueOnce(makeMatchingActual());

      await validateAndCorrect(mockPage, { items: [item] }, 'req-1');

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('mismatch'),
        expect.objectContaining({
          requestId: 'req-1',
          mismatches: expect.arrayContaining([
            expect.objectContaining({ part: 'ABC123', field: 'qty_available' }),
          ]),
        })
      );
    });

    it('should log correction attempt info', async () => {
      const item = makeItem();
      mockPage.evaluate
        .mockResolvedValueOnce({ ...makeMatchingActual(), qty: '99' })
        .mockResolvedValueOnce(makeMatchingActual());

      await validateAndCorrect(mockPage, { items: [item] }, 'req-1');

      expect(logger.info).toHaveBeenCalledWith(
        'Correction attempt 1',
        expect.objectContaining({ requestId: 'req-1' })
      );
    });

    it('should log when validation passes after corrections', async () => {
      const item = makeItem();
      mockPage.evaluate
        .mockResolvedValueOnce({ ...makeMatchingActual(), qty: '99' })
        .mockResolvedValueOnce(makeMatchingActual());

      await validateAndCorrect(mockPage, { items: [item] }, 'req-1');

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('passed after'),
        expect.objectContaining({ requestId: 'req-1' })
      );
    });

    it('should use default maxAttempts of 2 when not specified', async () => {
      const item = makeItem();
      // Always mismatch
      mockPage.evaluate.mockResolvedValue({ ...makeMatchingActual(), qty: '99' });

      const report = await validateAndCorrect(mockPage, { items: [item] }, 'req-1');

      expect(report.status).toBe('fail');
      expect(report.correction_attempts).toBe(2);
    });

    it('should correct fields using the correct condition code suffix', async () => {
      const item = makeItem({ conditionCode: 'SV', uom: 'KG' });
      mockPage.evaluate
        .mockResolvedValueOnce({ ...makeMatchingActual(), uom: 'EA' })
        .mockResolvedValueOnce({ ...makeMatchingActual(), uom: 'KG' });

      await validateAndCorrect(mockPage, { items: [item] }, 'req-1');

      expect(fillRepeaterFieldBySuffix).toHaveBeenCalledWith(
        mockPage, 'txtSVUnitMeasure1', 0, 'KG'
      );
    });

    it('should handle maxAttempts of 0 (only one check, no corrections)', async () => {
      const item = makeItem();
      mockPage.evaluate.mockResolvedValue({ ...makeMatchingActual(), qty: '99' });

      const report = await validateAndCorrect(mockPage, { items: [item] }, 'req-1', 0);

      expect(report.status).toBe('fail');
      expect(report.correction_attempts).toBe(0);
    });

    it('should handle items_validated tracking the max index across attempts', async () => {
      const items = [
        makeItem({ item_number: '1' }),
        makeItem({ item_number: '2', part_no: 'DEF' }),
      ];
      mockPage.evaluate.mockResolvedValue(makeMatchingActual());

      const report = await validateAndCorrect(mockPage, { items }, 'req-1');
      expect(report.items_validated).toBe(2);
    });

    it('should return report with duration_ms even for empty items', async () => {
      const report = await validateAndCorrect(mockPage, { items: [] }, 'req-1');
      expect(typeof report.duration_ms).toBe('number');
      expect(report.duration_ms).toBeGreaterThanOrEqual(0);
    });

    it('should handle validated data where no_quote items in validated response are excluded from lookup', async () => {
      const items = [
        makeItem({ part_no: 'AAA', item_number: '1' }),
      ];
      const validatedData = {
        items: [
          { part_no: 'AAA', price_usd: '100', no_quote: true }, // no_quote in validated -> excluded from lookup
        ],
      };
      global.fetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(validatedData),
      });
      mockPage.evaluate.mockResolvedValue(makeMatchingActual());

      const report = await validateAndCorrect(mockPage, { items }, 'req-1');
      expect(report.source).toBe('ingest_service');
      // AAA is not no_quote in original items, but validated has no match (excluded),
      // so it falls back to the original item
    });

    it('should handle validated data with items missing part_no excluded from lookup', async () => {
      const items = [
        makeItem({ part_no: 'AAA' }),
      ];
      const validatedData = {
        items: [
          { price_usd: '100' }, // no part_no -> excluded from lookup
        ],
      };
      global.fetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(validatedData),
      });
      mockPage.evaluate.mockResolvedValue(makeMatchingActual());

      const report = await validateAndCorrect(mockPage, { items }, 'req-1');
      expect(report.source).toBe('ingest_service');
      expect(report.status).toBe('pass');
    });

    it('should log using ingest service source message', async () => {
      const item = makeItem();
      const validatedData = {
        items: [{ part_no: 'ABC123', price_usd: '100' }],
      };
      global.fetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(validatedData),
      });
      mockPage.evaluate.mockResolvedValue(makeMatchingActual());

      await validateAndCorrect(mockPage, { items: [item] }, 'req-1');

      expect(logger.info).toHaveBeenCalledWith(
        'Using ingest service as validation source',
        expect.objectContaining({ requestId: 'req-1' })
      );
    });

    it('should log fallback to payload warning', async () => {
      const item = makeItem();
      global.fetch.mockRejectedValue(new Error('down'));
      mockPage.evaluate.mockResolvedValue(makeMatchingActual());

      await validateAndCorrect(mockPage, { items: [item] }, 'req-1');

      expect(logger.warn).toHaveBeenCalledWith(
        'Falling back to payload as validation source',
        expect.objectContaining({ requestId: 'req-1' })
      );
    });
  });
});
