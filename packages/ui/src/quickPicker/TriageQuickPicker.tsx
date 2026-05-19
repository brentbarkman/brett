import React, { useState } from "react";
import type { NavList, DueDatePrecision } from "@brett/types";
import { QuickDatePicker } from "./QuickDatePicker";
import { QuickListPicker } from "./QuickListPicker";

export interface TriageQuickPickerProps {
  anchorEl: HTMLElement | null;
  initialDate: Date | null;
  initialListId: string | null;
  lists: NavList[];
  suggestedListIds: string[];
  suggestionMode: "suggested" | "recent" | "empty";
  startWith: "date" | "list";
  onCommitDate: (date: Date | null, precision: DueDatePrecision, tonight: boolean) => void;
  onCommitList: (listId: string | null) => void;
  onClose: () => void;
  placement?: "bottom-end" | "bottom-start" | "top-end" | "top-start";
  now?: Date;
}

export function TriageQuickPicker(props: TriageQuickPickerProps) {
  const { startWith } = props;
  const [step, setStep] = useState<"date" | "list">(startWith);

  const handleDateCommit = (date: Date | null, precision: DueDatePrecision, tonight: boolean) => {
    props.onCommitDate(date, precision, tonight);
    if (step !== startWith) {
      // We are on step 2 (i.e. startWith was "list", we already committed a list)
      props.onClose();
      return;
    }
    setStep("list");
  };

  const handleListCommit = (listId: string | null) => {
    props.onCommitList(listId);
    if (step !== startWith) {
      props.onClose();
      return;
    }
    setStep("date");
  };

  return (
    <>
      <QuickDatePicker
        anchorEl={props.anchorEl}
        initialDate={props.initialDate}
        onCommit={handleDateCommit}
        onCancel={props.onClose}
        placement={props.placement}
        now={props.now}
        visible={step === "date"}
      />
      <QuickListPicker
        anchorEl={props.anchorEl}
        initialListId={props.initialListId}
        lists={props.lists}
        suggestedListIds={props.suggestedListIds}
        suggestionMode={props.suggestionMode}
        onCommit={handleListCommit}
        onCancel={props.onClose}
        placement={props.placement}
        visible={step === "list"}
      />
    </>
  );
}
