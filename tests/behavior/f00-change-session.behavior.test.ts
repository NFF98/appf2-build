import { describe, expect, test } from "vitest";

import { changeEntryFor } from "../../src/app/app-surface/app-session.js";
import { ChangeSessionOwner } from "../../src/app/change/change-session.js";

const BASE = `sha256:${"a".repeat(64)}`;

function ownerWithIds(): { owner: ChangeSessionOwner; issued: string[] } {
  const issued: string[] = [];
  const owner = new ChangeSessionOwner(() => {
    const id = `change-${issued.length + 1}`;
    issued.push(id);
    return id;
  });
  return { owner, issued };
}

describe("F00 S05 change-session owner", () => {
  test("an explicit S05A or S05B choice opens one session on that exact path with an empty draft", () => {
    for (const choice of ["MODIFY_THIS_APP", "MAKE_MY_VERSION"] as const) {
      const { owner } = ownerWithIds();
      const entry = changeEntryFor(choice, BASE);
      expect(owner.open(entry)).toBe(true);
      expect(owner.getSnapshot()).toEqual({ id: "change-1", entry, draft: "", view: "COMPOSER" });
    }
  });

  test("viewing the original keeps the same session id, path and draft, and refuses a second session", () => {
    const { owner, issued } = ownerWithIds();
    const notified: number[] = [];
    owner.subscribe(() => notified.push(notified.length));
    const entry = changeEntryFor("MAKE_MY_VERSION", BASE);
    owner.open(entry);
    owner.updateDraft("改成可以輸入小費");

    owner.viewOriginal();
    expect(owner.getSnapshot()).toEqual({ id: "change-1", entry, draft: "改成可以輸入小費", view: "INSPECTING_ORIGINAL" });
    expect(owner.open(changeEntryFor("MODIFY_THIS_APP", BASE))).toBe(false);
    owner.updateDraft("ignored while inspecting");
    owner.close();
    expect(owner.getSnapshot()?.draft).toBe("改成可以輸入小費");

    owner.returnFromOriginal();
    expect(owner.getSnapshot()).toEqual({ id: "change-1", entry, draft: "改成可以輸入小費", view: "COMPOSER" });
    expect(owner.open(changeEntryFor("MODIFY_THIS_APP", BASE))).toBe(false);
    expect(issued).toEqual(["change-1"]);
    expect(notified).toHaveLength(4);
  });

  test("回原 App ends the session from the Composer, after which a new explicit choice opens a new one", () => {
    const { owner, issued } = ownerWithIds();
    owner.open(changeEntryFor("MODIFY_THIS_APP", BASE));
    owner.returnFromOriginal();
    expect(owner.getSnapshot()?.view).toBe("COMPOSER");
    owner.close();
    expect(owner.getSnapshot()).toBeNull();
    owner.viewOriginal();
    expect(owner.getSnapshot()).toBeNull();

    const remix = changeEntryFor("MAKE_MY_VERSION", BASE);
    expect(owner.open(remix)).toBe(true);
    expect(owner.getSnapshot()).toEqual({ id: "change-2", entry: remix, draft: "", view: "COMPOSER" });
    expect(issued).toEqual(["change-1", "change-2"]);
  });

  test("the production owner issues a distinct random session id per opened session", () => {
    const owner = new ChangeSessionOwner();
    owner.open(changeEntryFor("MODIFY_THIS_APP", BASE));
    const first = owner.getSnapshot()?.id;
    owner.close();
    owner.open(changeEntryFor("MODIFY_THIS_APP", BASE));
    const second = owner.getSnapshot()?.id;
    expect(first).toMatch(/^[0-9a-f-]{36}$/u);
    expect(second).toMatch(/^[0-9a-f-]{36}$/u);
    expect(second).not.toBe(first);
  });
});
