import { describe, expect, it } from "vitest";
import { shouldRenderOverviewPage } from "./App";

describe("dashboard root routing", () => {
  it("renders the overview page for the authenticated root route", () => {
    expect(shouldRenderOverviewPage("landing")).toBe(true);
  });

  it("keeps the overview page active for dedicated overview routes", () => {
    expect(shouldRenderOverviewPage("overview")).toBe(true);
  });

  it("does not leak the overview page into other route kinds", () => {
    expect(shouldRenderOverviewPage("login")).toBe(false);
    expect(shouldRenderOverviewPage("match-list")).toBe(false);
  });
});
