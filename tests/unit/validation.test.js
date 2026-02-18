/**
 * Unit tests for validation utility
 */

const { validateRfqRequest, formatTagDate, VALID_CONDITION_CODES } = require('../../src/utils/validation');

describe('Validation Utility', () => {
  describe('validateRfqRequest', () => {
    describe('body validation', () => {
      it('should return error when body is null', () => {
        const errors = validateRfqRequest(null);
        expect(errors).toContain('Request body is required');
      });

      it('should return error when body is undefined', () => {
        const errors = validateRfqRequest(undefined);
        expect(errors).toContain('Request body is required');
      });

      it('should return error when body is empty object', () => {
        const errors = validateRfqRequest({});
        expect(errors).toContain('rfq_details is required');
        expect(errors).toContain('quote_details is required');
      });
    });

    describe('rfq_details validation', () => {
      it('should return error when rfq_details is missing', () => {
        const errors = validateRfqRequest({ quote_details: {} });
        expect(errors).toContain('rfq_details is required');
      });

      it('should return error when quote_submission_url is missing', () => {
        const errors = validateRfqRequest({
          rfq_details: {},
          quote_details: {}
        });
        expect(errors).toContain('rfq_details.quote_submission_url is required');
      });

      it('should return error for invalid URL format', () => {
        const errors = validateRfqRequest({
          rfq_details: { quote_submission_url: 'not-a-url' },
          quote_details: {}
        });
        expect(errors).toContain('rfq_details.quote_submission_url must be a valid URL');
      });

      it('should return error for non-http/https protocol', () => {
        const errors = validateRfqRequest({
          rfq_details: { quote_submission_url: 'ftp://example.com/form' },
          quote_details: {}
        });
        expect(errors).toContain('rfq_details.quote_submission_url must use http or https protocol');
      });

      it('should accept valid http URL', () => {
        const errors = validateRfqRequest({
          rfq_details: { quote_submission_url: 'http://example.com/form' },
          quote_details: {}
        });
        expect(errors).not.toContain('rfq_details.quote_submission_url must be a valid URL');
        expect(errors).not.toContain('rfq_details.quote_submission_url must use http or https protocol');
      });

      it('should accept valid https URL', () => {
        const errors = validateRfqRequest({
          rfq_details: { quote_submission_url: 'https://example.com/form' },
          quote_details: {}
        });
        expect(errors).not.toContain('rfq_details.quote_submission_url must be a valid URL');
        expect(errors).not.toContain('rfq_details.quote_submission_url must use http or https protocol');
      });
    });

    describe('quote_details validation', () => {
      it('should return error when quote_details is missing', () => {
        const errors = validateRfqRequest({
          rfq_details: { quote_submission_url: 'https://example.com/form' }
        });
        expect(errors).toContain('quote_details is required');
      });

      it('should return error when items is not an array', () => {
        const errors = validateRfqRequest({
          rfq_details: { quote_submission_url: 'https://example.com/form' },
          quote_details: { items: 'not-an-array' }
        });
        expect(errors).toContain('quote_details.items must be an array');
      });

      it('should accept valid items array', () => {
        const errors = validateRfqRequest({
          rfq_details: { quote_submission_url: 'https://example.com/form' },
          quote_details: { items: [] }
        });
        expect(errors).not.toContain('quote_details.items must be an array');
      });

      it('should accept quote_details without items', () => {
        const errors = validateRfqRequest({
          rfq_details: { quote_submission_url: 'https://example.com/form' },
          quote_details: {}
        });
        expect(errors).toHaveLength(0);
      });
    });

    describe('conditionCode in items validation', () => {
      const validBase = {
        rfq_details: { quote_submission_url: 'https://example.com/form' },
        quote_details: {}
      };

      it('should accept items without conditionCode (defaults to NE)', () => {
        const errors = validateRfqRequest({
          ...validBase,
          quote_details: {
            items: [{ qty_available: '10', price_usd: '25.00' }]
          }
        });
        expect(errors).toHaveLength(0);
      });

      it('should accept items with valid conditionCode', () => {
        const errors = validateRfqRequest({
          ...validBase,
          quote_details: {
            items: [
              { conditionCode: 'NE', qty_available: '2', price_usd: '1500.00' },
              { conditionCode: 'SV', qty_available: '1', price_usd: '900.00' }
            ]
          }
        });
        expect(errors).toHaveLength(0);
      });

      it('should return error for invalid conditionCode', () => {
        const errors = validateRfqRequest({
          ...validBase,
          quote_details: {
            items: [{ conditionCode: 'XX', qty_available: '5' }]
          }
        });
        expect(errors).toContain('quote_details.items[0].conditionCode must be one of: NE, NS, OH, SV, AR');
      });

      it('should validate multiple items and report correct indices', () => {
        const errors = validateRfqRequest({
          ...validBase,
          quote_details: {
            items: [
              { conditionCode: 'NE', qty_available: '10' },
              { conditionCode: 'ZZ', qty_available: '5' }
            ]
          }
        });
        expect(errors).toHaveLength(1);
        expect(errors).toContain('quote_details.items[1].conditionCode must be one of: NE, NS, OH, SV, AR');
      });

      it('should accept all valid condition codes', () => {
        const allCodes = ['NE', 'NS', 'OH', 'SV', 'AR'];
        const errors = validateRfqRequest({
          ...validBase,
          quote_details: {
            items: allCodes.map(code => ({ conditionCode: code, qty_available: '1' }))
          }
        });
        expect(errors).toHaveLength(0);
      });

      it('should accept lowercase condition codes', () => {
        const errors = validateRfqRequest({
          ...validBase,
          quote_details: {
            items: [
              { conditionCode: 'ne', qty_available: '1' },
              { conditionCode: 'sv', qty_available: '2' }
            ]
          }
        });
        expect(errors).toHaveLength(0);
      });

      it('should return error for empty string conditionCode', () => {
        const errors = validateRfqRequest({
          ...validBase,
          quote_details: {
            items: [{ conditionCode: '', qty_available: '5' }]
          }
        });
        expect(errors).toContain('quote_details.items[0].conditionCode must be a non-empty string');
      });

      it('should return error for non-string conditionCode', () => {
        const errors = validateRfqRequest({
          ...validBase,
          quote_details: {
            items: [{ conditionCode: 123, qty_available: '5' }]
          }
        });
        expect(errors).toContain('quote_details.items[0].conditionCode must be a non-empty string');
      });
    });

    describe('valid request', () => {
      it('should return empty array for valid complete request', () => {
        const errors = validateRfqRequest({
          rfq_details: { quote_submission_url: 'https://example.com/form' },
          quote_details: {
            items: [
              {
                part_no: 'TEST-001',
                qty_available: '100',
                price_usd: '25.00'
              }
            ],
            supplier_comments: 'Test comment',
            quote_prepared_by: 'Test User'
          }
        });
        expect(errors).toHaveLength(0);
      });

      it('should return empty array for minimal valid request', () => {
        const errors = validateRfqRequest({
          rfq_details: { quote_submission_url: 'https://example.com/form' },
          quote_details: {}
        });
        expect(errors).toHaveLength(0);
      });
    });
  });

  describe('VALID_CONDITION_CODES', () => {
    it('should export the expected condition codes', () => {
      expect(VALID_CONDITION_CODES).toEqual(['NE', 'NS', 'OH', 'SV', 'AR']);
    });
  });

  describe('formatTagDate', () => {
    describe('null/undefined handling', () => {
      it('should return undefined for null', () => {
        expect(formatTagDate(null)).toBeUndefined();
      });

      it('should return undefined for undefined', () => {
        expect(formatTagDate(undefined)).toBeUndefined();
      });

      it('should return undefined for empty string', () => {
        expect(formatTagDate('')).toBeUndefined();
      });

      it('should return undefined for whitespace string', () => {
        expect(formatTagDate('   ')).toBeUndefined();
      });
    });

    describe('already formatted dates', () => {
      it('should return uppercase for already formatted date', () => {
        expect(formatTagDate('JAN-01-2024')).toBe('JAN-01-2024');
      });

      it('should uppercase lowercase formatted date', () => {
        expect(formatTagDate('jan-01-2024')).toBe('JAN-01-2024');
      });

      it('should handle mixed case formatted date', () => {
        expect(formatTagDate('Jan-15-2024')).toBe('JAN-15-2024');
      });
    });

    describe('ISO date parsing', () => {
      it('should parse ISO date string', () => {
        expect(formatTagDate('2024-01-15')).toBe('JAN-15-2024');
      });

      it('should parse ISO datetime string', () => {
        expect(formatTagDate('2024-06-20T10:30:00Z')).toBe('JUN-20-2024');
      });

      it('should parse full ISO date with time', () => {
        expect(formatTagDate('2024-12-25T00:00:00.000Z')).toBe('DEC-25-2024');
      });
    });

    describe('various date formats', () => {
      it('should parse MM/DD/YYYY format', () => {
        // Note: Date parsing behavior can vary by timezone
        const result = formatTagDate('03/15/2024');
        expect(result).toMatch(/^MAR-1[45]-2024$/);
      });

      it('should parse date object as string', () => {
        const date = new Date('2024-07-04T00:00:00Z');
        expect(formatTagDate(date.toISOString())).toBe('JUL-04-2024');
      });
    });

    describe('invalid dates', () => {
      it('should return uppercase original for unparseable date', () => {
        expect(formatTagDate('not-a-date')).toBe('NOT-A-DATE');
      });

      it('should return uppercase original for random string', () => {
        expect(formatTagDate('abc123')).toBe('ABC123');
      });
    });

    describe('edge cases', () => {
      it('should handle all months correctly', () => {
        const months = [
          { input: '2024-01-15', expected: 'JAN-15-2024' },
          { input: '2024-02-15', expected: 'FEB-15-2024' },
          { input: '2024-03-15', expected: 'MAR-15-2024' },
          { input: '2024-04-15', expected: 'APR-15-2024' },
          { input: '2024-05-15', expected: 'MAY-15-2024' },
          { input: '2024-06-15', expected: 'JUN-15-2024' },
          { input: '2024-07-15', expected: 'JUL-15-2024' },
          { input: '2024-08-15', expected: 'AUG-15-2024' },
          { input: '2024-09-15', expected: 'SEP-15-2024' },
          { input: '2024-10-15', expected: 'OCT-15-2024' },
          { input: '2024-11-15', expected: 'NOV-15-2024' },
          { input: '2024-12-15', expected: 'DEC-15-2024' }
        ];

        months.forEach(({ input, expected }) => {
          expect(formatTagDate(input)).toBe(expected);
        });
      });

      it('should pad single digit days', () => {
        expect(formatTagDate('2024-01-05')).toBe('JAN-05-2024');
      });

      it('should handle numeric input', () => {
        const result = formatTagDate(123456);
        expect(typeof result).toBe('string');
      });
    });
  });
});
