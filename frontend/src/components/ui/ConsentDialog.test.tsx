import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { ConsentDialog } from "./ConsentDialog";

function Harness({ onConfirm = vi.fn(), onCancel = vi.fn() }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Run benchmark
      </button>
      <ConsentDialog
        open={open}
        title="Start a CPU benchmark?"
        impact={[
          "Uses up to 1 CPU core for up to 60 seconds.",
          "Runs locally; nothing is submitted anywhere.",
        ]}
        acknowledgement="I understand this will use significant CPU."
        confirmLabel="Start benchmark"
        onConfirm={() => {
          onConfirm();
          setOpen(false);
        }}
        onCancel={() => {
          onCancel();
          setOpen(false);
        }}
      />
    </>
  );
}

const openDialog = async () => {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Run benchmark" }));
  return user;
};

describe("ConsentDialog", () => {
  it("is an accessible modal describing the impact", async () => {
    render(<Harness />);
    await openDialog();
    const dialog = screen.getByRole("dialog", { name: "Start a CPU benchmark?" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleDescription(/Uses up to 1 CPU core/);
  });

  it("requires explicit acknowledgement before confirming", async () => {
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    const user = await openDialog();
    const confirm = screen.getByRole("button", { name: "Start benchmark" });
    expect(confirm).toBeDisabled();
    await user.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();

    await user.click(screen.getByRole("checkbox"));
    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["Escape key", async (user: ReturnType<typeof userEvent.setup>) => user.keyboard("{Escape}")],
    [
      "Cancel button",
      async (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByText("Cancel")),
    ],
  ])("declines via the %s", async (_name, decline) => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(<Harness onCancel={onCancel} onConfirm={onConfirm} />);
    const user = await openDialog();
    await decline(user);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("moves focus in, traps Tab, and restores focus on close", async () => {
    render(<Harness />);
    const user = await openDialog();
    const checkbox = screen.getByRole("checkbox");
    expect(checkbox).toHaveFocus();

    await user.tab(); // Cancel (confirm is disabled, so it is skipped)
    expect(screen.getByText("Cancel")).toHaveFocus();
    await user.tab(); // wraps back inside the dialog
    expect(checkbox).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByText("Cancel")).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Run benchmark" })).toHaveFocus();
  });

  it("resets the acknowledgement when reopened", async () => {
    render(<Harness />);
    const user = await openDialog();
    await user.click(screen.getByRole("checkbox"));
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Run benchmark" }));
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Start benchmark" })).toBeDisabled();
  });
});
