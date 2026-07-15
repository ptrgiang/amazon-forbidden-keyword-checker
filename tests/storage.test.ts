import { describe, expect, it } from 'vitest';
import {
  deleteManagedSite,
  isSiteEnabled,
  isSiteManaged,
  normalizeSettings,
  normalizeSiteHost,
  setSiteEnabled
} from '../src/lib/storage';

describe('site settings', () => {
  it('normalizes site input into hostnames', () => {
    expect(normalizeSiteHost('https://Example.COM/path?q=1')).toBe('example.com');
    expect(normalizeSiteHost('https://www.Example.COM/path?q=1')).toBe('example.com');
    expect(normalizeSiteHost(' sellercentral.amazon.com ')).toBe('sellercentral.amazon.com');
    expect(normalizeSiteHost('')).toBeNull();
    expect(normalizeSiteHost('*.example.com')).toBeNull();
  });

  it('defaults to Google Docs and Seller Central enabled, with unknown sites off', () => {
    const settings = normalizeSettings(undefined);
    expect(isSiteEnabled(settings, 'docs.google.com')).toBe(true);
    expect(isSiteEnabled(settings, 'sellercentral.amazon.com')).toBe(true);
    expect(isSiteEnabled(settings, 'ap.sellercentral.amazon.com')).toBe(true);
    expect(isSiteEnabled(settings, 'example.com')).toBe(false);
    expect(isSiteManaged(settings, 'docs.google.com')).toBe(true);
  });

  it('adds enabled sites locally from the popup toggle', () => {
    const settings = setSiteEnabled(normalizeSettings(undefined), 'example.com', true);
    expect(isSiteEnabled(settings, 'example.com')).toBe(true);
    expect(isSiteManaged(settings, 'example.com')).toBe(true);
  });

  it('migrates managed www hosts to the parent hostname', () => {
    const settings = normalizeSettings({
      mode: 'live',
      managedSites: ['www.example.com'],
      siteEnabled: { 'www.example.com': true },
      selectedLanguages: null
    });
    expect(settings.managedSites).toContain('example.com');
    expect(settings.managedSites).not.toContain('www.example.com');
    expect(isSiteEnabled(settings, 'www.example.com')).toBe(true);
    expect(isSiteManaged(settings, 'example.com')).toBe(true);
  });

  it('keeps disabled sites in Manage Sites', () => {
    const settings = setSiteEnabled(normalizeSettings(undefined), 'example.com', false);
    expect(isSiteEnabled(settings, 'example.com')).toBe(false);
    expect(isSiteManaged(settings, 'example.com')).toBe(true);
  });

  it('uses the most specific saved host when parent and child settings differ', () => {
    const parentOff = setSiteEnabled(normalizeSettings(undefined), 'example.com', false);
    const childOn = setSiteEnabled(parentOff, 'app.example.com', true);
    expect(isSiteEnabled(childOn, 'app.example.com')).toBe(true);
    expect(isSiteEnabled(childOn, 'deep.app.example.com')).toBe(true);
    expect(isSiteEnabled(childOn, 'other.example.com')).toBe(false);
  });

  it('deletes managed sites and keeps deleted defaults from returning', () => {
    const settings = deleteManagedSite(normalizeSettings(undefined), 'docs.google.com');
    expect(isSiteManaged(settings, 'docs.google.com')).toBe(false);
    expect(isSiteEnabled(settings, 'docs.google.com')).toBe(false);

    const reloaded = normalizeSettings(settings);
    expect(isSiteManaged(reloaded, 'docs.google.com')).toBe(false);
    expect(isSiteEnabled(reloaded, 'docs.google.com')).toBe(false);
  });

  it('migrates explicit old per-site flags without keeping all sites enabled by default', () => {
    const settings = normalizeSettings({
      mode: 'live',
      siteEnabled: { 'old.example.com': true },
      defaultSiteEnabled: true,
      selectedLanguages: null
    });
    expect(isSiteEnabled(settings, 'old.example.com')).toBe(true);
    expect(isSiteManaged(settings, 'old.example.com')).toBe(true);
    expect(isSiteEnabled(settings, 'unknown.example.com')).toBe(false);
  });
});
