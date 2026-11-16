import { describe, expect, it } from 'vitest';
import { controlerConfig } from './config';

const ok = {
  tenantId: '11111111-2222-3333-4444-555555555555',
  clientId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  siteUrl: 'https://entreprise.sharepoint.com/sites/Transit',
  bibliotheque: 'Transit',
};

describe('réglages du transit', () => {
  it('accepte des valeurs correctes', () => {
    expect(controlerConfig(ok)).toEqual([]);
  });
  it('signale chaque valeur incorrecte', () => {
    expect(controlerConfig({ ...ok, tenantId: '1234' })).toHaveLength(1);
    expect(controlerConfig({ ...ok, clientId: '' })).toHaveLength(1);
    expect(controlerConfig({ ...ok, siteUrl: 'http://entreprise.sharepoint.com/sites/Transit' })).toHaveLength(1);
    expect(controlerConfig({ ...ok, siteUrl: 'https://exemple.com/sites/Transit' })).toHaveLength(1);
    expect(controlerConfig({ ...ok, siteUrl: 'https://entreprise.sharepoint.com/' })).toHaveLength(1);
    expect(controlerConfig({ ...ok, bibliotheque: ' ' })).toHaveLength(1);
  });
});
