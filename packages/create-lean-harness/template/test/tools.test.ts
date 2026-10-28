import { describe, expect, it } from 'vitest';
import { lookupRecord } from '../src/tools.js';

// Tools are plain functions: test them without a model.
const context = { session: {} as never, signal: new AbortController().signal };

describe('lookup_record', () => {
  it('finds a record by id or by name', async () => {
    expect(await lookupRecord.run({ query: 'R-1001' }, context)).toMatchObject([{ id: 'R-1001' }]);
    expect(await lookupRecord.run({ query: 'renewal' }, context)).toMatchObject([{ id: 'R-1002' }]);
  });

  it('says when nothing matches', async () => {
    expect(await lookupRecord.run({ query: 'nothing like this' }, context)).toMatch(/No record/);
  });
});
