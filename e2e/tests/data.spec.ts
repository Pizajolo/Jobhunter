import { expect, test } from '@playwright/test';

test('stats show the funnel and the export link downloads a zip', async ({ page }) => {
  await page.goto('/stats');
  await expect(page.getByRole('heading', { name: 'Funnel' })).toBeVisible();
  await expect(page.getByText('Found', { exact: true })).toBeVisible();
  await page.goto('/settings');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Export all data (.zip)' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^jobhunter-export-\d{4}-\d{2}-\d{2}\.zip$/u);
  // delete needs the typed confirmation
  await page.getByRole('button', { name: 'Delete everything…' }).click();
  await expect(page.getByRole('button', { name: 'Delete everything now' })).toBeDisabled();
});
