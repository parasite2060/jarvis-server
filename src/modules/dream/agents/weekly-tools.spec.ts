import { readDailyLogPreloadedFactory, readVaultIndexPreloadedFactory } from './weekly-tools';

describe('readDailyLogPreloadedFactory', () => {
  it('returns the pre-loaded body when present', async () => {
    const tool = readDailyLogPreloadedFactory({ '2026-05-04': 'Monday log content' });
    const result = await tool.invoke({ date_str: '2026-05-04' });
    expect(result).toBe('Monday log content');
  });

  it('returns the (no daily log) sentinel when missing', async () => {
    const tool = readDailyLogPreloadedFactory({});
    const result = await tool.invoke({ date_str: '2026-05-04' });
    expect(result).toBe('(no daily log)');
  });

  it('exposes the camelCase tool name', () => {
    const tool = readDailyLogPreloadedFactory({});
    expect(tool.name).toBe('readDailyLog');
  });
});

describe('readVaultIndexPreloadedFactory', () => {
  it('returns the pre-loaded index body when present', async () => {
    const tool = readVaultIndexPreloadedFactory({ decisions: '- decision A' });
    const result = await tool.invoke({ folder: 'decisions' });
    expect(result).toBe('- decision A');
  });

  it('returns the (no index) sentinel when missing', async () => {
    const tool = readVaultIndexPreloadedFactory({});
    const result = await tool.invoke({ folder: 'patterns' });
    expect(result).toBe('(no index)');
  });

  it('exposes the camelCase tool name', () => {
    const tool = readVaultIndexPreloadedFactory({});
    expect(tool.name).toBe('readVaultIndex');
  });
});
