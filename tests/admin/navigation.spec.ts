/**
 * NAVIGATION TESTS — Admin sidebar, all views
 *
 * Verifies every sidebar entry loads the correct view without crashes.
 */
import { test, expect } from '../fixtures/base';

const BASE = 'http://localhost:5173';

test.beforeEach(async ({ page }) => {
  await page.goto(BASE);
  await page.waitForLoadState('networkidle');
});

test('nav-01: admin loads and renders sidebar', async ({ page, consoleLogs, isLoggedIn }) => {
  if (!isLoggedIn) {
    test.skip(true, 'No auth state — skip');
    return;
  }
  await expect(page.getByText('Obie')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Admin Console')).toBeVisible();
  // Queue group icon visible
  await expect(page.getByRole('button').filter({ hasText: '🎵' })).toBeVisible();
  const errors = consoleLogs.filter(l => l.type === 'error' && !l.text.includes('Auth session missing'));
  expect(errors.length, errors.map(e => e.text).join(', ')).toBe(0);
});

// `expectedText` is matched against the view's <h1> inside <main>. It is kept
// separate from the sidebar label because the two do not always agree — e.g.
// the sidebar entry "All Playlists" renders an <h1> of "Playlists".
const NAV_VIEWS: Array<{ group: string; child: string; expectedText: string }> = [
  { group: 'Queue',     child: '',                     expectedText: 'Queue'               },
  { group: 'Playlists', child: 'All Playlists',        expectedText: 'Playlists'           },
  { group: 'Playlists', child: 'Import Playlist',      expectedText: 'Import Playlist'     },
  { group: 'Settings',  child: 'Playback',             expectedText: 'Playback Settings'   },
  { group: 'Settings',  child: 'Kiosk',                expectedText: 'Kiosk Settings'      },
  { group: 'Settings',  child: 'Branding',             expectedText: 'Branding'            },
  { group: 'Settings',  child: 'Console Preferences',  expectedText: 'Console Preferences' },
  { group: 'Logs',      child: '',                     expectedText: 'System Logs'         },
];

for (const { group, child, expectedText } of NAV_VIEWS) {
  test(`nav-02: navigate to ${child || group} view`, async ({ page, consoleLogs, isLoggedIn }) => {
    if (!isLoggedIn) {
      test.skip(true, 'No auth state — skip');
      return;
    }

    // Click the group button
    await page.getByRole('button', { name: new RegExp(group, 'i') }).first().click();
    await page.waitForTimeout(200);

    if (child) {
      await page.getByRole('button', { name: child }).first().click();
      await page.waitForTimeout(300);
    }

    // Assert against the view's <h1> inside <main> rather than a page-wide
    // getByText(), which also matches the identically-named sidebar button.
    await expect(page.getByRole('main').getByRole('heading', { level: 1 }))
      .toHaveText(expectedText, { timeout: 10_000 });

    const errors = consoleLogs.filter(l => l.type === 'error' && !l.text.includes('Auth session missing'));
    expect(errors.length, `Errors on "${expectedText}" view: ${errors.map(e => e.text).join(', ')}`).toBe(0);
  });
}

test('nav-03: sidebar collapse/expand works', async ({ page, consoleLogs, isLoggedIn }) => {
  if (!isLoggedIn) {
    test.skip(true, 'No auth state — skip');
    return;
  }

  // Collapse (‹ button)
  const collapseBtn = page.locator('button').filter({ hasText: '‹' });
  if (await collapseBtn.isVisible()) {
    await collapseBtn.click();
    await page.waitForTimeout(300);
    // Sidebar should be narrow — text "Admin Console" hidden
    await expect(page.getByText('Admin Console')).not.toBeVisible();

    // Expand (› button)
    await page.locator('button').filter({ hasText: '›' }).first().click();
    await page.waitForTimeout(300);
    await expect(page.getByText('Admin Console')).toBeVisible();
  }

  const errors = consoleLogs.filter(l => l.type === 'error' && !l.text.includes('Auth session missing'));
  expect(errors.length, errors.map(e => e.text).join(', ')).toBe(0);
});

test('nav-04: user email displayed in sidebar footer', async ({ page, consoleLogs, isLoggedIn }) => {
  if (!isLoggedIn) {
    test.skip(true, 'No auth state — skip');
    return;
  }
  const email = process.env.TEST_EMAIL || '';
  if (email) {
    await expect(page.getByText(email)).toBeVisible({ timeout: 10_000 });
  } else {
    // Just check there's some text in sidebar footer area
    const signOut = page.getByRole('button', { name: 'Sign Out' });
    await expect(signOut).toBeVisible({ timeout: 10_000 });
  }
});
