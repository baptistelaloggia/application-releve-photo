import { describe, expect, it } from 'vitest';
import { corrigerDictee } from './dictee';

describe('correction de la dictée', () => {
  it('reconstitue les sigles épelés ou écrits en minuscules', () => {
    expect(corrigerDictee('la c t a du r+2 est non conforme')).toBe('la CTA du r+2 est non conforme');
    expect(corrigerDictee('cé té a en toiture')).toBe('CTA en toiture');
    expect(corrigerDictee('vé cé non conforme, calorifuge absent')).toBe('VC non conforme, calorifuge absent');
    expect(corrigerDictee('le gé effe et le tgbt')).toBe('le GF et le TGBT');
    expect(corrigerDictee('c.c.f. à reprendre')).toBe('CCF à reprendre');
    expect(corrigerDictee('volet v c f t et t c f t')).toBe('volet VCFT et TCFT');
    expect(corrigerDictee('fuite sur la chute eu ev')).toBe('fuite sur la chute EU / EV');
    expect(corrigerDictee('sonde co 2 en défaut')).toBe('sonde CO2 en défaut');
  });

  it('laisse les mots courants', () => {
    expect(corrigerDictee("il n'y a pas de fuite")).toBe("il n'y a pas de fuite");
    expect(corrigerDictee('il y a de la condensation')).toBe('il y a de la condensation');
    expect(corrigerDictee('elle a été remplacée')).toBe('elle a été remplacée');
  });
});
