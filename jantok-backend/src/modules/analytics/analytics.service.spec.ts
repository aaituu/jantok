import { describe, expect, it } from 'vitest';
import { safeCell } from './analytics.service.js';

describe('spreadsheet export safety', () => {
  it.each(['=2+2', '+cmd', '-10+20', '@SUM(A1:A2)'])(
    'neutralizes formula-like text %s',
    (value) => expect(safeCell(value)).toBe(`'${value}`),
  );

  it('keeps numbers numeric and ordinary text unchanged', () => {
    expect(safeCell(1200)).toBe(1200);
    expect(safeCell('JANTOK')).toBe('JANTOK');
  });
});
