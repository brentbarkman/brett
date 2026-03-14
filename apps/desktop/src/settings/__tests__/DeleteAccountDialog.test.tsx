import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DeleteAccountDialog } from "../DeleteAccountDialog";

describe("DeleteAccountDialog", () => {
  it("does not render when closed", () => {
    render(
      <DeleteAccountDialog
        isOpen={false}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );
    expect(screen.queryByText("Delete account")).not.toBeInTheDocument();
  });

  it("renders when open", () => {
    render(
      <DeleteAccountDialog
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );
    expect(
      screen.getByText("This action is permanent and cannot be undone. All your data will be deleted.")
    ).toBeInTheDocument();
  });

  it("disables delete button until DELETE is typed", async () => {
    const user = userEvent.setup();
    render(
      <DeleteAccountDialog
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    const deleteButton = screen.getByRole("button", { name: "Delete account" });
    expect(deleteButton).toBeDisabled();

    const input = screen.getByPlaceholderText("DELETE");
    await user.type(input, "DELETE");

    expect(deleteButton).toBeEnabled();
  });

  it("calls onConfirm when DELETE is typed and button clicked", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <DeleteAccountDialog
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />
    );

    const input = screen.getByPlaceholderText("DELETE");
    await user.type(input, "DELETE");

    const deleteButton = screen.getByRole("button", { name: "Delete account" });
    await user.click(deleteButton);

    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("does not call onConfirm when text does not match", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <DeleteAccountDialog
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />
    );

    const input = screen.getByPlaceholderText("DELETE");
    await user.type(input, "DELE");

    const deleteButton = screen.getByRole("button", { name: "Delete account" });
    expect(deleteButton).toBeDisabled();
  });

  it("shows error message on failure", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockRejectedValue(new Error("Network error"));
    render(
      <DeleteAccountDialog
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />
    );

    const input = screen.getByPlaceholderText("DELETE");
    await user.type(input, "DELETE");

    const deleteButton = screen.getByRole("button", { name: "Delete account" });
    await user.click(deleteButton);

    expect(await screen.findByText("Network error")).toBeInTheDocument();
  });

  it("calls onClose when cancel is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <DeleteAccountDialog
        isOpen={true}
        onClose={onClose}
        onConfirm={vi.fn()}
      />
    );

    const cancelButton = screen.getByRole("button", { name: "Cancel" });
    await user.click(cancelButton);

    expect(onClose).toHaveBeenCalledOnce();
  });
});
