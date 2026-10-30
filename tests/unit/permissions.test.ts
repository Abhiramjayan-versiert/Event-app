import { describe, expect, it } from "vitest";
import { can, canAnywhere, canInDepartment, departmentIdsWith, type EventPermissionSet } from "@/lib/permissions";
import { eventNav } from "@/config/navigation";

const mediaHead: EventPermissionSet = {
  event: ["event.view", "media.view", "media.manage"],
  departments: { "dept-media": ["department.view", "tasks.manage", "documents.upload"] },
};
const eventAdmin: EventPermissionSet = { event: ["event.view", "event.manage", "tasks.manage", "finance.view"], departments: {}, all_departments: true };

describe("permission helpers", () => {
  it("separates event-wide and department grants", () => {
    expect(can(mediaHead, "media.manage")).toBe(true);
    expect(can(mediaHead, "tasks.manage")).toBe(false);
    expect(canInDepartment(mediaHead, "dept-media", "tasks.manage")).toBe(true);
    expect(canInDepartment(mediaHead, "dept-finance", "tasks.manage")).toBe(false);
    expect(canAnywhere(mediaHead, "tasks.manage")).toBe(true);
    expect(departmentIdsWith(mediaHead, "documents.upload")).toEqual(["dept-media"]);
  });

  it("event-wide grants apply in every department", () => {
    expect(canInDepartment(eventAdmin, "any-dept", "tasks.manage")).toBe(true);
  });

  it("treats missing permissions as denied", () => {
    expect(can(null, "event.view")).toBe(false);
    expect(canAnywhere(undefined, "event.view")).toBe(false);
  });

  it("builds event navigation from permissions and shipped modules only", () => {
    const mediaNav = eventNav("e1", mediaHead).map((i) => i.title);
    expect(mediaNav).toContain("Overview");
    expect(mediaNav).not.toContain("Settings");
    expect(eventNav("e1", eventAdmin).map((i) => i.href)).toContain("/events/e1/settings");
  });
});
