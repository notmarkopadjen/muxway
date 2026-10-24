import { expect, test } from "@playwright/test";
import { control, HOST, shot, signIn } from "./fixtures";

test("78 with fit on, a zoom reaches the host and the font stays the chosen one", async ({
  page,
  request,
}, info) => {
  const zoomed = () => control(request, "/zoomed", { target: "work:0" });
  const size = () => control(request, "/window-size", { target: "work:0" });
  await page.setViewportSize({ width: 1200, height: 800 });
  await signIn(page);
  await page.goto(`/w/${HOST}/work/0`);
  await expect(page.getByTestId("cell")).toHaveCount(2);
  // Fit is on by default in the window view; the host follows.
  await expect(page.getByTestId("fit")).toHaveAttribute("data-on", "1");
  await expect.poll(size, { timeout: 5000 }).not.toBe("100x30");
  const fitted = await size();
  // With fit on a pane is read at the chosen font, not scaled to its box.
  for (const screen of await page.getByTestId("cell-screen").all())
    expect(await screen.getAttribute("data-font")).toBeNull();
  await page.waitForTimeout(700);
  await page.getByTestId("cell-screen").nth(1).dblclick();
  await expect(page.getByTestId("cell")).toHaveCount(1);
  await expect.poll(zoomed, { timeout: 5000 }).toBe("1");
  // The zoomed pane has the whole window.
  await expect(
    page.getByTestId("cell").getByTestId("pane-title"),
  ).toBeVisible();
  await expect
    .poll(
      async () =>
        (await page.locator(".mx-cell-head .mx-dim").innerText()).split(
          " · ",
        )[1],
    )
    .toBe(fitted.replace("x", "×"));
  await shot(page, info, "78-host-zoom");
  await page.getByTestId("cell-screen").dblclick();
  await expect(page.getByTestId("cell")).toHaveCount(2);
  await expect.poll(zoomed, { timeout: 5000 }).toBe("0");
  expect(await control(request, "/layout", { target: "work:0" })).toContain(
    "[",
  );
  // A bigger font means fewer cells for the host.
  await page.keyboard.press("?");
  await page.getByTestId("font").click();
  await expect(page.getByTestId("font")).toHaveText("font: 16px");
  await page.keyboard.press("Escape");
  await expect
    .poll(async () => Number((await size()).split("x")[0]), { timeout: 5000 })
    .toBeLessThan(Number(fitted.split("x")[0]));
  await expect(page.getByTestId("cell-screen").first()).toHaveCSS(
    "font-size",
    "16px",
  );
  await page.keyboard.press("?");
  for (let i = 0; i < 5; i++) await page.getByTestId("font").click();
  await expect(page.getByTestId("font")).toHaveText("font: 14px");
  await page.keyboard.press("Escape");
  // Leaving gives the window back, unzoomed and at its own size.
  await page.goto("/");
  await expect.poll(size, { timeout: 5000 }).toBe("100x30");
  expect(await zoomed()).toBe("0");
});
