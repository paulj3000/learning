import { householdKeyFor } from './householdKey';

describe('householdKeyFor', () => {
  it('is a stable 64-character hex digest that does not contain the sub', async () => {
    const sub = '0b1c2d3e-aaaa-bbbb-cccc-1234567890ab';
    const key = await householdKeyFor(sub);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toContain(sub);
    expect(await householdKeyFor(sub)).toBe(key);
  });

  it('differs between parents', async () => {
    expect(await householdKeyFor('parent-a')).not.toBe(await householdKeyFor('parent-b'));
  });
});
